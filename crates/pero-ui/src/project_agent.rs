//! Project collaboration consumes Host-owned ACP sessions and their journal projections.
use crate::{app::Workbench, projects::ProjectTab};
use gpui_kit::{
    component::{
        button::*,
        menu::{DropdownMenu, PopupMenuItem},
        *,
    },
    prelude::*,
    *,
};
use pero_contracts::{HostEvent, project_agent::ProjectAgentSnapshot};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Default)]
pub(crate) struct ProjectAgentsView {
    snapshots: BTreeMap<String, ProjectAgentSnapshot>,
    pending: BTreeMap<String, (String, String)>,
    loading: BTreeSet<String>,
    dirty: BTreeSet<String>,
    errors: BTreeMap<String, String>,
    selected_threads: BTreeMap<String, String>,
    context_open: bool,
}
impl ProjectAgentsView {
    pub(crate) fn finish_request(&mut self, id: &str) -> Option<(String, String)> {
        let (project, action) = self.pending.remove(id)?;
        if !self.pending.values().any(|(other, _)| other == &project) {
            self.loading.remove(&project);
        }
        Some((project, action))
    }
    fn request_failed(&mut self, id: &str, error: String) -> Option<String> {
        if let Some((project, action)) = self.finish_request(id) {
            self.dirty.remove(&project);
            self.errors.insert(project.clone(), error);
            return (action == "start").then_some(project);
        }
        None
    }
    pub(crate) fn snapshot_for(&self, project: &str) -> Option<&ProjectAgentSnapshot> {
        self.snapshots.get(project)
    }
    #[cfg(target_family = "wasm")]
    pub fn snapshot(&self, _cx: &App) -> Value {
        json!({"snapshots":self.snapshots,"loading":self.loading,"errors":self.errors,
            "selected_threads":self.selected_threads,"context_open":self.context_open})
    }
}

impl Workbench {
    pub(crate) fn project_composer_scope(&self) -> Option<pero_chat_ui::ProjectComposerScope> {
        let project = self.saved_research_project()?;
        let ready = self.project_agents.snapshot_for(&project.id).is_some_and(|snapshot| {
            !snapshot.sessions.iter().any(|session| session.binding.parent_thread.is_none())
        });
        Some(pero_chat_ui::ProjectComposerScope {
            project_id: project.id.clone(),
            workspace: project.workspace.clone(),
            ready,
        })
    }

    pub(crate) fn start_project_agent(&mut self, project_id: &str, agent_id: &str, cx: &mut Context<Self>) {
        let chat = self.chat.read(cx);
        let retry = chat.active_chat.and_then(|index| chat.chats.get(index)).is_some_and(|chat| {
            chat.can_retry_project_start() && chat.agent == agent_id
        });
        if self.project_agent_active()
            && self.project_composer_scope().is_some_and(|scope| scope.project_id == project_id && (scope.ready || retry))
            && !self.project_agents.pending.values().any(|(project, action)| project == project_id && action == "start")
        {
            self.request_project_agents(project_id, "start", json!({
                "project_id": project_id, "agent_id": agent_id
            }), cx);
        } else {
            self.chat.update(cx, |chat, cx| chat.project_start_failed(project_id, cx));
        }
    }

    pub(crate) fn fail_project_agent_request(&mut self, id: &str, cx: &mut Context<Self>) {
        if let Some(project) = self.project_agents.request_failed(id, self.t("error.connection").into()) {
            self.chat.update(cx, |chat, cx| chat.project_start_failed(&project, cx));
        }
    }

