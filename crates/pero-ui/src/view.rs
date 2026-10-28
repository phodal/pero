use crate::{
    app::Workbench,
    components::{
        ActionHandler, Ui,
        sidebar::{self, SidebarAction, SidebarProps},
        task_detail::{self, SessionHeader, TaskDetailAction, TaskDetailProps},
        task_list::{self, SessionRow, TaskListAction, TaskListProps},
        workspace::{self, AgentRow, WorkspaceAction},
    },
};
use gpui_kit::{prelude::*, *};
use serde_json::json;
use std::rc::Rc;

impl Workbench {
    fn ui(&self) -> Ui<'_> {
        Ui {
            palette: self.palettes.get(self.dark),
            locale: &self.locale,
        }
    }

    pub fn icon(&self, name: &str) -> Svg {
        self.ui().icon(name)
    }

    fn sidebar(&self, width: f32, cx: &mut Context<Self>) -> Div {
        let on_action = Rc::new(cx.listener(|this, action: &SidebarAction, window, cx| {
            match action {
                SidebarAction::Navigate(index) => {
                    if *index == 3 {
                        this.open_remote(cx);
                    } else {
                        this.navigation = *index;
                        this.sync_follow(cx);
                    }
                }
                SidebarAction::ConfigureGitHub => {
                    this.open_remote(cx);
                    this.open_remote_connection(window, cx);
                }
                SidebarAction::ChooseWorkspace => {
                    this.command(json!({"action":"choose_workspace"}), cx)
                }
                SidebarAction::ToggleLocale => this.toggle_locale(cx),
                SidebarAction::ToggleTheme => {
                    this.dark = !this.dark;
                    this.palettes.apply(this.dark, cx);
                }
            }
            cx.notify();
        }));
        sidebar::sidebar(
            self.ui(),
            width,
            SidebarProps {
                navigation: self.navigation,
                connected: self.connected,
                dark: self.dark,
            },
            on_action,
        )
    }

    fn task_list(&self, width: f32, cx: &mut Context<Self>) -> Div {
        let sessions: Vec<_> = self
            .chats
            .iter()
            .map(|chat| SessionRow {
                title: chat.title.clone(),
                agent: chat.agent.clone(),
                busy: chat.busy(),
            })
            .collect();
        let on_action = Rc::new(cx.listener(|this, action: &TaskListAction, _, cx| {
            match action {
                TaskListAction::SelectSession(index) => this.focus_chat(Some(*index), 4, cx),
            }
            cx.notify();
        }));
        task_list::task_list(
            self.ui(),
            width,
            TaskListProps {
                search: &self.search,
                query: self.search.read(cx).value().to_lowercase(),
                sessions: &sessions,
                active_chat: self.active_chat,
            },
            on_action,
        )
    }

    fn detail(&self, window: &mut Window, cx: &mut Context<Self>) -> Div {
        let session = self
            .active_chat
            .and_then(|i| self.chats.get(i))
            .map(|chat| SessionHeader {
                title: chat.title.clone(),
                agent: chat.agent.clone(),
                closed: chat.state == "closed",
            });
        let content = if self.tab == 4 {
            self.chat_view(window, cx).into_any_element()
        } else {
            let ui = self.ui();
            div()
                .id("detail-content")
                .flex_1()
                .min_h_0()
                .overflow_y_scroll()
                .p(px(20.))
                .when(self.tab == 0 && session.is_none(), |el| {
                    el.child(ui.t("chat.welcome"))
                })
                .when(self.tab == 0 && session.is_some(), |el| {
                    el.child(ui.t("chat.open_tab"))
                })
                .when(self.tab == 1, |el| el.child(ui.t("chat.no_changes")))
                .when(self.tab == 2, |el| el.child(ui.t("chat.no_verification")))
                .when(self.tab == 3, |el| {
                    el.children(self.events.iter().map(|event| {
                        div()
                            .py(px(8.))
                            .border_b_1()
                            .border_color(ui.palette.color("border"))
                            .child(self.event_text(event))
                    }))
                })
                .into_any_element()
        };
        let on_action = Rc::new(cx.listener(
            |this, action: &TaskDetailAction, _, cx| match action {
                TaskDetailAction::NewSession => this.new_chat(cx),
                TaskDetailAction::CloseSession => {
                    if let Some(chat) = this.active_chat.and_then(|i| this.chats.get(i)) {
                        let id = chat.id.clone();
                        this.command(json!({"action":"close","thread_id":id}), cx);
                    }
                }
                TaskDetailAction::SelectTab(tab) => this.focus_chat(this.active_chat, *tab, cx),
            },
        ));
        task_detail::task_detail(
            self.ui(),
            TaskDetailProps {
                session,
                tab: self.tab,
            },
            content,
            on_action,
        )
    }

    fn workspace_actions(&self, cx: &mut Context<Self>) -> ActionHandler<WorkspaceAction> {
        Rc::new(
            cx.listener(|this, action: &WorkspaceAction, _, cx| match action {
                WorkspaceAction::ChooseWorkspace => {
                    this.command(json!({"action":"choose_workspace"}), cx)
                }
                WorkspaceAction::NewSession(index) => {
                    this.agent_index = *index;
                    this.new_chat(cx);
                }
            }),
        )
    }

    fn projects(&self, cx: &mut Context<Self>) -> Div {
        workspace::projects(self.ui(), &self.workspace, self.workspace_actions(cx))
    }

    fn environments(&self, cx: &mut Context<Self>) -> Div {
        let agents: Vec<_> = self
            .agents
            .iter()
            .map(|agent| AgentRow {
                name: agent.name.clone(),
                available: agent.available,
            })
            .collect();
        workspace::environments(self.ui(), &agents, self.workspace_actions(cx))
    }
}

impl Render for Workbench {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if self.input_locale != self.locale {
            self.input_locale = self.locale.clone();
            let placeholder = self.t("chat.placeholder");
            self.composer.update(cx, |input, cx| {
                input.set_placeholder(placeholder, window, cx)
            });
            let placeholder = self.t("sessions.search");
            self.search.update(cx, |input, cx| {
                input.set_placeholder(placeholder, window, cx)
            });
            let placeholder = self.t("input.placeholder");
            self.input.update(cx, |input, cx| {
                input.set_placeholder(placeholder, window, cx)
            });
        }
        let p = self.palettes.get(self.dark);
        let width: f32 = window.viewport_size().width.into();
        let compact = width < 1150.;
        div()
            .size_full()
            .flex()
            .bg(p.color("surface"))
            .text_color(p.color("text"))
            .font_family("Noto Sans CJK SC")
            .text_size(px(13.))
            .child(self.sidebar(if compact { 168. } else { 192. }, cx))
            .when(self.navigation == 3, |el| {
                el.child(self.remote_view(width < 1050., cx))
            })
            .when(self.navigation == 0, |el| {
                el.child(self.task_list(if compact { 300. } else { 360. }, cx))
                    .child(self.detail(window, cx))
            })
            .when(self.navigation == 1, |el| el.child(self.projects(cx)))
            .when(self.navigation == 2, |el| el.child(self.environments(cx)))
    }
}
