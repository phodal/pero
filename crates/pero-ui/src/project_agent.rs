//! Project collaboration consumes Host-owned ACP sessions and their journal projections.
use crate::{app::Workbench, projects::ProjectTab};
use gpui_kit::{
    component::{
        button::*,
        input::{InputEvent, Textarea, TextareaState},
        menu::{DropdownMenu, PopupMenuItem},
        *,
    },
    prelude::*,
    *,
};
use pero_contracts::{
    HostEvent,
    project_agent::{ProjectAgentSession, ProjectAgentSnapshot},
};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Default)]
pub(crate) struct ProjectAgentsView {
    snapshots: BTreeMap<String, ProjectAgentSnapshot>,
    pending: BTreeMap<String, (String, String)>,
    loading: BTreeSet<String>,
    dirty: BTreeSet<String>,
    errors: BTreeMap<String, String>,
    selected_agent: Option<String>,
    instruction: Option<ProjectInstruction>,
}
struct ProjectInstruction {
    project_id: String,
    thread_id: String,
    label: String,
    input: Entity<TextareaState>,
    _subscription: Subscription,
}
impl ProjectAgentsView {
    #[cfg(target_family = "wasm")]
    pub fn snapshot(&self, cx: &App) -> Value {
        json!({"snapshots":self.snapshots,"loading":self.loading,"errors":self.errors,
            "instruction":self.instruction.as_ref().map(|item|json!({"project_id":item.project_id,"thread_id":item.thread_id,"text":item.input.read(cx).value().as_ref()}))})
    }
}