    pub(crate) fn refresh_project_agents(&mut self, cx: &mut Context<Self>) {
        let Some(id) = self
            .saved_research_project()
            .map(|project| project.id.clone())
        else {
            return;
        };
        self.request_project_agents(&id, "snapshot", json!({"project_id":id}), cx);
    }
    pub(crate) fn show_project_agents(&mut self, cx: &mut Context<Self>) {
        self.project_tab = ProjectTab::Agent;
        self.select_project_conversation(cx);
        self.refresh_project_agents(cx);
        self.refresh_project_resources(cx);
        cx.notify();
    }
    fn request_project_agents(
        &mut self,
        project: &str,
        action: &str,
        mut value: Value,
        cx: &mut Context<Self>,
    ) {
        if action == "snapshot" && self.project_agents.loading.contains(project) {
            self.project_agents.dirty.insert(project.into());
            return;
        }
        self.next_request += 1;
        let id = format!("project-agent-{}", self.next_request);
        value["method"] = json!("project_agent");
        value["request_id"] = json!(id);
        value["action"] = json!(action);
        self.project_agents
            .pending
            .insert(id, (project.into(), action.into()));
        self.project_agents.loading.insert(project.into());
        self.project_agents.errors.remove(project);
        self.command(value, cx);
    }
    pub(crate) fn receive_project_agents(
        &mut self,
        event: &HostEvent,
        cx: &mut Context<Self>,
    ) -> bool {
        if matches!(event.kind.as_str(), "project_agent" | "project_agent_error") {
            let pending = event
                .request_id
                .as_ref()
                .and_then(|id| self.project_agents.finish_request(id));
            let project = pending
                .as_ref()
                .map(|(project, _)| project.clone())
                .or_else(|| event.data["project_id"].as_str().map(str::to_owned));
            if let Some(project) = project {
                let starting = pending.is_some_and(|(_, action)| action == "start");
                let refresh =
                    self.project_agents.dirty.remove(&project) && event.kind == "project_agent";
                if event.kind == "project_agent_error" {
                    if starting {
                        self.chat.update(cx, |chat, cx| chat.project_start_failed(&project, cx));
                    }
                    self.project_agents
                        .errors
                        .insert(project.clone(), event.text.clone());
                } else {
                    match serde_json::from_value::<ProjectAgentSnapshot>(event.data.clone()) {
                        Ok(snapshot) => {
                            let selected = snapshot.selected_thread.clone();
                            if starting {
                                self.chat.update(cx, |chat, cx| {
                                    if let Some(thread) = selected.as_deref() {
                                        chat.finish_project_start(&project, thread, cx);
                                    } else {
                                        chat.project_start_failed(&project, cx);
                                    }
                                });
                            }
                            self.project_agents
                                .snapshots
                                .insert(project.clone(), snapshot);
                            if self.project_agent_active()
                                && self
                                    .saved_research_project()
                                    .is_some_and(|current| current.id == project)
                            {
                                if let Some(thread) = selected {
                                    self.open_project_agent_session(&thread, cx);
                                } else if self.project_agent_active() {
                                    self.select_project_conversation(cx);
                                }
                            }
                        }
                        Err(_) => {
                            if starting {
                                self.chat.update(cx, |chat, cx| chat.project_start_failed(&project, cx));
                            }
                            self.project_agents.errors.insert(
                                project.clone(),
                                self.t("project.agent.invalid_response").into(),
                            );
                        }
                    }
                }
                if refresh {
                    self.request_project_agents(
                        &project,
                        "snapshot",
                        json!({"project_id":project}),
                        cx,
                    );
                }
            }
            cx.notify();
            return true;
        }
        if event.kind == "disconnected" {
            for (project, action) in self.project_agents.pending.values() {
                if action == "start" {
                    self.chat.update(cx, |chat, cx| chat.project_start_failed(project, cx));
                }
                self.project_agents
                    .errors
                    .insert(project.clone(), self.t("error.connection").into());
            }
            self.project_agents.pending.clear();
            self.project_agents.loading.clear();
            self.project_agents.dirty.clear();
        }
        if self.project_agent_active()
            && matches!(
                event.kind.as_str(),
                "replay"
                    | "session_created"
                    | "turn_started"
                    | "turn_finished"
                    | "session_error"
                    | "session_closed"
                    | "permission"
                    | "permission_resolved"
                    | "user_questions"
                    | "user_questions_resolved"
                    | "session_auth_required"
                    | "session_auth_error"
                    | "session_authenticated"
            )
        {
            let relevant =
                event.kind == "replay"
                    || self.saved_research_project().is_some_and(|project| {
                        event.data["projectAgent"]["project_id"] == project.id
                            || self.project_agents.snapshots.get(&project.id).is_some_and(
                                |snapshot| {
                                    snapshot.sessions.iter().any(|session| {
                                        event.thread_id.as_deref() == Some(&session.thread_id)
                                    })
                                },
                            )
                    });
            if relevant {
                self.refresh_project_agents(cx);
            }
        }
        false
    }
    pub(crate) fn project_agent_active(&self) -> bool {
        matches!(self.project_tab, ProjectTab::Agent | ProjectTab::Overview)
            && self.navigation.page() == crate::workspace::WorkbenchPage::Tasks
            && self.saved_research_project().is_some()
            && matches!(self.navigation.current(), Some(crate::workspace::WorkspaceItem::Project(key)) if Some(key.as_str()) == self.selected_project.as_deref())
    }

