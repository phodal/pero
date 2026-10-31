use crate::{
    app::Workbench,
    components::{
        ActionHandler, Ui,
        chrome, sidebar,
        workspace::{self, AgentRow, WorkspaceAction},
    },
};
use crate::{
    layout::{ChatPlacement, WorkspaceLayout},
    workspace::{ConversationTab, WorkbenchPage, WorkspaceItem},
};
use gpui_kit::{
    component::WindowExt,
    prelude::*,
    *,
};
use std::rc::Rc;


impl Workbench {
    pub(crate) fn ui<'a>(&'a self, cx: &'a App) -> Ui<'a> {
        let appearance = pero_theme::UiAppearance::global(cx);
        Ui {
            palette: &appearance.palette,
            typography: appearance.typography,
            locale: &self.locale,
            dark: appearance.dark,
        }
    }

    pub fn icon(&self, name: &str) -> Svg {
        svg()
            .path(pero_chat_ui::icon_theme::asset_path(name))
            .size(px(pero_theme::WorkbenchStyle::ICON))
            .flex_shrink_0()
    }

    fn sidebar(&self, width: f32, cx: &mut Context<Self>) -> Stateful<Div> {
        let actions = self.navigation_actions(cx);
        let settings = div().relative()
            .child(self.settings_menu(self.sidebar_collapsed, cx))
            .child(self.view_bounds.settings.probe("settings".into()))
            .into_any_element();
        let apps = self.apps.entries.iter().filter(|app| app.enabled || app.placement() != crate::apps::AppPlacement::Catalog).filter_map(|app| {
            let panel = app.panels.first()?;
            Some(sidebar::AppShortcut {
                name: app.name.clone(), panel: panel.id.clone(),
                label: self.installed_app_title(&app.name, &app.display_name),
                placement: app.placement(),
                icon: pero_chat_ui::icon_theme::app_icon(&app.name, pero_theme::UiAppearance::global(cx).dark),
                active: matches!(self.navigation.current(), Some(WorkspaceItem::App { name, .. }) if name == &app.name),
            })
        }).collect();
        sidebar::sidebar(self.ui(cx), width, sidebar::SidebarProps {
            shortcut_bounds: &self.view_bounds.sidebar,
            navigation: self.navigation.page(), catalog_open: self.navigation.current().is_none(),
            identity: self.remote.data["identity"]["name"].as_str().unwrap_or(self.t("nav.local_user")).to_string(),
            terminal_open: self.terminal.visible, local_connected: self.connected, collapsed: self.sidebar_collapsed, apps,
        }, settings, actions, cx)
    }

    fn toggle_sidebar(&mut self, cx: &mut Context<Self>) {
        self.sidebar_collapsed = !self.sidebar_collapsed;
        cx.notify();
    }

    fn chrome_title(&self, cx: &App) -> String {
        if let Some(item) = self.navigation.current() {
            return self.content_label(item, cx).0;
        }
        if self.navigation.page() == WorkbenchPage::Apps { return self.t("apps.manage").to_string(); }
        let panel = self.chat.read(cx);
        panel
            .active_chat
            .and_then(|index| panel.chats.get(index))
            .map(|chat| chat.title.display().to_string())
            .filter(|title| !title.is_empty())
            .unwrap_or_default()
    }

    fn window_titlebar(
        &self,
        has_tabs: bool,
        dragging: &Entity<bool>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let single_pane = self.navigation.pane_layout().filter(|_| self.navigation.pane_layout_visible()).and_then(|layout| {
            let leaves = layout.leaves();
            (leaves.len() == 1).then(|| leaves[0].clone())
        });
        let tabs = if let Some(leaf) = single_pane { Some(div().flex_1().min_w_0().child(self.pane_tab_bar(&leaf, cx)).into_any_element()) }
            else { has_tabs.then(|| self.content_tabs(false, cx).into_any_element()) };
        let title = if has_tabs {
            SharedString::default()
        } else {
            self.chrome_title(cx).into()
        };
        chrome::window_titlebar(
            self.ui(cx),
            self.sidebar_collapsed,
            self.layout.sidebar_width,
            title,
            tabs,
            cx.listener(|this, _, _, cx| this.toggle_sidebar(cx)),
            cx.listener(|this, _, window, cx| this.toggle_spotlight(window, cx)),
            dragging,
            window,
            cx,
        )
    }