impl Workbench {
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
        self.refresh_project_agents(cx);
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
                .and_then(|id| self.project_agents.pending.remove(id));
            let project = pending
                .as_ref()
                .map(|(project, _)| project.clone())
                .or_else(|| event.data["project_id"].as_str().map(str::to_owned));
            if let Some(project) = project {
                let refresh =
                    self.project_agents.dirty.remove(&project) && event.kind == "project_agent";
                if !self
                    .project_agents
                    .pending
                    .values()
                    .any(|(id, _)| id == &project)
                {
                    self.project_agents.loading.remove(&project);
                }
                if event.kind == "project_agent_error" {
                    self.project_agents
                        .errors
                        .insert(project.clone(), event.text.clone());
                } else {
                    match serde_json::from_value::<ProjectAgentSnapshot>(event.data.clone()) {
                        Ok(snapshot) => {
                            let selected = snapshot.selected_thread.clone();
                            self.project_agents
                                .snapshots
                                .insert(project.clone(), snapshot);
                            if pending
                                .as_ref()
                                .is_some_and(|(_, action)| action == "followup")
                                && self
                                    .project_agents
                                    .instruction
                                    .as_ref()
                                    .is_some_and(|item| item.project_id == project)
                            {
                                self.project_agents.instruction = None;
                            }
                            if self
                                .saved_research_project()
                                .is_some_and(|current| current.id == project)
                            {
                                if let Some(thread) = selected {
                                    self.open_project_agent_session(&thread, cx);
                                }
                            }
                        }
                        Err(_) => {
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
            for (project, _) in self.project_agents.pending.values() {
                self.project_agents
                    .errors
                    .insert(project.clone(), self.t("error.connection").into());
            }
            self.project_agents.pending.clear();
            self.project_agents.loading.clear();
            self.project_agents.dirty.clear();
        }
        if self.project_tab == ProjectTab::Agent
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
    fn open_project_agent_session(&mut self, thread: &str, cx: &mut Context<Self>) {
        let index = self
            .chat
            .read(cx)
            .chats
            .iter()
            .position(|chat| chat.id == thread);
        if let Some(index) = index {
            self.chat.update(cx, |chat, cx| {
                chat.set_scope(None, cx);
                chat.focus_chat(Some(index), cx);
            });
            self.tab = crate::workspace::ConversationTab::Chat;
            self.set_chat_dock(true, cx);
        }
    }
    fn project_instruction(
        &mut self,
        session: &ProjectAgentSession,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let input = cx.new(|cx| TextareaState::new(window, cx));
        let subscription = cx.subscribe(&input, |_, _, _: &InputEvent, cx| cx.notify());
        self.project_agents.instruction = Some(ProjectInstruction {
            project_id: session.binding.project_id.clone(),
            thread_id: session.thread_id.clone(),
            label: session.binding.label.clone(),
            input: input.clone(),
            _subscription: subscription,
        });
        input.update(cx, |input, cx| input.focus(window, cx));
        cx.notify();
    }
    fn send_project_instruction(&mut self, cx: &mut Context<Self>) {
        let Some(item) = self.project_agents.instruction.as_ref() else {
            return;
        };
        let (project, thread, prompt) = (
            item.project_id.clone(),
            item.thread_id.clone(),
            item.input.read(cx).value().to_string(),
        );
        if prompt.trim().is_empty() {
            return;
        }
        self.request_project_agents(
            &project,
            "followup",
            json!({"thread_id":thread,"prompt":prompt}),
            cx,
        );
    }
    pub(crate) fn project_agent_view(&self, cx: &mut Context<Self>) -> AnyElement {
        let p = pero_theme::UiAppearance::global(cx).palette.clone();
        let Some(project) = self.saved_research_project() else {
            return div().into_any_element();
        };
        let id = project.id.clone();
        let snapshot = self.project_agents.snapshots.get(&id);
        let loading = self.project_agents.loading.contains(&id);
        let error = self.project_agents.errors.get(&id);
        let primary = snapshot.and_then(|snapshot| {
            snapshot
                .sessions
                .iter()
                .find(|session| session.binding.parent_thread.is_none())
        });
        let children = snapshot
            .map(|snapshot| {
                snapshot
                    .sessions
                    .iter()
                    .filter(|session| session.binding.parent_thread.is_some())
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let agents = self
            .chat
            .read(cx)
            .agents
            .iter()
            .filter(|agent| agent.available)
            .cloned()
            .collect::<Vec<_>>();
        let selected = self
            .project_agents
            .selected_agent
            .as_ref()
            .and_then(|id| agents.iter().find(|agent| &agent.id == id))
            .or_else(|| agents.get(self.chat.read(cx).agent_index))
            .or_else(|| agents.first());
        let agent_id = selected.map(|agent| agent.id.clone()).unwrap_or_default();
        let selected_id = agent_id.clone();
        let owner = cx.entity().downgrade();
        let agent_label = selected
            .map(|agent| agent.name.clone())
            .unwrap_or_else(|| self.t("project.agent.no_agent").into());
        div()
            .id("project-agent")
            .flex_1()
            .min_h_0()
            .overflow_y_scroll()
            .p(px(pero_theme::WorkbenchStyle::PAGE))
            .flex()
            .flex_col()
            .gap(px(16.))
            .child(
                div()
                    .flex()
                    .items_center()
                    .flex_wrap()
                    .gap(px(8.))
                    .child(
                        div()
                            .flex_1()
                            .font_weight(FontWeight::SEMIBOLD)
                            .child(self.t("project.agent")),
                    )
                    .child(
                        Button::new("project-agent-refresh")
                            .ghost()
                            .label(self.t("remote.refresh"))
                            .disabled(loading)
                            .relative()
                            .child(self.view_bounds.projects.probe("agent:refresh".into()))
                            .on_click(
                                cx.listener(|this, _, _, cx| this.refresh_project_agents(cx)),
                            ),
                    ),
            )
            .child(
                div()
                    .max_w(px(760.))
                    .whitespace_normal()
                    .text_color(p.text_muted)
                    .child(self.t("project.agent.hint")),
            )
            .when_some(error, |el, error| {
                el.child(
                    div()
                        .id("project-agent-error")
                        .role(Role::Alert)
                        .text_color(p.error)
                        .whitespace_normal()
                        .child(error.clone()),
                )
            })
            .when(loading, |el| {
                el.child(
                    div()
                        .id("project-agent-loading")
                        .role(Role::Status)
                        .text_color(p.text_muted)
                        .child(self.t("project.agent.loading")),
                )
            })
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(4.))
                    .child(
                        div()
                            .font_weight(FontWeight::MEDIUM)
                            .child(self.t("research.goal")),
                    )
                    .child(div().whitespace_normal().child(if project.goal.is_empty() {
                        self.t("research.goal_empty").into()
                    } else {
                        project.goal.clone()
                    }))
                    .child(
                        div()
                            .text_color(p.text_muted)
                            .whitespace_normal()
                            .child(format!(
                                "{}: {}",
                                self.t("research.linked"),
                                project.resources.len()
                            )),
                    ),
            )
            .when(primary.is_none() && snapshot.is_some(), |el| {
                el.child(
                    div()
                        .flex()
                        .flex_wrap()
                        .gap(px(8.))
                        .items_center()
                        .child(
                            Button::new("project-agent-choice")
                                .outline()
                                .label(agent_label)
                                .dropdown_caret(true)
                                .disabled(loading || agents.is_empty())
                                .dropdown_menu(move |mut menu, _, _| {
                                    for agent in &agents {
                                        let owner = owner.clone();
                                        let id = agent.id.clone();
                                        menu = menu.item(
                                            PopupMenuItem::new(agent.name.clone())
                                                .checked(agent.id == selected_id)
                                                .on_click(move |_, _, cx| {
                                                    let _ = owner.update(cx, |this, cx| {
                                                        this.project_agents.selected_agent =
                                                            Some(id.clone());
                                                        cx.notify();
                                                    });
                                                }),
                                        );
                                    }
                                    menu
                                }),
                        )
                        .child(
                            Button::new("project-agent-start")
                                .primary()
                                .label(self.t("project.agent.start"))
                                .disabled(loading || agent_id.is_empty())
                                .relative()
                                .child(self.view_bounds.projects.probe("agent:start".into()))
                                .on_click(cx.listener(move |this, _, _, cx| {
                                    this.request_project_agents(
                                        &id,
                                        "start",
                                        json!({"project_id":id,"agent_id":agent_id}),
                                        cx,
                                    )
                                })),
                        ),
                )
            })
            .when_some(primary, |el, session| {
                el.child(self.project_agent_row(session, true, loading, cx))
            })
            .when(!children.is_empty(), |el| {
                el.child(
                    div()
                        .font_weight(FontWeight::SEMIBOLD)
                        .child(self.t("project.agent.children")),
                )
            })
            .children(
                children
                    .into_iter()
                    .map(|session| self.project_agent_row(session, false, loading, cx)),
            )
            .when(
                primary.is_some() && snapshot.is_some_and(|snapshot| snapshot.sessions.len() == 1),
                |el| {
                    el.child(
                        div()
                            .text_color(p.text_muted)
                            .whitespace_normal()
                            .child(self.t("project.agent.empty")),
                    )
                },
            )
            .when_some(
                self.project_agents
                    .instruction
                    .as_ref()
                    .filter(|item| item.project_id == project.id),
                |el, item| {
                    el.child(
                        div()
                            .flex()
                            .flex_col()
                            .gap(px(8.))
                            .max_w(px(760.))
                            .child(
                                div()
                                    .font_weight(FontWeight::MEDIUM)
                                    .whitespace_normal()
                                    .child(format!(
                                        "{} · {}",
                                        self.t("project.agent.followup"),
                                        item.label
                                    )),
                            )
                            .child(
                                div()
                                    .relative()
                                    .child(
                                        Textarea::new(&item.input)
                                            .aria_label(self.t("project.agent.instruction"))
                                            .h(px(96.))
                                            .disabled(loading),
                                    )
                                    .child(
                                        self.view_bounds.projects.probe("agent:instruction".into()),
                                    ),
                            )
                            .child(
                                div()
                                    .flex()
                                    .gap(px(8.))
                                    .child(
                                        Button::new("project-agent-send")
                                            .primary()
                                            .label(self.t("project.agent.send"))
                                            .disabled(
                                                loading
                                                    || item
                                                        .input
                                                        .read(cx)
                                                        .value()
                                                        .trim()
                                                        .is_empty(),
                                            )
                                            .relative()
                                            .child(
                                                self.view_bounds
                                                    .projects
                                                    .probe("agent:send".into()),
                                            )
                                            .on_click(cx.listener(|this, _, _, cx| {
                                                this.send_project_instruction(cx)
                                            })),
                                    )
                                    .child(
                                        Button::new("project-agent-dismiss")
                                            .ghost()
                                            .label(self.t("worker.local.cancel"))
                                            .disabled(loading)
                                            .on_click(cx.listener(|this, _, _, cx| {
                                                this.project_agents.instruction = None;
                                                cx.notify();
                                            })),
                                    ),
                            ),
                    )
                },
            )
            .into_any_element()
    }
    fn project_agent_row(
        &self,
        session: &ProjectAgentSession,
        primary: bool,
        loading: bool,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let p = pero_theme::UiAppearance::global(cx).palette.clone();
        let thread = session.thread_id.clone();
        let followup = session.clone();
        let cancel_thread = thread.clone();
        let project = session.binding.project_id.clone();
        let summary_thread = thread.clone();
        let summary_project = project.clone();
        let mut preview = session.result.chars().take(600).collect::<String>();
        let excerpt = session.result.chars().count() > 600;
        if excerpt {
            preview.push('…');
        }
        let status_key = match session.status.as_str() {
            "running" => "filter.running",
            "completed" => "research.completed",
            "failed" => "research.failed",
            "cancelled" => "project.agent.cancelled",
            "cancelling" => "project.agent.cancelling",
            "needs_input" => "project.agent.needs_input",
            "interrupted" => "project.agent.interrupted",
            _ => "research.idle",
        };
        div()
            .id(SharedString::from(format!(
                "project-agent-session:{thread}"
            )))
            .py(px(12.))
            .border_b(px(0.5))
            .border_color(p.border)
            .flex()
            .flex_col()
            .gap(px(8.))
            .child(
                div()
                    .flex()
                    .items_center()
                    .flex_wrap()
                    .gap(px(8.))
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .whitespace_normal()
                            .font_weight(FontWeight::MEDIUM)
                            .child(if primary {
                                self.t("project.agent.primary").into()
                            } else {
                                session.binding.label.clone()
                            }),
                    )
                    .child(
                        div()
                            .text_color(
                                if matches!(session.status.as_str(), "failed" | "interrupted") {
                                    p.error
                                } else if session.status == "needs_input" {
                                    p.warning
                                } else {
                                    p.text_muted
                                },
                            )
                            .child(self.t(status_key)),
                    ),
            )
            .child(
                div()
                    .text_color(p.text_muted)
                    .text_size(px(12.))
                    .whitespace_normal()
                    .child(format!("{} · {}", session.agent_id, session.workspace)),
            )
            .when_some(session.error.as_ref(), |el, error| {
                el.child(
                    div()
                        .id(SharedString::from(format!(
                            "project-agent-error:{}",
                            session.thread_id
                        )))
                        .role(Role::Alert)
                        .text_color(p.error)
                        .whitespace_normal()
                        .child(error.clone()),
                )
            })
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .gap(px(8.))
                    .child(
                        Button::new(SharedString::from(format!("agent-open:{thread}")))
                            .outline()
                            .label(self.t("project.agent.open"))
                            .relative()
                            .child(
                                self.view_bounds
                                    .projects
                                    .probe(format!("agent:open:{thread}")),
                            )
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.open_project_agent_session(&thread, cx)
                            })),
                    )
                    .child(
                        Button::new(SharedString::from(format!(
                            "agent-followup:{}",
                            session.thread_id
                        )))
                        .ghost()
                        .label(self.t("project.agent.followup"))
                        .disabled(loading || session.status == "cancelling")
                        .relative()
                        .child(
                            self.view_bounds
                                .projects
                                .probe(format!("agent:followup:{}", session.thread_id)),
                        )
                        .on_click(cx.listener(
                            move |this, _, window, cx| {
                                this.project_instruction(&followup, window, cx)
                            },
                        )),
                    )
                    .when(
                        session.active
                            && matches!(
                                session.status.as_str(),
                                "running" | "needs_input" | "cancelling"
                            ),
                        |el| {
                            el.child(
                                Button::new(SharedString::from(format!(
                                    "agent-cancel:{}",
                                    session.thread_id
                                )))
                                .ghost()
                                .label(self.t("worker.local.cancel"))
                                .disabled(loading || session.status == "cancelling")
                                .relative()
                                .child(
                                    self.view_bounds
                                        .projects
                                        .probe(format!("agent:cancel:{}", session.thread_id)),
                                )
                                .on_click(cx.listener(
                                    move |this, _, _, cx| {
                                        this.request_project_agents(
                                            &project,
                                            "cancel",
                                            json!({"thread_id":cancel_thread}),
                                            cx,
                                        )
                                    },
                                )),
                            )
                        },
                    )
                    .when(primary, |el| {
                        el.child(
                            Button::new("project-agent-summarize")
                                .ghost()
                                .label(self.t("project.agent.summarize"))
                                .disabled(
                                    loading
                                        || matches!(
                                            session.status.as_str(),
                                            "running" | "cancelling"
                                        ),
                                )
                                .relative()
                                .child(self.view_bounds.projects.probe("agent:summarize".into()))
                                .on_click(cx.listener(move |this, _, _, cx| {
                                    this.request_project_agents(
                                        &summary_project,
                                        "summarize",
                                        json!({"thread_id":summary_thread}),
                                        cx,
                                    )
                                })),
                        )
                    }),
            )
            .when(!session.evidence.is_empty(), |el| {
                el.child(
                    div()
                        .text_color(p.text_muted)
                        .text_size(px(12.))
                        .whitespace_normal()
                        .child(format!(
                            "{}: {} · {}",
                            self.t("project.agent.tool_evidence"),
                            session.evidence.len(),
                            self.t("project.agent.open_evidence")
                        )),
                )
            })
            .when(!preview.is_empty(), |el| {
                el.child(div().max_w(px(900.)).whitespace_normal().child(preview))
                    .when(excerpt, |el| {
                        el.child(
                            div()
                                .text_color(p.text_muted)
                                .text_size(px(12.))
                                .whitespace_normal()
                                .child(self.t("project.agent.excerpt")),
                        )
                    })
            })
            .into_any_element()
    }
}