    pub(crate) fn select_primary_project_agent(&mut self, key: &str) {
        if let Some(id) = key.strip_prefix("research:") {
            self.project_agents.selected_threads.remove(id);
        }
    }

    pub(crate) fn project_agent_thread(&self) -> Option<&str> {
        let project = self.saved_research_project()?;
        let snapshot = self.project_agents.snapshot_for(&project.id)?;
        self.project_agents
            .selected_threads
            .get(&project.id)
            .and_then(|id| {
                snapshot
                    .sessions
                    .iter()
                    .find(|session| &session.thread_id == id)
            })
            .or_else(|| {
                snapshot
                    .sessions
                    .iter()
                    .find(|session| session.binding.parent_thread.is_none())
            })
            .map(|session| session.thread_id.as_str())
    }

    pub(crate) fn select_project_conversation(&mut self, cx: &mut Context<Self>) {
        if let Some(thread) = self.project_agent_thread().map(str::to_owned) {
            self.open_project_agent_session(&thread, cx);
        }
    }

    pub(crate) fn open_project_agent_session(&mut self, thread: &str, cx: &mut Context<Self>) {
        let index = self
            .chat
            .read(cx)
            .chats
            .iter()
            .position(|chat| chat.id == thread);
        let Some(project) = index
            .and_then(|index| self.chat.read(cx).chats[index].project_agent.as_ref())
            .map(|binding| binding.project_id.clone())
        else {
            return;
        };
        if let Some(index) = index {
            let key = format!("research:{project}");
            self.selected_project = Some(key.clone());
            self.navigation
                .open(crate::workspace::WorkspaceItem::Project(key));
            self.project_tab = ProjectTab::Agent;
            self.project_agents
                .selected_threads
                .insert(project, thread.into());
            self.chat.update(cx, |chat, cx| {
                chat.set_scope(None, cx);
                if chat.active_chat != Some(index) {
                    chat.focus_chat(Some(index), cx);
                }
            });
            self.tab = crate::workspace::ConversationTab::Chat;
            if self
                .project_agents
                .snapshot_for(
                    self.saved_research_project()
                        .map(|project| project.id.as_str())
                        .unwrap_or_default(),
                )
                .is_none()
            {
                self.refresh_project_agents(cx);
                self.refresh_project_resources(cx);
            }
            self.sync_follow(cx);
            cx.notify();
        }
    }