    fn sidebar_resize(&self, window: &Window, cx: &mut Context<Self>) -> impl IntoElement {
        let p = &pero_theme::UiAppearance::global(cx).palette.clone();
        div()
            .id("sidebar-resize")
            .track_focus(&self.sidebar_resize_focus)
            .role(Role::Splitter)
            .aria_label(self.t("workspace.resize_sidebar"))
            .aria_numeric_value(self.preferences.layout.sidebar_width().into())
            .when(self.sidebar_resize_focus.is_focused(window), |el| el.bg(p.focus))
            .absolute()
            .top_0()
            .right_0()
            .w(px(6.))
            .h_full()
            .cursor(CursorStyle::ResizeLeftRight)
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(|this, _, window, cx| {
                    this.sidebar_resize_focus.focus(window, cx);
                    this.resizing_sidebar = true;
                    cx.stop_propagation();
                    cx.notify();
                }),
            )
            .on_key_down(cx.listener(|this, event: &KeyDownEvent, _, cx| {
                let delta = match event.keystroke.key.as_str() {
                    "left" => -20.,
                    "right" => 20.,
                    _ => return,
                };
                let width = this.preferences.layout.sidebar_width() + delta;
                this.preferences.layout.resize_sidebar(width);
                this.save_preferences(this.preferences.clone(), cx);
                cx.stop_propagation();
            }))
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
        let actions = self.workspace_actions(cx);
        workspace::environments(self.ui(cx), &agents, actions, cx).into_any_element()
    }
}

