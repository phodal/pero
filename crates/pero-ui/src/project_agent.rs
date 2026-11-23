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

const PROJECT_CHAT_MIN_WIDTH: f32 = 360.;
const PROJECT_INSPECTOR_MIN_WIDTH: f32 = 320.;
const PROJECT_INSPECTOR_MAX_WIDTH: f32 = 640.;
pub(crate) const PROJECT_SPLIT_MIN: f32 = PROJECT_CHAT_MIN_WIDTH + PROJECT_INSPECTOR_MIN_WIDTH;

#[derive(Default)]
pub(crate) struct ProjectAgentsView {
    snapshots: BTreeMap<String, ProjectAgentSnapshot>,
    pending: BTreeMap<String, (String, String)>,
    loading: BTreeSet<String>,
    dirty: BTreeSet<String>,
    errors: BTreeMap<String, String>,
    selected_threads: BTreeMap<String, String>,
    pub(crate) right_tabs: BTreeMap<String, ProjectTab>,
    context_open: bool,
    wide_context_hidden: bool,
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
    pub(crate) fn right_tab(&self, project: &str) -> ProjectTab {
        self.right_tabs.get(project).copied().unwrap_or_default()
    }
    #[cfg(target_family = "wasm")]
    pub fn snapshot(&self, _cx: &App) -> Value {
        json!({"snapshots":self.snapshots,"loading":self.loading,"errors":self.errors,
            "selected_threads":self.selected_threads,"context_open":self.context_open,
            "wide_context_hidden":self.wide_context_hidden})
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
        self.saved_research_project().is_some()
            && matches!(self.navigation.current(), Some(crate::workspace::WorkspaceItem::Project(key)) if Some(key.as_str()) == self.selected_project.as_deref())
    }

    pub(crate) fn select_primary_project_agent(&mut self, key: &str) {
        if let Some(id) = key.strip_prefix("research:") {
            self.project_agents.selected_threads.remove(id);
        }
    }