    pub(crate) fn project_agent_titleband(&self, cx: &mut Context<Self>) -> AnyElement {
        let Some(project) = self.saved_research_project() else {
            return div().into_any_element();
        };
        let id = project.id.clone();
        let snapshot = self.project_agents.snapshot_for(&id);
        let loading = self.project_agents.loading.contains(&id);
        let primary = snapshot.and_then(|snapshot| {
            snapshot
                .sessions
                .iter()
                .find(|session| session.binding.parent_thread.is_none())
        });
        let selected = self
            .chat
            .read(cx)
            .active_chat
            .and_then(|index| self.chat.read(cx).chats.get(index))
            .and_then(|chat| {
                snapshot?
                    .sessions
                    .iter()
                    .find(|session| session.thread_id == chat.id)
            });
        let has_session = selected.is_some();
        let primary_thread = primary.map(|session| session.thread_id.clone());
        let summarize_id = id;
        let can_summarize = primary
            .is_some_and(|session| !matches!(session.status.as_str(), "running" | "cancelling"));
        let external_resources = self.chat.read(cx).resource_column.is_some();
        let narrow_context =
            !external_resources && self.layout.narrow && self.project_agents.context_open;
        let header = div()
            .w_full()
            .h_full()
            .flex_shrink_0()
            .flex()
            .items_center()
            .gap(px(pero_theme::SPACE_8))
            .px(px(pero_theme::SPACE_16))
            .py(px(0.))
            .child(div().flex_1().min_w_0().children(
                self.navigation.current().map(|item| self.workspace_content_tab(item, cx))
            ))
            .when(primary.is_some(), |el| {
                el.child(
                    Button::new("project-agent-summarize")
                        .ghost()
                        .small()
                        .icon(Icon::default().path("icons/sparkles.svg"))
                        .accessibility_label(self.t("project.agent.summarize"))
                        .tooltip(self.t("project.agent.summarize"))
                        .disabled(loading || !can_summarize)
                        .relative()
                        .child(self.view_bounds.projects.probe("agent:summarize".into()))
                        .on_click(cx.listener(move |this, _, _, cx| {
                            if let Some(thread) = &primary_thread {
                                this.request_project_agents(
                                    &summarize_id,
                                    "summarize",
                                    json!({"thread_id":thread}),
                                    cx,
                                );
                            }
                        })),
                )
            })
            .child(
                pero_theme::ghost_icon_button(
                    "project-agent-refresh",
                    pero_theme::Chrome::from_app(cx),
                    cx,
                )
                .icon(Icon::default().path("icons/refresh.svg"))
                .accessibility_label(self.t("remote.refresh"))
                .tooltip(self.t("remote.refresh"))
                .disabled(loading)
                .relative()
                .child(self.view_bounds.projects.probe("agent:refresh".into()))
                .on_click(cx.listener(|this, _, _, cx| this.refresh_project_agents(cx))),
            )
            .child(
                pero_theme::ghost_icon_button(
                    "project-agent-context",
                    pero_theme::Chrome::from_app(cx),
                    cx,
                )
                .icon(Icon::default().path("icons/panel-right-open.svg"))
                .accessibility_label(self.t("project.overview"))
                .tooltip(self.t("project.overview"))
                .relative()
                .child(self.view_bounds.projects.probe("agent:materials".into()))
                .on_click(cx.listener(|this, _, _, cx| {
                    this.chat
                        .update(cx, |chat, cx| chat.close_resource_pane(cx));
                    this.project_agents.context_open =
                        this.layout.narrow && !this.project_agents.context_open;
                    cx.notify();
                })),
            );
        div()
            .w_full()
            .h_full()
            .min_w_0()
            .flex()
            .items_center()
            .when(!narrow_context, |el| {
                el.child(div().flex_1().min_w_0().h_full().child(header))
            })
            .when(
                !external_resources && (!self.layout.narrow || narrow_context),
                |el| {
                    el.child(
                        div()
                            .h_full()
                            .min_w_0()
                            .flex_shrink_0()
                            .when(!self.layout.narrow, |el| {
                                el.w(px(self
                                    .chat
                                    .read(cx)
                                    .artifact_pane_width()
                                    .clamp(320., 360.)))
                            })
                            .when(self.layout.narrow, |el| el.flex_1())
                            .child(self.project_overview_header(has_session, cx)),
                    )
                },
            )
            .into_any_element()
    }