impl Render for Workbench {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let dragging = window.use_keyed_state("window-chrome", cx, |_, _| false);
        self.view_bounds.clear();
        self.leave_settings_route(window, cx);
        if self.input_locale != self.locale {
            self.input_locale = self.locale.clone();
            let session_placeholder = self.t("sessions.search");
            self.session_search.update(cx, |input, cx| input.set_placeholder(session_placeholder, window, cx));
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
        let tab = self
            .navigation
            .current()
            .filter(|item| matches!(item, WorkspaceItem::Project(_) | WorkspaceItem::Task(_)))
            .and_then(|item| {
                self.navigation
                    .items()
                    .iter()
                    .filter(|item| {
                        matches!(item, WorkspaceItem::Project(_) | WorkspaceItem::Task(_))
                    })
                    .position(|candidate| candidate == item)
                    .map(|index| (item.clone(), index, viewport_width))
            });
        if tab != self.revealed_tab {
            if let Some((_, index, _)) = &tab {
                let index = *index;
                let scroll = self.tab_scroll.clone();
                // ScrollHandle consumes the previous layout's bounds in prepaint.
                window.on_next_frame(move |window, _| {
                    scroll.scroll_to_item(index);
                    window.refresh();
                });
            }
            self.revealed_tab = tab;
        }
        let width: f32 = viewport_width.into();
        let pane_tree = self.navigation.pane_layout_visible()
            && !(self.navigation.page() == WorkbenchPage::Conversation
                && self.tab != ConversationTab::Chat);
        let pane_layout = self.navigation.pane_layout().filter(|_| pane_tree);
        let window_overlay = self.spotlight.is_some()
            || self.settings_menu_open
            || self.resizing_chat
            || self.resizing_sidebar
            || self.settings_panel.is_some()
            || self.pane_tabs.switching()
            || window.has_active_dialog(cx);
        let chat_dock_menu = self.chat.read(cx).dock_menu
            && WorkspaceLayout::chat_placement(
                self.navigation.route(),
                self.tab,
                &self.preferences.layout,
            ) == ChatPlacement::Dock
            && pane_layout
                .as_ref()
                .is_none_or(|layout| layout.conversation().is_none())
            && !self.floating_chat
            && self.active_app_chat_slot().is_none();
        let covered = WorkspaceLayout::embedded_surface_covered(
            window_overlay,
            gpui_kit::component::GlobalState::is_in_deferred_context(cx),
            chat_dock_menu,
            if cfg!(all(
                not(target_family = "wasm"),
                any(target_os = "macos", target_os = "linux")
            )) {
                crate::layout::SurfaceStacking::Composited
            } else {
                crate::layout::SurfaceStacking::AboveWorkbench
            },
        );
        let mut layout = WorkspaceLayout::resolve(
            width,
            self.navigation.route(),
            self.tab,
            &self.preferences.layout,
            covered,
            pane_layout,
        );
        let single_pane = self
            .navigation
            .pane_layout()
            .is_none_or(|layout| layout.leaves().len() <= 1);
        let slot = self.active_app_chat_slot().cloned().filter(|_| !covered);
        let floating = cfg!(target_family = "wasm")
            && slot.is_none()
            && self.floating_chat
            && single_pane
            && layout.chat == ChatPlacement::Dock
            && matches!(self.navigation.current(), Some(WorkspaceItem::App { .. }));
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
            layout.embedded_surface_visible = !covered;
        }
        if !floating && slot.is_none() {
            Self::publish_app_chat_overlay(None);
        }
        if self.sidebar_collapsed {
            layout = layout.hide_sidebar(width, &self.preferences.layout);
        }
        self.layout = layout;
        let sidebar_width = layout.sidebar_width;
        let sessions = (self.navigation.page() == WorkbenchPage::Conversation && self.tab == ConversationTab::Chat)
            .then(|| self.sessions_panel(if width - sidebar_width < 680. {220.} else {280.}, cx).into_any_element());
        let chat_width = layout.chat_width;
        let dock = layout.chat == ChatPlacement::Dock;
        let narrow = layout.narrow;
        let has_tabs = self.navigation.items().iter().any(|item| {
            matches!(item, WorkspaceItem::Project(_) | WorkspaceItem::Task(_))
        });
        if !layout.embedded_surface_visible
            || !matches!(self.navigation.current(), Some(WorkspaceItem::App { .. }))
        {
            self.sync_app_surface(None, cx);
        }
        #[cfg(target_family = "wasm")]
        if !layout.embedded_surface_visible
            || !matches!(self.navigation.current(), Some(WorkspaceItem::Web(_)))
        {
            self.sync_web_surface(None, cx);
        }
        #[cfg(not(target_family = "wasm"))]
        self.sync_web_surface(None, cx);
        let p = &pero_theme::UiAppearance::global(cx).palette.clone();
        div()
            .id("workbench")
            .relative()
            .track_focus(&self.workspace_focus)
            .when(self.pane_tabs.switching(), |el| {
                el.key_context("PaneTabSwitcher")
            })
            .on_modifiers_changed(
                cx.listener(|this, event, window, cx| this.pane_tab_modifiers(event, window, cx)),
            )
            .capture_action(cx.listener(
                |this, _: &crate::workspace_pane_tabs::NextPaneTabMru, window, cx| {
                    this.cycle_pane_tab_mru(false, window, cx);
                    cx.stop_propagation();
                },
            ))
            .capture_action(cx.listener(
                |this, _: &crate::workspace_pane_tabs::PreviousPaneTabMru, window, cx| {
                    this.cycle_pane_tab_mru(true, window, cx);
                    cx.stop_propagation();
                },
            ))
            .capture_action(cx.listener(
                |this, _: &crate::workspace_pane_tabs::ConfirmPaneTabSwitch, window, cx| {
                    this.confirm_pane_tab_switch(window, cx);
                    cx.stop_propagation();
                },
            ))
            .capture_action(cx.listener(
                |this, _: &crate::workspace_pane_tabs::CancelPaneTabSwitch, window, cx| {
                    this.cancel_pane_tab_switch(window, cx);
                    cx.stop_propagation();
                },
            ))
            .capture_action(cx.listener(
                |this, _: &crate::workspace_tab_actions::ClosePaneTab, window, cx| {
                    this.close_keyboard_tab(window, cx)
                },
            ))
            .capture_action(cx.listener(
                |this, _: &crate::workspace_tab_actions::ReopenClosedPaneTab, window, cx| {
                    this.reopen_closed_tab(window, cx)
                },
            ))
            .capture_action(cx.listener(
                |this, _: &crate::workspace_tab_actions::OpenPreviewToSide, window, cx| {
                    this.preview_to_side(window, cx)
                },
            ))
            .capture_action(cx.listener(
                |this, _: &crate::workspace_tab_actions::FocusPane1, window, cx| {
                    this.focus_numbered_pane(0, window, cx)
                },
            ))
            .capture_action(cx.listener(
                |this, _: &crate::workspace_tab_actions::FocusPane2, window, cx| {
                    this.focus_numbered_pane(1, window, cx)
                },
            ))
            .capture_action(cx.listener(
                |this, _: &crate::workspace_tab_actions::FocusPane3, window, cx| {
                    this.focus_numbered_pane(2, window, cx)
                },
            ))
            .capture_action(cx.listener(
                |this, _: &crate::workspace_tab_actions::FocusPane4, window, cx| {
                    this.focus_numbered_pane(3, window, cx)
                },
            ))
            .capture_action(cx.listener(
                |this, _: &crate::workspace_tab_actions::FocusPane5, window, cx| {
                    this.focus_numbered_pane(4, window, cx)
                },
            ))
            .capture_action(cx.listener(
                |this, _: &crate::workspace_tab_actions::FocusPane6, window, cx| {
                    this.focus_numbered_pane(5, window, cx)
                },
            ))
            .capture_action(cx.listener(
                |this, _: &crate::workspace_tab_actions::FocusPane7, window, cx| {
                    this.focus_numbered_pane(6, window, cx)
                },
            ))
            .capture_action(cx.listener(
                |this, _: &crate::workspace_tab_actions::FocusPane8, window, cx| {
                    this.focus_numbered_pane(7, window, cx)
                },
            ))
            .capture_action(cx.listener(
                |this, _: &crate::workspace_tab_actions::FocusPane9, window, cx| {
                    this.focus_numbered_pane(8, window, cx)
                },
            ))
            .capture_action(cx.listener(
                |this, _: &crate::workspace_recent::OpenRecentContent, window, cx| {
                    this.open_recent_content(window, cx);
                    cx.stop_propagation();
                },
            ))
            .capture_action(cx.listener(
                |this, _: &crate::spotlight::OpenSpotlight, window, cx| {
                    this.toggle_spotlight(window, cx);
                    cx.stop_propagation();
                },
            ))
            .capture_action(
                cx.listener(|this, _: &crate::web_documents::OpenWeb, window, cx| {
                    this.choose_web(window, cx);
                    cx.stop_propagation();
                }),
            )
            .capture_action(cx.listener(
                |this, _: &crate::workspace_view::NextContent, window, cx| {
                    this.cycle_content(false, window, cx)
                },
            ))
            .capture_action(cx.listener(
                |this, _: &crate::workspace_view::PreviousContent, window, cx| {
                    this.cycle_content(true, window, cx)
                },
            ))
            .capture_action(cx.listener(
                |this, _: &crate::workspace_view::WorkspaceBack, window, cx| {
                    this.navigate_history(false, window, cx)
                },
            ))
            .capture_action(cx.listener(
                |this, _: &crate::workspace_view::WorkspaceForward, window, cx| {
                    this.navigate_history(true, window, cx)
                },
            ))
            .capture_action(cx.listener(
                |this, _: &crate::workspace_view::SplitDocument, window, cx| {
                    this.toggle_document_split(window, cx)
                },
            ))
            .capture_action(cx.listener(
                |this, _: &crate::workspace_pane_views::SplitPaneLeft, window, cx| {
                    this.split_document_pane(
                        pero_contracts::workspace_panes::SplitDirection::Left,
                        window,
                        cx,
                    );
                    cx.stop_propagation();
                },
            ))
            .capture_action(cx.listener(
                |this, _: &crate::workspace_pane_views::FocusPaneLeft, window, cx| {
                    this.focus_document_pane_direction(
                        pero_contracts::workspace_panes::SplitDirection::Left,
                        window,
                        cx,
                    );
                    cx.stop_propagation();
                },
            ))
            .capture_action(cx.listener(
                |this, _: &crate::workspace_pane_views::SplitPaneRight, window, cx| {
                    this.split_document_pane(
                        pero_contracts::workspace_panes::SplitDirection::Right,
                        window,
                        cx,
                    );
                    cx.stop_propagation();
                },
            ))
            .capture_action(cx.listener(
                |this, _: &crate::workspace_pane_views::FocusPaneRight, window, cx| {
                    this.focus_document_pane_direction(
                        pero_contracts::workspace_panes::SplitDirection::Right,
                        window,
                        cx,
                    );
                    cx.stop_propagation();
                },
            ))
            .capture_action(cx.listener(
                |this, _: &crate::workspace_pane_views::SplitPaneUp, window, cx| {
                    this.split_document_pane(
                        pero_contracts::workspace_panes::SplitDirection::Up,
                        window,
                        cx,
                    );
                    cx.stop_propagation();
                },
            ))
            .capture_action(cx.listener(
                |this, _: &crate::workspace_pane_views::FocusPaneUp, window, cx| {
                    this.focus_document_pane_direction(
                        pero_contracts::workspace_panes::SplitDirection::Up,
                        window,
                        cx,
                    );
                    cx.stop_propagation();
                },
            ))
            .capture_action(cx.listener(
                |this, _: &crate::workspace_pane_views::SplitPaneDown, window, cx| {
                    this.split_document_pane(
                        pero_contracts::workspace_panes::SplitDirection::Down,
                        window,
                        cx,
                    );
                    cx.stop_propagation();
                },
            ))
            .capture_action(cx.listener(
                |this, _: &crate::workspace_pane_views::FocusPaneDown, window, cx| {
                    this.focus_document_pane_direction(
                        pero_contracts::workspace_panes::SplitDirection::Down,
                        window,
                        cx,
                    );
                    cx.stop_propagation();
                },
            ))
            .capture_action(cx.listener(
                |this, _: &crate::workspace_pane_views::ClosePane, window, cx| {
                    this.close_active_document_pane(window, cx);
                    cx.stop_propagation();
                },
            ))
            .on_mouse_move(cx.listener(|this, event: &MouseMoveEvent, window, cx| {
                this.resize_document_pane(event.position, cx);
                if this.resizing_chat {
                    let width: f32 = window.viewport_size().width.into();
                    let x: f32 = event.position.x.into();
                    this.preferences.layout.resize_chat(width - x);
                    cx.notify();
                }
                if this.resizing_sidebar {
                    let viewport: f32 = window.viewport_size().width.into();
                    let x: f32 = event.position.x.into();
                    let width = WorkspaceLayout::sidebar_span(viewport, x);
                    this.preferences.layout.resize_sidebar(width);
                    cx.notify();
                }
            }))
            .on_mouse_up(
                MouseButton::Left,
                cx.listener(|this, _, _, cx| {
                    if this.pane_resize.take().is_some() {
                        this.queue_workspace_checkpoint(cx);
                        cx.notify();
                    }
                    if this.resizing_chat {
                        this.resizing_chat = false;
                        this.save_preferences(this.preferences.clone(), cx);
                        cx.notify();
                    }
                    if this.resizing_sidebar {
                        this.resizing_sidebar = false;
                        this.save_preferences(this.preferences.clone(), cx);
                        cx.notify();
                    }
                }),
            )
            .when_some(slot, |el, slot| el.child(self.embedded_app_chat(&slot, cx)))
            .size_full()
            .relative()
            .flex()
            .flex_col()
            .bg(p.bg)
            .text_color(p.text)
            .text_size(pero_theme::UiAppearance::global(cx).text(pero_theme::TextRole::Body))
            .font_weight(FontWeight::NORMAL)
            .line_height(relative(1.3))
            .child(self.window_titlebar(has_tabs, &dragging, window, cx))
            .child(
                div()
                    .flex_1()
                    .min_h_0()
                    .w_full()
                    .flex()
                    .child(
                        div()
                            .relative()
                            .h_full()
                            .flex_shrink_0()
                            .child(self.sidebar(sidebar_width, cx))
                            .when(!self.sidebar_collapsed, |el| {
                                el.child(self.sidebar_resize(window, cx))
                            }),
                    )
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .h_full()
                            .flex()
                            .flex_col()
                            .when(
                        self.web_entry_open || self.navigation.page() == WorkbenchPage::Web,
                        |el| el.child(self.web_toolbar(cx)),
                    )
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
                            .children(sessions)
                            .when(layout.content_visible, |el| {
                                el.child(
                                    div()
                                        .flex_1()
                                        .min_w_0()
                                        .min_h_0()
                                        .h_full()
                                        .flex()
                                        .flex_col()
                                        .when(pane_tree, |el| {
                                            el.child(
                                                self.render_pane_tree(
                                                    self.navigation
                                                        .pane_layout()
                                                        .unwrap()
                                                        .root
                                                        .as_ref()
                                                        .unwrap(),
                                                    cx,
                                                ),
                                            )
                                        })
                                        .when(
                                            !pane_tree
                                                && self.navigation.page() == WorkbenchPage::Web,
                                            |el| el.child(self.web_content(cx)),
                                        )
                                        .when(
                                            !pane_tree
                                                && self.navigation.page()
                                                    == WorkbenchPage::Document,
                                            |el| el.child(self.document_content(cx)),
                                        )
                                        .when(
                                            self.navigation.page() == WorkbenchPage::Tasks,
                                            |el| {
                                                el.child(self.project_workspace(layout.narrow, cx))
                                            },
                                        )
                                        .when(
                                            !pane_tree
                                                && self.navigation.page()
                                                    == WorkbenchPage::Conversation,
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
                                        .when(
                                            !pane_tree
                                                && self.navigation.page() == WorkbenchPage::Apps,
                                            |el| el.child(self.apps_view(width - sidebar_width, cx)),
                                        ),
                                )
                            })
                            .when(dock, |el| {
                                el.child(self.chat_dock(chat_width, narrow, window, cx))
                            })
                            .when(floating, |el| {
                                el.child(self.floating_app_chat(width, window, cx))
                            }),
                    )
                    .when(self.terminal.visible, |el| el.child(self.terminal_panel((f32::from(window.viewport_size().height)*0.4).clamp(180.,320.),cx))),
                    )
            )
            .when(self.spotlight.is_some(), |el| {
                el.child(self.spotlight_overlay(cx))
            })
    }
}
