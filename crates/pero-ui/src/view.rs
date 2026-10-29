use crate::remote_view::phase;
use crate::{
    app::Workbench,
    components::{
        ActionHandler, Ui,
        sidebar::{self, DeleteAffordance, SidebarAction, SidebarProps},
        workspace::{self, AgentRow, WorkspaceAction},
    },
};
use crate::{
    layout::{ChatPlacement, WorkspaceLayout},
    workspace::{ConversationTab, WorkbenchPage, WorkspaceItem},
};
use gpui_kit::{prelude::*, *};
use std::rc::Rc;

impl Workbench {
    fn ui<'a>(&'a self, cx: &'a App) -> Ui<'a> {
        Ui {
            palette: &pero_theme::UiAppearance::global(cx).palette,
            typography: pero_theme::UiAppearance::global(cx).typography,
            locale: &self.locale,
        }
    }

    pub fn icon(&self, name: &str) -> Svg {
        pero_chat_ui::assets::UiIcon::named(name).element().size(px(19.)).flex_shrink_0()
    }

    fn sidebar(&self, width: f32, cx: &mut Context<Self>) -> Stateful<Div> {
        let on_action = Rc::new(cx.listener(
            |this: &mut Self, action: &SidebarAction, window, cx| {
                match action {
                    SidebarAction::RequestDelete(index) => {
                        this.chat.update(cx, |panel, _| {
                            panel.deleting_chat =
                                panel.chats.get(*index).map(|chat| chat.id.clone());
                        });
                    }
                    SidebarAction::ConfirmDelete(index) => {
                        this.chat.update(cx, |panel, cx| {
                            if panel.deleting_chat.as_deref()
                                == panel.chats.get(*index).map(|chat| chat.id.as_str())
                            {
                                panel.delete_chat(*index, cx);
                            }
                        });
                    }
                    SidebarAction::CancelDelete => {
                        this.chat.update(cx, |panel, _| panel.deleting_chat = None);
                    }
                    SidebarAction::NewChat => {
                        this.chat.update(cx, |panel, _| panel.deleting_chat = None);
                        this.new_chat(cx);
                        let composer = this.chat.read(cx).composer.clone();
                        composer.update(cx, |input, cx| input.focus(window, cx));
                    }
                    SidebarAction::Navigate(index) => {
                        this.chat.update(cx, |panel, _| panel.deleting_chat = None);
                        this.navigate(*index, cx);
                        this.sync_follow(cx);
                        if *index == WorkbenchPage::Apps {
                            this.refresh_apps(cx);
                        }
                    }
                    SidebarAction::OpenProject(key) => {
                        this.chat.update(cx, |panel, _| panel.deleting_chat = None);
                        this.open_project(key.clone(), window, cx);
                    }
                    SidebarAction::ToggleProject(key) => {
                        this.chat.update(cx, |panel, _| panel.deleting_chat = None);
                        if !this.collapsed_projects.remove(key) {
                            this.collapsed_projects.insert(key.clone());
                        }
                    }
                    SidebarAction::SelectSession(index) => {
                        this.chat.update(cx, |panel, _| panel.deleting_chat = None);
                        this.focus_chat(Some(*index), ConversationTab::Chat, cx);
                    }
                    SidebarAction::SelectTask(id) => {
                        this.chat.update(cx, |panel, _| panel.deleting_chat = None);
                        this.open_task(id.clone(), cx);
                    }
                }
                cx.notify();
            },
        ));
        let panel = self.chat.read(cx);
        let query = self.search.read(cx).value().to_lowercase();
        let matches = |title: &str| query.is_empty() || title.to_lowercase().contains(&query);
        let selected_task = match self.navigation.current() {
            Some(WorkspaceItem::Task(id)) => Some(id.as_str()),
            _ => None,
        };
        let session_row =
            |i: usize, chat: &pero_chat_ui::conversation::Conversation| sidebar::RecentRow {
                label: chat.title.display().to_owned(),
                icon: "terminal",
                active: self.navigation.page() == WorkbenchPage::Conversation
                    && panel.active_chat == Some(i),
                busy: chat.busy(),
                attention: chat.permission.is_some() || chat.error.is_some(),
                action: SidebarAction::SelectSession(i),
                delete: Some(DeleteAffordance {
                    confirming: panel.deleting_chat.as_deref() == Some(chat.id.as_str()),
                    request: SidebarAction::RequestDelete(i),
                    confirm: SidebarAction::ConfirmDelete(i),
                    cancel: SidebarAction::CancelDelete,
                }),
            };
        let groups = self
            .project_catalog(cx)
            .into_iter()
            .filter_map(|project| {
                let mut rows = panel
                    .chats
                    .iter()
                    .enumerate()
                    .rev()
                    .filter(|(_, chat)| {
                        project.contains_workspace(&chat.workspace) && matches(&chat.title)
                    })
                    .take(8)
                    .map(|(i, chat)| session_row(i, chat))
                    .collect::<Vec<_>>();
                rows.extend(
                    self.remote
                        .tasks()
                        .iter()
                        .filter(|task| {
                            project.contains_task(crate::remote::string(task, "project_id"))
                                && matches(crate::remote::string(task, "title"))
                                && (matches!(
                                    phase(task),
                                    crate::cloud::Phase::Running
                                        | crate::cloud::Phase::Stopping
                                        | crate::cloud::Phase::Failed
                                        | crate::cloud::Phase::Reconcile
                                ) || self
                                    .recent_tasks
                                    .iter()
                                    .any(|id| Some(id.as_str()) == task["id"].as_str())
                                    || selected_task
                                        .is_some_and(|id| task["id"].as_str() == Some(id)))
                        })
                        .take(4)
                        .map(|task| sidebar::RecentRow {
                            label: crate::remote::string(task, "title").to_string(),
                            icon: "layout-list",
                            active: selected_task.is_some_and(|id| task["id"].as_str() == Some(id)),
                            busy: matches!(
                                phase(task),
                                crate::cloud::Phase::Running | crate::cloud::Phase::Stopping
                            ),
                            attention: matches!(
                                phase(task),
                                crate::cloud::Phase::Failed | crate::cloud::Phase::Reconcile
                            ),
                            action: SidebarAction::SelectTask(
                                crate::remote::string(task, "id").to_string(),
                            ),
                            delete: None,
                        }),
                );
                if !query.is_empty() && rows.is_empty() && !matches(&project.name) {
                    return None;
                }
                Some(sidebar::ProjectGroup {
                    active: self.navigation.page() == WorkbenchPage::Tasks
                        && self.selected_project.as_ref() == Some(&project.key),
                    collapsed: self.collapsed_projects.contains(&project.key),
                    path: project
                        .workspace
                        .unwrap_or_else(|| project.shared_id.unwrap_or_default()),
                    key: project.key,
                    name: project.name,
                    rows,
                })
            })
            .collect();
        let ungrouped = panel
            .chats
            .iter()
            .enumerate()
            .rev()
            .filter(|(_, chat)| chat.workspace.is_empty() && matches(&chat.title))
            .map(|(i, chat)| session_row(i, chat))
            .collect();
        let settings = self.settings_menu(cx).into_any_element();
        sidebar::sidebar(
            self.ui(cx),
            width,
            SidebarProps {
                navigation: self.navigation.page(),
                local_connected: self.connected,
                groups,
                ungrouped,
                search: &self.search,
            },
            settings,
            on_action,
        )
    }