    fn project_overview_header(&self, has_session: bool, cx: &mut Context<Self>) -> AnyElement {
        div()
            .px(px(pero_theme::SPACE_16))
            .h_full()
            .flex()
            .items_center()
            .gap(px(pero_theme::SPACE_8))
            .child(
                div()
                    .flex_1()
                    .font_weight(FontWeight::MEDIUM)
                    .child(self.t("project.overview")),
            )
            .child(
                pero_theme::ghost_icon_button(
                    "project-overview-actions",
                    pero_theme::Chrome::from_app(cx),
                    cx,
                )
                .icon(Icon::default().path("icons/dots.svg"))
                .accessibility_label(self.t("project.actions"))
                .tooltip(self.t("project.actions"))
                .relative()
                .child(self.view_bounds.projects.probe("agent:views".into()))
                .dropdown_menu({
                    let owner = cx.entity().downgrade();
                    let entries = [
                        ProjectTab::Tasks,
                        ProjectTab::Sources,
                        ProjectTab::Execution,
                        ProjectTab::Settings,
                    ]
                    .map(|tab| (tab, self.t(tab.label_key()).to_owned()));
                    move |mut menu, _, _| {
                        for (tab, label) in &entries {
                            let tab = *tab;
                            let owner = owner.clone();
                            menu = menu.item(PopupMenuItem::new(label.clone()).on_click(
                                move |_, _, cx| {
                                    let _ = owner
                                        .update(cx, |this, cx| this.select_project_view(tab, cx));
                                },
                            ));
                        }
                        menu
                    }
                }),
            )
            .when(has_session, |el| {
                el.child(
                    Button::new("project-agent-artifacts")
                        .ghost()
                        .small()
                        .label(self.t("artifacts.title"))
                        .relative()
                        .child(self.view_bounds.projects.probe("agent:artifacts".into()))
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.project_agents.context_open = false;
                            this.chat.update(cx, |chat, cx| {
                                chat.open_resource_tab(
                                    pero_contracts::workbench::ResourceTab::Artifacts,
                                    cx,
                                )
                            });
                            cx.notify();
                        })),
                )
            })
            .when(self.layout.narrow, |el| {
                el.child(
                    pero_theme::ghost_icon_button(
                        "project-agent-context-back",
                        pero_theme::Chrome::from_app(cx),
                        cx,
                    )
                    .icon(Icon::default().path("icons/x.svg"))
                    .accessibility_label(self.t("chat.panel_title"))
                    .tooltip(self.t("chat.panel_title"))
                    .relative()
                    .child(
                        self.view_bounds
                            .projects
                            .probe("agent:context-close".into()),
                    )
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.project_agents.context_open = false;
                        cx.notify();
                    })),
                )
            })
            .into_any_element()
    }

    pub(crate) fn project_agent_view(&self, cx: &mut Context<Self>) -> AnyElement {
        let p = pero_theme::UiAppearance::global(cx).palette.clone();
        let Some(project) = self.saved_research_project() else {
            return div().into_any_element();
        };
        let id = project.id.clone();
        let snapshot = self.project_agents.snapshot_for(&id);
        let loading = self.project_agents.loading.contains(&id);
        let error = self.project_agents.errors.get(&id);
        let external_resources = self.chat.read(cx).resource_column.is_some();
        let narrow_context =
            !external_resources && self.layout.narrow && self.project_agents.context_open;
        let context = !external_resources && (!self.layout.narrow || narrow_context);
        div()
            .id("project-agent")
            .size_full()
            .min_w_0()
            .min_h_0()
            .flex()
            .when(!narrow_context, |el| {
                el.child(
                    div()
                        .id("project-agent-conversation")
                        .flex_1()
                        .min_w_0()
                        .min_h_0()
                        .h_full()
                        .flex()
                        .flex_col()
                        .bg(p.surface)
                        .relative()
                        .child(self.view_bounds.projects.probe("agent:conversation".into()))
                        .when_some(error, |el, error| {
                            el.child(
                                div()
                                    .id("project-agent-error")
                                    .role(Role::Alert)
                                    .px(px(pero_theme::SPACE_16))
                                    .py(px(pero_theme::SPACE_8))
                                    .text_color(p.error)
                                    .whitespace_normal()
                                    .child(error.clone()),
                            )
                        })
                        .when(loading && snapshot.is_none(), |el| {
                            el.child(
                                div()
                                    .id("project-agent-loading")
                                    .role(Role::Status)
                                    .px(px(pero_theme::SPACE_16))
                                    .text_size(px(pero_theme::TYPE_CAPTION))
                                    .text_color(p.text_muted)
                                    .child(self.t("project.agent.loading")),
                            )
                        })
                        .child(self.chat.clone()),
                )
            })
            .when(context, |el| el.child(self.project_agent_context(cx)))
            .into_any_element()
    }

    fn project_agent_context(&self, cx: &mut Context<Self>) -> AnyElement {
        let p = pero_theme::UiAppearance::global(cx).palette.clone();
        let project = self
            .saved_research_project()
            .expect("active project context");
        div()
            .id("project-agent-context")
            .when(self.research.editor.is_none(), |el| el.overflow_y_scroll())
            .h_full()
            .min_h_0()
            .flex_shrink_0()
            .flex()
            .flex_col()
            .bg(p.bg)
            .when(!self.layout.narrow, |el| {
                el.w(px(self
                    .chat
                    .read(cx)
                    .artifact_pane_width()
                    .clamp(320., 360.)))
                    .border_l(px(0.5))
                    .border_color(p.border)
            })
            .when(self.layout.narrow, |el| el.flex_1().min_w_0())
            .relative()
            .child(self.view_bounds.projects.probe("agent:context".into()))
            .when(self.research.editor.is_none(), |el| {
                el.child(
                    div()
                        .px(px(pero_theme::SPACE_16))
                        .pt(px(pero_theme::SPACE_16))
                        .flex_shrink_0()
                        .flex()
                        .flex_col()
                        .gap(px(pero_theme::SPACE_8))
                        .child(
                            div()
                                .whitespace_normal()
                                .font_weight(FontWeight::MEDIUM)
                                .child(project.title.clone()),
                        )
                        .child(
                            div()
                                .text_size(px(pero_theme::TYPE_CAPTION))
                                .text_color(p.text_muted)
                                .flex()
                                .items_center()
                                .justify_between()
                                .child(self.t("research.goal"))
                                .child(
                                    Button::new("project-overview-edit")
                                        .ghost()
                                        .small()
                                        .label(self.t("research.edit"))
                                        .tooltip(self.t("research.edit"))
                                        .accessibility_label(self.t("research.edit"))
                                        .relative()
                                        .child(self.view_bounds.projects.probe("edit".into()))
                                        .on_click(cx.listener(|this, _, window, cx| {
                                            this.edit_research_project(false, window, cx)
                                        })),
                                ),
                        )
                        .child(div().whitespace_normal().child(if project.goal.is_empty() {
                            self.t("research.goal_empty").to_owned()
                        } else {
                            project.goal.clone()
                        })),
                )
            })
            .when(self.research.editor.is_none(), |el| {
                el.child(self.research_resources(cx))
            })
            .when(self.research.editor.is_some(), |el| {
                el.child(
                    div()
                        .id("project-overview-editor")
                        .flex_1()
                        .min_h_0()
                        .overflow_y_scroll()
                        .px(px(pero_theme::SPACE_16))
                        .child(self.research_editor(cx)),
                )
            })
            .into_any_element()
    }
}

#[cfg(test)]
mod request_tests {
    use super::ProjectAgentsView;
    #[test]
    fn failed_transport_releases_only_the_finished_project_request() {
        for remaining in [false, true] {
            let mut view = ProjectAgentsView::default();
            view.pending.insert("failed".into(), ("project".into(), "snapshot".into()));
            view.loading.insert("project".into());
            if remaining {view.pending.insert("other".into(), ("project".into(), "start".into()));}
            view.request_failed("failed", "connection failed".into());
            assert!(!view.pending.contains_key("failed"));
            assert_eq!(view.loading.contains("project"), remaining);
            assert_eq!(view.errors["project"], "connection failed");
            if remaining {view.finish_request("other");assert!(!view.loading.contains("project"));}
        }
    }
}
