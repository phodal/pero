use crate::app::Workbench;
use crate::workspace::{ConversationTab, WorkbenchPage};
use gpui_kit::{
    component::{button::*, input::Input, *},
    prelude::*,
    *,
};
use pero_contracts::{
    HostEvent,
    roadmap::{LocalRoadmap, RoadmapError},
};
use serde::Serialize;
use serde_json::json;

#[derive(Default, Serialize)]
pub(crate) struct RoadmapState {
    pub data: Option<LocalRoadmap>,
    pub selected_line: Option<usize>,
    pub show_cloud: bool,
    pub show_completed: bool,
    pub loading: bool,
    #[serde(skip)]
    sessions: Vec<RoadmapSession>,
}

struct RoadmapSession {
    workspace: String,
    path: String,
    goal: String,
    thread_id: String,
}

impl Workbench {
    pub(crate) fn receive_roadmap(&mut self, event: &HostEvent, cx: &mut Context<Self>) -> bool {
        if event.kind != "local_roadmap" {
            return false;
        }
        if let Ok(data) = serde_json::from_value::<LocalRoadmap>(event.data.clone()) {
            self.local_roadmap.data = Some(data);
            self.local_roadmap.loading = false;
            self.local_roadmap.selected_line = None;
        }
        cx.notify();
        true
    }

    pub(crate) fn project_tasks(&self, narrow: bool, cx: &mut Context<Self>) -> impl IntoElement {
        let local = self
            .current_project(cx)
            .is_some_and(|project| project.workspace.is_some());
        div()
            .flex_1()
            .min_h_0()
            .flex()
            .flex_col()
            .when(local, |el| {
                el.child(
                    div().px(px(24.)).py(px(8.)).flex().gap(px(8.)).children(
                        [(false, "roadmap.local"), (true, "roadmap.cloud")]
                            .into_iter()
                            .enumerate()
                            .map(|(i, (cloud, key))| {
                                Button::new(("task-location", i))
                                    .ghost()
                                    .small()
                                    .label(self.t(key))
                                    .toggled(self.local_roadmap.show_cloud == cloud)
                                    .on_click(cx.listener(move |this, _, _, cx| {
                                        this.local_roadmap.show_cloud = cloud;
                                        cx.notify();
                                    }))
                            }),
                    ),
                )
            })
            .when(local && !self.local_roadmap.show_cloud, |el| {
                el.child(self.local_roadmap_view(cx))
            })
            .when(!local || self.local_roadmap.show_cloud, |el| {
                el.child(self.remote_view(narrow, cx))
            })
    }

    fn start_roadmap_item(&mut self, cx: &mut Context<Self>) {
        let Some(data) = &self.local_roadmap.data else {
            return;
        };
        let Some(item) = data
            .items
            .iter()
            .find(|item| Some(item.line) == self.local_roadmap.selected_line)
        else {
            return;
        };
        if item.checked
            || self.workspace != data.workspace
            || !self.connected
            || self.local_roadmap.loading
        {
            return;
        }
        if let Some(index) = self
            .local_roadmap
            .sessions
            .iter()
            .find(|session| {
                session.workspace == data.workspace
                    && session.path == data.path
                    && session.goal == item.text
            })
            .and_then(|session| {
                self.chat
                    .read(cx)
                    .chats
                    .iter()
                    .position(|chat| chat.id == session.thread_id)
            })
        {
            self.navigate(WorkbenchPage::Conversation, cx);
            self.focus_chat(Some(index), ConversationTab::Chat, cx);
            return;
        }
        if !self
            .chat
            .read(cx)
            .agents
            .get(self.chat.read(cx).agent_index)
            .is_some_and(|agent| agent.available)
        {
            return;
        }
        let prompt = item.prompt(&data.path);
        let workspace = data.workspace.clone();
        let path = data.path.clone();
        let goal = item.text.clone();
        self.new_chat(cx);
        let thread_id = self.chat.update(cx, |panel, cx| {
            panel.submit_prompt(prompt, vec![], cx);
            panel.chats[panel.active_chat.expect("new roadmap chat")].id.clone()
        });
        self.local_roadmap.sessions.push(RoadmapSession {
            workspace,
            path,
            goal,
            thread_id,
        });
    }