    fn detail(&self, _window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        if self.tab == ConversationTab::Chat {
            return self.chat.clone().into_any_element();
        }
        let ui = self.ui(cx);
        div()
            .id("detail-content")
            .flex_1()
            .min_h_0()
            .overflow_y_scroll()
            .p(px(20.))
            .children(self.events.iter().map(|event| {
                div()
                    .py(px(8.))
                    .border_b_1()
                    .border_color(ui.palette.border)
                    .child(self.event_text(event))
            }))
            .into_any_element()
    }

    fn workspace_actions(&self, cx: &mut Context<Self>) -> ActionHandler<WorkspaceAction> {
        Rc::new(
            cx.listener(|this, action: &WorkspaceAction, _, cx| match action {
                WorkspaceAction::NewSession(index) => {
                    this.chat.update(cx, |chat, _| chat.agent_index = *index);
                    this.new_chat(cx);
                }
            }),
        )
    }

    fn environments(&self, cx: &mut Context<Self>) -> Div {
        let agents: Vec<_> = self
            .chat
            .read(cx)
            .agents
            .iter()
            .map(|agent| AgentRow {
                name: agent.name.clone(),
                available: agent.available,
            })
            .collect();
        { let actions = self.workspace_actions(cx); workspace::environments(self.ui(cx), &agents, actions) }
    }
}

