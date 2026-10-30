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
use gpui_kit::{component::WindowExt, prelude::*, *};
use std::rc::Rc;

impl Workbench {
    fn ui<'a>(&'a self, cx: &'a App) -> Ui<'a> {
        let appearance = pero_theme::UiAppearance::global(cx);
        Ui {
            palette: &appearance.palette,
            typography: appearance.typography,
            locale: &self.locale,
            dark: appearance.dark,
        }
    }

    pub fn icon(&self, name: &str) -> Svg {
        svg().path(pero_chat_ui::icon_theme::asset_path(name)).size(px(pero_theme::WorkbenchStyle::ICON)).flex_shrink_0()
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
            cx,
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
            .p(px(pero_theme::WorkbenchStyle::PAGE))
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
            cx.listener(|this, action: &WorkspaceAction, window, cx| match action {
                WorkspaceAction::NewSession(index) => {
                    this.chat.update(cx, |chat, _| chat.agent_index = *index);
                    this.new_chat(cx);
                    this.close_settings(window, cx);
                }
            }),
        )
    }

    pub(crate) fn agent_settings(&self, cx: &mut Context<Self>) -> AnyElement {
        let agents: Vec<_> = self.chat.read(cx).agents.iter().map(|agent| AgentRow { name: agent.name.clone(), available: agent.available }).collect();
        let actions = self.workspace_actions(cx);
        workspace::environments(self.ui(cx), &agents, actions, cx).into_any_element()
    }
}