    pub(crate) fn focus_project_composer(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.project_agents.context_open = false;
        let composer = self.chat.read(cx).composer.clone();
        composer.update(cx, |input, cx| input.focus(window, cx));
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
            if !self.project_agent_active() || self.selected_project.as_deref() != Some(key.as_str()) {
                self.project_tab = self.project_agents.right_tab(&project);
            }
            self.selected_project = Some(key.clone());
            self.navigation
                .open(crate::workspace::WorkspaceItem::Project(key));
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

    fn project_inspector_visible(&self, cx: &App) -> bool {
        self.project_agent_active()
            && !self.chat.read(cx).resource_pane_open()
            && if self.layout.narrow {
                self.project_agents.context_open
            } else {
                !self.project_agents.wide_context_hidden
            }
    }

    pub(crate) fn project_context_in_place(&self, cx: &App) -> bool {
        self.layout.narrow && self.project_inspector_visible(cx)
    }

    pub(crate) fn project_inspector_width(&self, viewport_width: f32, cx: &App) -> Option<f32> {
        if self.layout.narrow || !self.project_inspector_visible(cx) {
            return None;
        }
        let available = viewport_width - self.layout.sidebar_width;
        let width = self.chat.read(cx).artifact_pane_width()
            .clamp(PROJECT_INSPECTOR_MIN_WIDTH, PROJECT_INSPECTOR_MAX_WIDTH);
        Some(width.min(available - PROJECT_CHAT_MIN_WIDTH))
    }

    fn project_conversation_toolbar(&self, cx: &mut Context<Self>) -> AnyElement {
        let Some(project) = self.saved_research_project() else {
            return div().into_any_element();
        };
        let project_id = project.id.clone();
        let loading = self.project_agents.loading.contains(&project_id);
        let primary = self.project_agents.snapshot_for(&project_id).and_then(|snapshot| {
            snapshot.sessions.iter().find(|session| session.binding.parent_thread.is_none())
        });
        let primary_thread = primary.map(|session| session.thread_id.clone());
        let can_summarize = primary.is_some_and(|session| {
            !matches!(session.status.as_str(), "running" | "cancelling")
        });
        let chat = self.chat.read(cx);
        let binding = chat.active_chat.and_then(|index| chat.chats.get(index))
            .and_then(|chat| chat.project_agent.as_ref())
            .filter(|binding| binding.project_id == project_id);
        let has_session = binding.is_some();
        let role = binding.filter(|binding| binding.parent_thread.is_some())
            .map(|binding| binding.label.clone())
            .unwrap_or_else(|| self.t("project.agent.primary").to_owned());
        let inspector_visible = self.project_inspector_visible(cx);
        let chrome = pero_theme::Chrome::from_app(cx);
        div()
            .id("project-conversation-toolbar")
            .w_full()
            .h(chrome.control(pero_theme::ROW_NAV))
            .flex_shrink_0()
            .flex()
            .items_center()
            .gap(chrome.geo(pero_theme::SPACE_4))
            .px(chrome.geo(pero_theme::SPACE_12))
            .border_b(px(0.5))
            .border_color(chrome.palette.border)
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .overflow_hidden()
                    .text_ellipsis()
                    .whitespace_nowrap()
                    .text_size(chrome.text(pero_theme::TYPE_TAB))
                    .font_weight(FontWeight::MEDIUM)
                    .child(role),
            )
            .when_some(primary_thread, |el, thread| {
                el.child(
                    pero_theme::ghost_icon_button("project-agent-summarize", chrome, cx)
                        .icon(Icon::default().path("icons/sparkles.svg"))
                        .accessibility_label(self.t("project.agent.summarize"))
                        .tooltip(self.t("project.agent.summarize"))
                        .disabled(loading || !can_summarize)
                        .relative()
                        .child(self.view_bounds.projects.probe("agent:summarize".into()))
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.request_project_agents(
                                &project_id,
                                "summarize",
                                json!({"thread_id":thread}),
                                cx,
                            );
                        })),
                )
            })
            .child(
                pero_theme::ghost_icon_button("project-agent-refresh", chrome, cx)
                    .icon(Icon::default().path("icons/refresh.svg"))
                    .accessibility_label(self.t("remote.refresh"))
                    .tooltip(self.t("remote.refresh"))
                    .disabled(loading)
                    .relative()
                    .child(self.view_bounds.projects.probe("agent:refresh".into()))
                    .on_click(cx.listener(|this, _, _, cx| this.refresh_project_agents(cx))),
            )
            .when(has_session && !chat.resource_pane_open(), |el| {
                el.child(
                    pero_theme::ghost_icon_button("project-agent-artifacts", chrome, cx)
                        .icon(Icon::default().path("icons/box.svg"))
                        .accessibility_label(self.t("artifacts.title"))
                        .tooltip(self.t("artifacts.title"))
                        .relative()
                        .child(self.view_bounds.projects.probe("agent:artifacts".into()))
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.project_agents.context_open = false;
                            this.chat.update(cx, |chat, cx| {
                                chat.open_resource_tab(pero_contracts::workbench::ResourceTab::Artifacts, cx)
                            });
                            this.sync_follow(cx);
                            cx.notify();
                        })),
                )
            })
            .when(!inspector_visible, |el| {
                let label = self.t("project.inspector.show");
                el.child(
                    pero_theme::ghost_icon_button("show-project-inspector", chrome, cx)
                        .icon(Icon::default().path("icons/panel-right-open.svg"))
                        .accessibility_label(label)
                        .tooltip(label)
                        .relative()
                        .child(self.view_bounds.projects.probe("agent:materials".into()))
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.chat.update(cx, |chat, cx| chat.close_resource_pane(cx));
                            if this.layout.narrow {
                                this.project_agents.context_open = true;
                            } else {
                                this.project_agents.wide_context_hidden = false;
                            }
                            this.sync_follow(cx);
                            cx.notify();
                        })),
                )
            })
            .into_any_element()
    }

    pub(crate) fn project_context_toolbar(&self, cx: &mut Context<Self>) -> AnyElement {
        let narrow = self.layout.narrow;
        let chrome = pero_theme::Chrome::from_app(cx);
        let views = ProjectTab::ALL.map(|view| (view, self.t(view.label_key())));
        let current = self.project_tab;
        let workbench = cx.entity().downgrade();
        let menu = pero_theme::ghost_icon_button("project-inspector-views", chrome, cx)
            .icon(Icon::default().path("icons/dots.svg"))
            .accessibility_label(self.t("project.actions"))
            .tooltip(self.t("project.actions"))
            .relative()
            .child(self.view_bounds.projects.probe("agent:views-overflow".into()))
            .dropdown_menu_with_anchor(Anchor::TopRight, move |mut menu, _, _| {
                for (view, label) in views {
                    let activate = workbench.clone();
                    let item = PopupMenuItem::new(label)
                    .checked(current == view)
                    .on_click(move |_, _, cx| {
                        let _ = activate.update(cx, |this, cx| this.select_project_view(view, cx));
                    });
                    menu = menu.item(item);
                }
                menu
            });
        let close_label = self.t(if narrow { "project.inspector.back" } else { "project.inspector.hide" });
        let close = pero_theme::ghost_icon_button("close-project-inspector", chrome, cx)
            .icon(Icon::default().path(if narrow { "icons/arrow-left.svg" } else { "icons/x.svg" }))
            .accessibility_label(close_label)
            .tooltip(close_label)
            .relative()
            .child(self.view_bounds.projects.probe("agent:context-close".into()))
            .on_click(cx.listener(|this, _, window, cx| {
                if !this.layout.narrow {
                    this.project_agents.wide_context_hidden = true;
                }
                this.focus_project_composer(window, cx);
                this.sync_follow(cx);
                cx.notify();
            }));
        div()
            .id("project-context-toolbar")
            .relative()
            .child(self.view_bounds.projects.probe("agent:context-toolbar".into()))
            .w_full()
            .h_full()
            .min_w_0()
            .flex()
            .items_center()
            .gap(chrome.geo(pero_theme::SPACE_4))
            .px(chrome.geo(pero_theme::SPACE_4))
            .child(self.project_view_tabs(true, cx))
            .child(menu)
            .child(close)
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
        if self.project_context_in_place(cx) {
            let chrome = pero_theme::Chrome::from_app(cx);
            return div()
                .id("project-inspector-in-place")
                .size_full()
                .min_w_0()
                .min_h_0()
                .flex()
                .flex_col()
                .child(div()
                    .h(chrome.control(pero_theme::WINDOW_TITLEBAR))
                    .flex_shrink_0()
                    .border_b(px(0.5))
                    .border_color(p.border)
                    .child(self.project_context_toolbar(cx)))
                .child(self.project_context_body(cx))
                .into_any_element();
        }
        div()
            .id("project-agent-conversation")
            .size_full()
            .min_w_0()
            .min_h_0()
            .flex()
            .flex_col()
            .bg(p.surface)
            .relative()
            .child(self.view_bounds.projects.probe("agent:conversation".into()))
            .when_some(self.research.unavailable_workspaces.get(&id).filter(|path| Some(path.as_str()) == project.workspace.as_deref()), |el, path| {
                el.child(div().id("project-directory-alert").role(Role::Alert).flex().items_center().bg(p.error_bg).text_color(p.error).px(px(12.))
                    .child(div().flex_1().child(format!("{} · {path}", self.t("project.workspace_unavailable"))))
                    .child(Button::new("replace-project-directory").relative().child(self.view_bounds.projects.probe("repair-directory".into())).ghost().label(self.t("project.change_directory"))
                        .on_click(cx.listener(|this, _, window, cx| {
                            this.project_agents.context_open = true;
                            this.project_agents.wide_context_hidden = false;
                            this.select_project_view(crate::projects::ProjectTab::Overview, cx);
                            this.edit_research_project(false, window, cx);
                        }))))
            })
            .child(self.project_conversation_toolbar(cx))
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
            .child(div().flex_1().min_h_0().min_w_0().child(self.chat.clone()))
            .into_any_element()
    }

    pub(crate) fn project_context_body(&self, cx: &mut Context<Self>) -> AnyElement {
        let p = pero_theme::UiAppearance::global(cx).palette.clone();
        div()
            .id("project-agent-context")
            .flex_1()
            .min_w_0()
            .min_h_0()
            .flex()
            .flex_col()
            .overflow_hidden()
            .bg(p.bg)
            .relative()
            .child(self.view_bounds.projects.probe("agent:context".into()))
            .child(self.project_tab_content(true, cx))
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