    fn local_roadmap_view(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let p = &pero_theme::UiAppearance::global(cx).palette.clone();
        let agents = self.chat.read(cx).agents.clone();
        let agent_index = self.chat.read(cx).agent_index;
        let workspace = self
            .current_project(cx)
            .and_then(|project| project.workspace)
            .unwrap_or_default();
        let data = self
            .local_roadmap
            .data
            .as_ref()
            .filter(|data| data.workspace == workspace);
        let loading = self.local_roadmap.loading || data.is_none();
        let selected = data.and_then(|data| {
            data.items
                .iter()
                .find(|item| Some(item.line) == self.local_roadmap.selected_line)
        });
        let query = self.remote.search.read(cx).value().to_lowercase();
        let items = data.map(|data| data.items.as_slice()).unwrap_or(&[]);
        let visible = items
            .iter()
            .filter(|item| {
                (self.local_roadmap.show_completed || !item.checked)
                    && (query.is_empty()
                        || format!("{} {}", item.text, item.headings.join(" "))
                            .to_lowercase()
                            .contains(&query))
            })
            .collect::<Vec<_>>();
        div()
            .flex_1()
            .min_h_0()
            .flex()
            .flex_col()
            .child(
                div()
                    .px(px(24.))
                    .py(px(10.))
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .child(
                        div()
                            .flex_1()
                            .text_size(pero_theme::UiAppearance::global(cx).text(pero_theme::TextRole::Caption))
                            .text_color(p.text_muted)
                            .child(if loading {
                                self.t("roadmap.loading").into()
                            } else {
                                data.map(|data| data.path.clone()).unwrap_or_default()
                            }),
                    )
                    .child(
                        Button::new("local-roadmap-refresh")
                            .ghost()
                            .small()
                            .label(self.t("remote.refresh"))
                            .disabled(self.local_roadmap.loading || !self.connected)
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.local_roadmap.loading = true;
                                this.command(json!({"action":"load_roadmap"}), cx);
                            })),
                    ),
            )
            .when(data.and_then(|data| data.error.as_ref()).is_some(), |el| {
                el.child(
                    div()
                        .id("local-roadmap-error")
                        .px(px(24.))
                        .py(px(16.))
                        .role(Role::Alert)
                        .whitespace_normal()
                        .child(self.t(match data.unwrap().error.as_ref().unwrap() {
                            RoadmapError::NotFound => "roadmap.not_found",
                            RoadmapError::Read => "roadmap.read_error",
                            RoadmapError::Invalid => "roadmap.invalid",
                        })),
                )
            })
            .when(
                selected.is_none() && data.is_some_and(|data| data.error.is_none()),
                |el| {
                    el.child(
                        div()
                            .px(px(24.))
                            .pb(px(12.))
                            .flex()
                            .items_center()
                            .gap(px(8.))
                            .child(
                                div().flex_1().min_w_0().child(
                                    Input::new(&self.remote.search)
                                        .prefix(self.icon("search"))
                                        .w_full(),
                                ),
                            )
                            .child(
                                Button::new("local-roadmap-completed")
                                    .ghost()
                                    .small()
                                    .label(self.t("roadmap.show_completed"))
                                    .toggled(self.local_roadmap.show_completed)
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.local_roadmap.show_completed =
                                            !this.local_roadmap.show_completed;
                                        cx.notify();
                                    })),
                            ),
                    )
                    .child(
                        div()
                            .id("local-roadmap-list")
                            .flex_1()
                            .min_h_0()
                            .overflow_y_scroll()
                            .px(px(24.))
                            .when(visible.is_empty(), |el| {
                                el.child(
                                    div()
                                        .py(px(20.))
                                        .text_color(p.text_muted)
                                        .child(self.t("roadmap.empty")),
                                )
                            })
                            .children(visible.iter().map(|item| {
                                let line = item.line;
                                div()
                                    .py(px(4.))
                                    .border_b_1()
                                    .border_color(p.border)
                                    .child(
                                        Button::new(("local-roadmap-item", line))
                                            .ghost()
                                            .w_full()
                                            .h_auto()
                                            .min_h(px(56.))
                                            .justify_start()
                                            .accessibility_label(item.title.clone())
                                            .child(
                                                div()
                                                    .flex_1()
                                                    .min_w_0()
                                                    .flex()
                                                    .flex_col()
                                                    .items_start()
                                                    .pl(px(if item.parent_line.is_some() {
                                                        16.
                                                    } else {
                                                        0.
                                                    }))
                                                    .child(div().whitespace_normal().child(
                                                        format!(
                                                            "{}{}",
                                                            if item.checked { "✓ " } else { "" },
                                                            item.title
                                                        ),
                                                    ))
                                                    .child(
                                                        div()
                                                            .w_full()
                                                            .truncate()
                                                            .mt(px(3.))
                                                            .text_size(pero_theme::UiAppearance::global(cx).text(pero_theme::TextRole::Caption))
                                                            .text_color(p.text_muted)
                                                            .child(format!(
                                                                "{} · L{}",
                                                                item.headings.join(" / "),
                                                                line
                                                            )),
                                                    ),
                                            )
                                            .on_click(cx.listener(move |this, _, _, cx| {
                                                this.local_roadmap.selected_line = Some(line);
                                                cx.notify();
                                            })),
                                    )
                            })),
                    )
                },
            )
            .when_some(selected, |el, item| {
                let session = data
                    .and_then(|data| {
                        self.local_roadmap.sessions.iter().find(|session| {
                            session.workspace == data.workspace
                                && session.path == data.path
                                && session.goal == item.text
                        })
                    })
                    .and_then(|session| {
                        self.chat
                            .read(cx)
                            .chats
                            .iter()
                            .find(|chat| chat.id == session.thread_id)
                            .map(|chat| chat.state.as_str().to_owned())
                    });
                el.child(
                    div()
                        .id("local-roadmap-detail")
                        .flex_1()
                        .min_h_0()
                        .overflow_y_scroll()
                        .px(px(24.))
                        .py(px(12.))
                        .child(
                            Button::new("local-roadmap-back")
                                .ghost()
                                .small()
                                .label(self.t("project.back_tasks"))
                                .on_click(cx.listener(|this, _, _, cx| {
                                    this.local_roadmap.selected_line = None;
                                    cx.notify();
                                })),
                        )
                        .child(
                            div()
                                .mt(px(16.))
                                .text_size(pero_theme::UiAppearance::global(cx).text(pero_theme::TextRole::Title))
                                .font_weight(FontWeight::BOLD)
                                .whitespace_normal()
                                .child(item.title.clone()),
                        )
                        .child(
                            div()
                                .mt(px(8.))
                                .text_size(pero_theme::UiAppearance::global(cx).text(pero_theme::TextRole::Caption))
                                .text_color(p.text_muted)
                                .whitespace_normal()
                                .child(format!("{} · L{}", item.headings.join(" / "), item.line)),
                        )
                        .child(
                            div()
                                .mt(px(16.))
                                .whitespace_normal()
                                .child(item.text.clone()),
                        )
                        .when(item.checked, |el| {
                            el.child(
                                div()
                                    .mt(px(16.))
                                    .text_color(p.text_muted)
                                    .child(self.t("roadmap.source_completed")),
                            )
                        })
                        .when(!item.checked, |el| {
                            el.child(
                                div()
                                    .mt(px(20.))
                                    .flex()
                                    .flex_wrap()
                                    .gap(px(8.))
                                    .children(agents.iter().enumerate().map(|(i, agent)| {
                                        Button::new(("roadmap-agent", i))
                                            .ghost()
                                            .small()
                                            .label(agent.name.clone())
                                            .toggled(agent_index == i)
                                            .disabled(!agent.available || session.is_some())
                                            .on_click(cx.listener(move |this, _, _, cx| {
                                                this.chat
                                                    .update(cx, |chat, _| chat.agent_index = i);
                                                cx.notify();
                                            }))
                                    }))
                                    .child(
                                        Button::new("local-roadmap-start")
                                            .primary()
                                            .label(self.t(if session.is_some() {
                                                "roadmap.open_chat"
                                            } else {
                                                "roadmap.execute"
                                            }))
                                            .disabled(
                                                loading
                                                    || !self.connected
                                                    || self.workspace != workspace
                                                    || session.is_none()
                                                        && !agents
                                                            .get(agent_index)
                                                            .is_some_and(|agent| agent.available),
                                            )
                                            .on_click(cx.listener(|this, _, _, cx| {
                                                this.start_roadmap_item(cx)
                                            })),
                                    ),
                            )
                            .when(
                                session.is_none() && !agents.iter().any(|agent| agent.available),
                                |el| {
                                    el.child(
                                        div()
                                            .mt(px(12.))
                                            .whitespace_normal()
                                            .child(self.t("roadmap.no_agent")),
                                    )
                                },
                            )
                            .when_some(session, |el, chat| {
                                el.child(div().mt(px(12.)).text_color(p.text_muted).child(
                                    self.t(match chat.as_str() {
                                        "running" | "connecting" => "roadmap.running",
                                        "idle" => "roadmap.finished",
                                        "auth_required" => "roadmap.auth_required",
                                        _ => "roadmap.attention",
                                    }),
                                ))
                            })
                        }),
                )
            })
    }
}