impl Render for Workbench {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        self.leave_settings_route(window, cx);
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
        let tab = self.navigation.current().filter(|item|matches!(item,WorkspaceItem::Project(_)|WorkspaceItem::Task(_))).and_then(|item| {
            self.navigation.items().iter().filter(|item|matches!(item,WorkspaceItem::Project(_)|WorkspaceItem::Task(_))).position(|candidate| candidate == item)
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
        let pane_tree=self.navigation.pane_layout_visible()&&!(self.navigation.page()==WorkbenchPage::Conversation&&self.tab!=ConversationTab::Chat);
        let mut layout = WorkspaceLayout::resolve(
            width,
            self.navigation.route(),
            self.tab,
            &self.preferences.layout,
            self.settings_menu_open || self.resizing_chat || self.settings_panel.is_some() || self.pane_tabs.switching() || window.has_active_dialog(cx) || gpui_kit::component::GlobalState::is_in_deferred_context(cx),
            self.navigation.pane_layout().filter(|_|pane_tree),
        );
        let single_pane = self.navigation.pane_layout().is_none_or(|layout| layout.leaves().len() <= 1);
        let covered = self.settings_menu_open || self.resizing_chat || self.settings_panel.is_some() || self.pane_tabs.switching() || window.has_active_dialog(cx) || gpui_kit::component::GlobalState::is_in_deferred_context(cx);
        let slot = self.active_app_chat_slot().cloned().filter(|_| !covered);
        let floating = slot.is_none() && self.floating_chat && single_pane && layout.chat == ChatPlacement::Dock && matches!(self.navigation.current(), Some(WorkspaceItem::App { .. }));
        if slot.is_some() {
            layout.chat = ChatPlacement::Slot;
            layout.chat_width = 0.;
            layout.content_visible = true;
            layout.embedded_surface_visible = true;
        }
        if floating {
            layout.chat = ChatPlacement::Float;
            layout.chat_width = 0.;
            layout.content_visible = true;
            layout.embedded_surface_visible = !(self.settings_menu_open || self.resizing_chat || self.settings_panel.is_some() || self.pane_tabs.switching() || window.has_active_dialog(cx) || gpui_kit::component::GlobalState::is_in_deferred_context(cx));
        }
        if !floating && slot.is_none() { Self::publish_app_chat_overlay(None); }
        self.layout = layout;
        let sidebar_width = layout.sidebar_width;
        let chat_width = layout.chat_width;
        let dock = layout.chat == ChatPlacement::Dock;
        let narrow = layout.narrow;
        let has_tabs = !self.navigation.items().is_empty();
        if !layout.embedded_surface_visible || !matches!(self.navigation.current(),Some(WorkspaceItem::App {..})) {
            self.sync_app_surface(None, cx);
        }
        #[cfg(target_family="wasm")]
        if !layout.embedded_surface_visible || !matches!(self.navigation.current(),Some(WorkspaceItem::Web(_))) {self.sync_web_surface(None,cx);}
        #[cfg(not(target_family="wasm"))]
        self.sync_web_surface(None,cx);
        let p = &pero_theme::UiAppearance::global(cx).palette.clone();
        div()
            .id("workbench")
            .relative()
            .track_focus(&self.workspace_focus)
            .when(self.pane_tabs.switching(),|el|el.key_context("PaneTabSwitcher"))
            .on_modifiers_changed(cx.listener(|this,event,window,cx|this.pane_tab_modifiers(event,window,cx)))
            .capture_action(cx.listener(|this,_:&crate::workspace_pane_tabs::NextPaneTabMru,window,cx|{this.cycle_pane_tab_mru(false,window,cx);cx.stop_propagation();}))
            .capture_action(cx.listener(|this,_:&crate::workspace_pane_tabs::PreviousPaneTabMru,window,cx|{this.cycle_pane_tab_mru(true,window,cx);cx.stop_propagation();}))
            .capture_action(cx.listener(|this,_:&crate::workspace_pane_tabs::ConfirmPaneTabSwitch,window,cx|{this.confirm_pane_tab_switch(window,cx);cx.stop_propagation();}))
            .capture_action(cx.listener(|this,_:&crate::workspace_pane_tabs::CancelPaneTabSwitch,window,cx|{this.cancel_pane_tab_switch(window,cx);cx.stop_propagation();}))
            .capture_action(cx.listener(|this,_:&crate::workspace_tab_actions::ClosePaneTab,window,cx|this.close_keyboard_tab(window,cx)))
            .capture_action(cx.listener(|this,_:&crate::workspace_tab_actions::ReopenClosedPaneTab,window,cx|this.reopen_closed_tab(window,cx)))
            .capture_action(cx.listener(|this,_:&crate::workspace_tab_actions::OpenPreviewToSide,window,cx|this.preview_to_side(window,cx)))
            .capture_action(cx.listener(|this,_:&crate::workspace_tab_actions::FocusPane1,window,cx|this.focus_numbered_pane(0,window,cx)))
            .capture_action(cx.listener(|this,_:&crate::workspace_tab_actions::FocusPane2,window,cx|this.focus_numbered_pane(1,window,cx)))
            .capture_action(cx.listener(|this,_:&crate::workspace_tab_actions::FocusPane3,window,cx|this.focus_numbered_pane(2,window,cx)))
            .capture_action(cx.listener(|this,_:&crate::workspace_tab_actions::FocusPane4,window,cx|this.focus_numbered_pane(3,window,cx)))
            .capture_action(cx.listener(|this,_:&crate::workspace_tab_actions::FocusPane5,window,cx|this.focus_numbered_pane(4,window,cx)))
            .capture_action(cx.listener(|this,_:&crate::workspace_tab_actions::FocusPane6,window,cx|this.focus_numbered_pane(5,window,cx)))
            .capture_action(cx.listener(|this,_:&crate::workspace_tab_actions::FocusPane7,window,cx|this.focus_numbered_pane(6,window,cx)))
            .capture_action(cx.listener(|this,_:&crate::workspace_tab_actions::FocusPane8,window,cx|this.focus_numbered_pane(7,window,cx)))
            .capture_action(cx.listener(|this,_:&crate::workspace_tab_actions::FocusPane9,window,cx|this.focus_numbered_pane(8,window,cx)))

            .capture_action(cx.listener(|this,_:&crate::workspace_recent::OpenRecentContent,window,cx|{this.open_recent_content(window,cx);cx.stop_propagation();}))
            .capture_action(cx.listener(|this,_:&crate::web_documents::OpenWeb,window,cx| {this.choose_web(window,cx);cx.stop_propagation();}))
            .capture_action(cx.listener(|this, _: &crate::workspace_view::NextContent, window, cx| this.cycle_content(false, window, cx)))
            .capture_action(cx.listener(|this, _: &crate::workspace_view::PreviousContent, window, cx| this.cycle_content(true, window, cx)))
            .capture_action(cx.listener(|this,_:&crate::workspace_view::WorkspaceBack,window,cx|this.navigate_history(false,window,cx)))
            .capture_action(cx.listener(|this,_:&crate::workspace_view::WorkspaceForward,window,cx|this.navigate_history(true,window,cx)))
            .capture_action(cx.listener(|this,_:&crate::workspace_view::SplitDocument,window,cx|this.toggle_document_split(window,cx)))
            .capture_action(cx.listener(|this,_:&crate::workspace_pane_views::SplitPaneLeft,window,cx|{this.split_document_pane(pero_contracts::workspace_panes::SplitDirection::Left,window,cx);cx.stop_propagation();}))
            .capture_action(cx.listener(|this,_:&crate::workspace_pane_views::FocusPaneLeft,window,cx|{this.focus_document_pane_direction(pero_contracts::workspace_panes::SplitDirection::Left,window,cx);cx.stop_propagation();}))
            .capture_action(cx.listener(|this,_:&crate::workspace_pane_views::SplitPaneRight,window,cx|{this.split_document_pane(pero_contracts::workspace_panes::SplitDirection::Right,window,cx);cx.stop_propagation();}))
            .capture_action(cx.listener(|this,_:&crate::workspace_pane_views::FocusPaneRight,window,cx|{this.focus_document_pane_direction(pero_contracts::workspace_panes::SplitDirection::Right,window,cx);cx.stop_propagation();}))
            .capture_action(cx.listener(|this,_:&crate::workspace_pane_views::SplitPaneUp,window,cx|{this.split_document_pane(pero_contracts::workspace_panes::SplitDirection::Up,window,cx);cx.stop_propagation();}))
            .capture_action(cx.listener(|this,_:&crate::workspace_pane_views::FocusPaneUp,window,cx|{this.focus_document_pane_direction(pero_contracts::workspace_panes::SplitDirection::Up,window,cx);cx.stop_propagation();}))
            .capture_action(cx.listener(|this,_:&crate::workspace_pane_views::SplitPaneDown,window,cx|{this.split_document_pane(pero_contracts::workspace_panes::SplitDirection::Down,window,cx);cx.stop_propagation();}))
            .capture_action(cx.listener(|this,_:&crate::workspace_pane_views::FocusPaneDown,window,cx|{this.focus_document_pane_direction(pero_contracts::workspace_panes::SplitDirection::Down,window,cx);cx.stop_propagation();}))
            .capture_action(cx.listener(|this,_:&crate::workspace_pane_views::ClosePane,window,cx|{this.close_active_document_pane(window,cx);cx.stop_propagation();}))
            .on_mouse_move(cx.listener(|this, event: &MouseMoveEvent, window, cx| {
                this.resize_document_pane(event.position,cx);
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
                    if this.pane_resize.take().is_some() {this.queue_workspace_checkpoint(cx);cx.notify();}
                    if this.resizing_chat {
                        this.resizing_chat = false;
                        this.save_preferences(this.preferences.clone(), cx);
                        cx.notify();
                    }
                }),
            )
            .when_some(slot, |el, slot| el.child(self.embedded_app_chat(&slot, cx)))
            .size_full()
            .flex()
            .bg(p.bg)
            .text_color(p.text)

            .text_size(pero_theme::UiAppearance::global(cx).text(pero_theme::TextRole::Body))
            .font_weight(FontWeight::NORMAL)
            .line_height(relative(1.3))
            .child(self.sidebar(sidebar_width, cx))
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .h_full()
                    .flex()
                    .flex_col()
                    .when(has_tabs, |el| el.child(self.content_tabs(cx)))
                    .when(self.web_entry_open || self.navigation.page()==WorkbenchPage::Web,|el|el.child(self.web_toolbar(cx)))
                    .children(self.recovery_controls(cx))
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
                            .relative()
                            .when(layout.content_visible, |el| {
                                el.child(
                                    div()
                                        .flex_1()
                                        .min_w_0()
                                        .min_h_0()
                                        .h_full()
                                        .flex()
                                        .flex_col()
                                        .when(pane_tree,|el|el.child(self.render_pane_tree(self.navigation.pane_layout().unwrap().root.as_ref().unwrap(),cx)))
                                        .when(!pane_tree&&self.navigation.page()==WorkbenchPage::Web,|el|el.child(self.web_content(cx)))
                                        .when(!pane_tree&&self.navigation.page()==WorkbenchPage::Document,|el|el.child(self.document_content(cx)))
                                        .when(
                                            self.navigation.page() == WorkbenchPage::Tasks,
                                            |el| {
                                                el.child(self.project_workspace(layout.narrow, cx))
                                            },
                                        )
                                        .when(
                                            !pane_tree&&self.navigation.page() == WorkbenchPage::Conversation,
                                            |el| el.child(self.detail(window, cx)),
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
                                        .when(!pane_tree&&self.navigation.page() == WorkbenchPage::Apps, |el| {
                                            el.child(self.apps_view(cx))
                                        })
                                        .when(
                                            self.navigation.page() == WorkbenchPage::Insights,
                                            |el| el.child(self.insights_view(cx)),
                                        )
                                )
                            })
                            .when(dock, |el| {
                                el.child(self.chat_dock(chat_width, narrow, window, cx))
                            })
                            .when(floating, |el| el.child(self.floating_app_chat(width, window, cx))),
                    ),
            )
    }
}