impl Render for Workbench {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if self.input_locale != self.locale {
            self.input_locale = self.locale.clone();
            let placeholder = self.t("sessions.search");
            self.search.update(cx, |input, cx| {
                input.set_placeholder(placeholder, window, cx)
            });
            let placeholder = self.t("project.search_tasks");
            self.remote.search.update(cx, |input, cx| {
                input.set_placeholder(placeholder, window, cx)
            });
            let placeholder = self.t("input.placeholder");
            self.input.update(cx, |input, cx| {
                input.set_placeholder(placeholder, window, cx)
            });
        }
        let viewport_width = window.viewport_size().width;
        let tab = self.navigation.current().and_then(|item| {
            self.navigation.items().iter().position(|candidate| candidate == item)
                .map(|index| (item.clone(), index, viewport_width))
        });
        if tab != self.revealed_tab {
            if let Some((_, index, _)) = &tab {
                let index=*index; let scroll=self.tab_scroll.clone();
                // ScrollHandle consumes the previous layout's bounds in prepaint.
                window.on_next_frame(move |window,_| {scroll.scroll_to_item(index);window.refresh();});
            }
            self.revealed_tab = tab;
        }
        let width: f32 = viewport_width.into();
        let layout = WorkspaceLayout::resolve(
            width,
            self.navigation.route(),
            self.tab,
            &self.preferences.layout,
            self.settings_menu_open || self.resizing_chat || self.settings_panel.is_some(),
        );
        self.layout = layout;
        let sidebar_width = layout.sidebar_width;
        let chat_width = layout.chat_width;
        let dock = layout.chat == ChatPlacement::Dock;
        let narrow = layout.narrow;
        let has_tabs = !self.navigation.items().is_empty();
        if !layout.app_surface_visible {
            self.sync_app_surface(None, cx);
        }
        let p = &pero_theme::UiAppearance::global(cx).palette.clone();
        div()
            .id("workbench")
            .capture_action(cx.listener(|this, _: &crate::workspace_view::NextContent, window, cx| this.cycle_content(false, window, cx)))
            .capture_action(cx.listener(|this, _: &crate::workspace_view::PreviousContent, window, cx| this.cycle_content(true, window, cx)))
            .on_mouse_move(cx.listener(|this, event: &MouseMoveEvent, window, cx| {
                if this.resizing_chat {
                    let width: f32 = window.viewport_size().width.into();
                    let x: f32 = event.position.x.into();
                    this.preferences.layout.resize_chat(width - x);
                    cx.notify();
                }
            }))
            .on_mouse_up(
                MouseButton::Left,
                cx.listener(|this, _, _, cx| {
                    if this.resizing_chat {
                        this.resizing_chat = false;
                        this.save_preferences(this.preferences.clone(), cx);
                        cx.notify();
                    }
                }),
            )
            .size_full()
            .flex()
            .bg(p.surface)
            .text_color(p.text)

            .text_size(pero_theme::UiAppearance::global(cx).text(pero_theme::TextRole::Body))
            .child(self.sidebar(sidebar_width, cx))
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .h_full()
                    .flex()
                    .flex_col()
                    .when(has_tabs, |el| el.child(self.content_tabs(cx)))
                    .when(self.error.is_some(), |el| {
                        el.child(
                            div()
                                .id("workbench-error")
                                .role(Role::Alert)
                                .px(px(20.))
                                .py(px(10.))
                                .bg(p.error_bg)
                                .text_color(p.error)
                                .child(
                                    self.error
                                        .as_deref()
                                        .map(|error| {
                                            if error.starts_with("error.") {
                                                self.t(error)
                                            } else {
                                                error
                                            }
                                        })
                                        .unwrap_or_default()
                                        .to_string(),
                                ),
                        )
                    })
                    .child(
                        div()
                            .flex_1()
                            .min_h_0()
                            .flex()
                            .when(layout.content_visible, |el| {
                                el.child(
                                    div()
                                        .flex_1()
                                        .min_w_0()
                                        .min_h_0()
                                        .h_full()
                                        .flex()
                                        .flex_col()
                                        .when(
                                            self.navigation.page() == WorkbenchPage::Tasks,
                                            |el| {
                                                el.child(self.project_workspace(layout.narrow, cx))
                                            },
                                        )
                                        .when(
                                            self.navigation.page() == WorkbenchPage::Conversation,
                                            |el| el.child(self.detail(window, cx)),
                                        )
                                        .when(
                                            self.navigation.page() == WorkbenchPage::Workers,
                                            |el| el.child(self.workers_view(cx)),
                                        )
                                        .when(self.show_local_execution_onboarding(), |el| {
                                            el.child(
                                                div()
                                                    .id("first-run-setup")
                                                    .flex_1()
                                                    .min_h_0()
                                                    .overflow_y_scroll()
                                                    .child(
                                                        self.local_execution_setup_view(true, cx),
                                                    ),
                                            )
                                        })
                                        .when(
                                            self.navigation.page() == WorkbenchPage::Projects
                                                && !self.show_local_execution_onboarding(),
                                            |el| el.child(self.projects_view(cx)),
                                        )
                                        .when(
                                            self.navigation.page() == WorkbenchPage::Agents,
                                            |el| el.child(self.environments(cx)),
                                        )
                                        .when(self.navigation.page() == WorkbenchPage::Apps, |el| {
                                            el.child(self.apps_view(cx))
                                        })
                                        .when(
                                            self.navigation.page() == WorkbenchPage::Insights,
                                            |el| el.child(self.insights_view(cx)),
                                        )
                                        .when(
                                            self.navigation.page() == WorkbenchPage::Connections,
                                            |el| el.child(self.remote_connection_view(cx)),
                                        ),
                                )
                            })
                            .when(dock, |el| {
                                el.child(self.chat_dock(chat_width, narrow, window, cx))
                            }),
                    ),
            )
    }
}
