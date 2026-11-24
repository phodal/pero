use crate::{
    app::Workbench,
    components::{
        ActionHandler, Ui,
        sidebar,
        workspace::{self, AgentRow, WorkspaceAction},
    },
};
use crate::{
    layout::{ChatPlacement, SurfaceStacking, WorkspaceLayout},
    workspace::{ConversationTab, WorkbenchPage, WorkspaceItem},
    workspace_view::ChatDockDrag,
};
use gpui_kit::{
    component::{Sizable, WindowExt, button::*},
    prelude::*,
    *,
};
use std::cell::Cell;
use std::rc::Rc;

thread_local! {
    static CONTENT_CORNER: Cell<(f32, f32)> = const { Cell::new((f32::NAN, f32::NAN)) };
}

pub(crate) fn note_content_corner(origin: Point<Pixels>) {
    CONTENT_CORNER.with(|corner| corner.set((origin.x.into(), origin.y.into())));
}

pub(crate) fn at_content_corner(origin: Point<Pixels>) -> bool {
    CONTENT_CORNER.with(|corner| {
        let (x, y) = corner.get();
        (x - f32::from(origin.x)).abs() < 1. && (y - f32::from(origin.y)).abs() < 1.
    })
}


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

    pub(crate) fn sidebar(&self, width: f32, cx: &mut Context<Self>) -> Stateful<Div> {
        let actions = self.navigation_actions(cx);
        let settings = div().relative()
            .child(self.settings_menu(self.sidebar_collapsed, cx))
            .child(self.view_bounds.settings.probe("settings".into()))
            .into_any_element();
        let current_app = match self.navigation.current() {
            Some(WorkspaceItem::App { name, .. }) => Some(name.clone()),
            _ => None,
        };
        let connectors_enabled = self.apps.entries.iter().any(|app| app.name == "connectors" && app.enabled);
        let apps = self.apps.entries.iter().filter(|app| app.listed_in_sidebar(connectors_enabled)).filter_map(|app| {
            let panel = app.panels.first()?;
            Some(sidebar::AppShortcut {
                badge: self.apps.badges.get(&app.name).map(ToString::to_string),
                name: app.name.clone(), panel: panel.id.clone(),
                label: self.installed_app_title(&app.name, &app.display_name),
                placement: app.placement(),
                icon: pero_chat_ui::icon_theme::app_icon(&app.name, pero_theme::UiAppearance::global(cx).dark),
                active: app.shortcut_selected(current_app.as_deref(), connectors_enabled),
            })
        }).collect();
        let projects = self.project_catalog(cx);
        let active_project = match self.navigation.current() {
            Some(WorkspaceItem::Project(key)) => Some(key.as_str()),
            _ => None,
        };
        let environment = self.sidebar_environment(current_app.as_deref());
        sidebar::sidebar(self.ui(cx), width, sidebar::SidebarProps {
            shortcut_bounds: &self.view_bounds.sidebar,
            project_bounds: &self.view_bounds.projects,
            navigation: self.navigation.page(), catalog_open: self.navigation.current().is_none(),
            terminal_open: self.terminal.visible, local_connected: self.connected, collapsed: self.sidebar_collapsed,
            projects_collapsed: self.projects_collapsed,
            apps, environment, projects, active_project,
        }, settings, actions, cx)
    }

    /// Environment activity stays in the sidebar unless this page already shows it.
    /// The web shell has its own preparation overlay, so this row is native only.
    fn sidebar_environment(&self, current_app: Option<&str>) -> Option<sidebar::EnvironmentStatus> {
        #[cfg(target_family = "wasm")]
        {
            let _ = current_app;
            return None;
        }
        #[cfg(not(target_family = "wasm"))]
        {
            let preparation = self.apps.preparation.as_ref()?;
            let catalog_open = self.navigation.current().is_none();
            let surface_shows = catalog_open || current_app == Some(preparation.name.as_str());
            let value = crate::apps::sidebar_environment(Some(preparation), surface_shows)?;
            let entry = self.apps.entries.iter().find(|app| app.name == value.name);
            let display = entry.map(|app| app.display_name.as_str()).unwrap_or(value.name.as_str());
            let panel = entry.and_then(|app| app.panels.first()).map(|panel| panel.id.clone()).unwrap_or_default();
            Some(sidebar::EnvironmentStatus {
                name: value.name.clone(),
                panel,
                title: self.installed_app_title(&value.name, display),
                label_key: value.sidebar_label_key(),
                needs_action: value.activity() == Some(crate::apps::EnvironmentActivity::NeedsAction),
            })
        }
    }

    pub(crate) fn toggle_sidebar(&mut self, cx: &mut Context<Self>) {
        self.sidebar_collapsed = !self.sidebar_collapsed;
        cx.notify();
    }

    pub(crate) fn sidebar_resize(&self, window: &Window, cx: &mut Context<Self>) -> impl IntoElement {
        let p = &pero_theme::UiAppearance::global(cx).palette.clone();
        let seam = Hsla { l: (p.border.l - 0.06).max(0.), ..p.border };
        let below_band = pero_theme::Chrome::from_app(cx).control(pero_theme::WINDOW_TITLEBAR)
            + px(pero_theme::RADIUS_PANEL + 4.);
        div()
            .id("sidebar-resize")
            .group("sidebar-resize")
            .track_focus(&self.sidebar_resize_focus)
            .role(Role::Splitter)
            .aria_label(self.t("workspace.resize_sidebar"))
            .aria_numeric_value(self.preferences.layout.sidebar_width().into())
            .absolute()
            .top_0()
            .right_0()
            .w(px(4.))
            .h_full()
            .child(div().absolute().right_0().top(below_band).bottom_0().w(px(1.))
                .group_hover("sidebar-resize", |el| el.bg(seam))
                .when(self.sidebar_resize_focus.is_focused(window), |el| el.bg(seam)))
            .cursor(CursorStyle::ResizeLeftRight)
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(|this, event: &MouseDownEvent, window, cx| {
                    this.sidebar_resize_focus.focus(window, cx);
                    if event.click_count == 2 {
                        this.preferences.layout.resize_sidebar(
                            pero_contracts::workbench::LayoutPreferences::default().sidebar_width());
                        this.save_preferences(this.preferences.clone(), cx);
                    } else {
                        this.resizing_sidebar = true;
                    }
                    cx.stop_propagation();
                    cx.notify();
                }),
            )
            .on_key_down(cx.listener(|this, event: &KeyDownEvent, _, cx| {
                use pero_contracts::workbench::LayoutPreferences as L;
                let width = match event.keystroke.key.as_str() {
                    "left" => this.preferences.layout.sidebar_width() - 20.,
                    "right" => this.preferences.layout.sidebar_width() + 20.,
                    "home" => L::MIN_SIDEBAR_WIDTH.into(),
                    "end" => L::MAX_SIDEBAR_WIDTH.into(),
                    "enter" => L::default().sidebar_width(),
                    _ => return,
                };
                this.preferences.layout.resize_sidebar(width);
                this.save_preferences(this.preferences.clone(), cx);
                cx.stop_propagation();
            }))
    }

    fn resize_layout_at(&mut self, position: Point<Pixels>, released: bool, window: &Window, cx: &mut Context<Self>) {
        self.resize_document_pane(position, cx);
        if self.project_agents.resizing_inspector {
            let viewport = f32::from(window.viewport_size().width);
            self.resize_inspector(viewport - f32::from(position.x), viewport, released, cx);
            if released { self.project_agents.resizing_inspector = false; }
        }
        if self.resizing_sessions {
            let x: f32 = position.x.into();
            self.preferences.layout.resize_sessions(x - self.layout.sidebar_width);
            cx.notify();
        }
        if let Some(drag) = &self.chat_dock_drag {
            let width: f32 = window.viewport_size().width.into();
            match drag {
                ChatDockDrag::Guide(guide) => {
                    let (layout, offset) = guide.read(cx).preview_layout(
                        position.x, width, self.layout, self.preferences.layout,
                    );
                    if released {
                        if offset != px(0.) {
                            self.preferences.layout = layout;
                        }
                    } else {
                        guide.update(cx, |guide, cx| guide.move_to(offset, cx));
                    }
                }
                ChatDockDrag::Live => {
                    self.preferences.layout.resize_chat(width - f32::from(position.x));
                    cx.notify();
                }
            }
        }
        if self.resizing_sidebar {
            let viewport: f32 = window.viewport_size().width.into();
            let x: f32 = position.x.into();
            let width = WorkspaceLayout::sidebar_span(viewport, x);
            self.preferences.layout.resize_sidebar(width);
            cx.notify();
        }
    }

    fn layout_drag_events(&self, cx: &Context<Self>) -> impl IntoElement + use<> {
        let owner = cx.entity().downgrade();
        canvas(|_, _, _| (), move |_, _, window, _| {
            // Keep drag/up delivery even when the pointer crosses a retained native child.
            // Hiding that child used to turn the entire App blank during a layout drag.
            let move_owner = owner.clone();
            window.on_mouse_event(move |event: &MouseMoveEvent, phase, window, cx| {
                if !phase.capture() { return; }
                let _ = move_owner.update(cx, |this, cx| {
                    if !this.project_agents.resizing_inspector && !this.resizing_sidebar && this.chat_dock_drag.is_none() && !this.resizing_sessions && this.pane_resize.is_none() { return; }
                    this.resize_layout_at(event.position, false, window, cx);
                    cx.stop_propagation();
                });
            });
            window.on_mouse_event(move |event: &MouseUpEvent, phase, window, cx| {
                if !phase.capture() || event.button != MouseButton::Left { return; }
                let _ = owner.update(cx, |this, cx| {
                    if !this.project_agents.resizing_inspector && !this.resizing_sidebar && this.chat_dock_drag.is_none() && !this.resizing_sessions && this.pane_resize.is_none() { return; }
                    // AppKit can deliver release before the next overlay frame.
                    this.resize_layout_at(event.position, true, window, cx);
                    if this.pane_resize.take().is_some() {
                        this.queue_workspace_checkpoint(cx);
                        cx.notify();
                    }
                    if this.chat_dock_drag.take().is_some() {
                        this.save_preferences(this.preferences.clone(), cx);
                        cx.notify();
                    }
                    if this.resizing_sessions {
                        this.resizing_sessions = false;
                        this.save_preferences(this.preferences.clone(), cx);
                        cx.notify();
                    }
                    if this.resizing_sidebar {
                        this.resizing_sidebar = false;
                        this.save_preferences(this.preferences.clone(), cx);
                        cx.notify();
                    }
                    cx.stop_propagation();
                });
            });
        }).absolute().size_full()
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
            .and_then(|item| {
                self.navigation
                    .titlebar_tabs()
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
        let resizing = self.project_agents.resizing_inspector || self.resizing_sidebar || self.chat_dock_drag.is_some() || self.resizing_sessions || self.pane_resize.is_some();
        let window_overlay = self.spotlight.is_some()
            || self.settings_panel.is_some()
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
            self.settings_menu_open
                || self.pane_tabs.switching()
                || gpui_kit::component::GlobalState::is_in_deferred_context(cx),
            chat_dock_menu,
            resizing,
            SurfaceStacking::CURRENT,
        );
        let mut layout = WorkspaceLayout::resolve(
            width,
            self.navigation.route(),
            self.tab,
            &self.preferences.layout,
            covered,
            pane_layout,
        );
        if self.project_agent_active() {
            layout.chat = ChatPlacement::Main;
            layout.chat_width = 0.;
            layout.content_visible = true;
        }
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
        if self.project_agent_active() && width - layout.sidebar_width < crate::project_agent::PROJECT_SPLIT_MIN {
            layout.narrow = true;
        }
        let project_chat_was_hidden = self.project_context_in_place(cx);
        self.layout = layout;
        let project_insights_visible = self.project_insights_id().is_some()
            && self.apps.project_insights_requested
            && self.project_inspector_visible(cx)
            && !covered;
        if project_insights_visible {
            layout.embedded_surface_visible = true;
            self.layout = layout;
        }
        if project_chat_was_hidden != self.project_context_in_place(cx) {
            let workbench = cx.entity().downgrade();
            cx.defer(move |cx| {
                let _ = workbench.update(cx, |this, cx| this.sync_follow(cx));
            });
        }
        #[cfg(not(target_family = "wasm"))]
        let app_window_modal = self.native_window_modal(cx);
        let external_resource_navigation =
            self.project_agent_active() || self.conversation_resources_in_titleband();
        self.chat.update(cx,|chat,cx| {
            #[cfg(not(target_family = "wasm"))]
            let covered = covered || app_window_modal.is_some();
            chat.set_artifact_surface_covered(covered,cx);
            chat.external_resource_navigation = external_resource_navigation;
            let docked = layout.chat == ChatPlacement::Dock;
            if chat.docked != docked { chat.docked = docked; cx.notify(); }
        });
        self.sync_artifact_preview(cx);
        #[cfg(not(target_family="wasm"))]
        self.sync_inline_mcp(cx);
        let sidebar_width = layout.sidebar_width;
        let sessions = (self.navigation.page() == WorkbenchPage::Conversation && self.tab == ConversationTab::Chat)
            .then(|| self.preferences.layout.visible_sessions_width(width - sidebar_width))
            .flatten()
            .map(|width| self.sessions_panel(width, window, cx).into_any_element());
        let chat_width = layout.chat_width;
        let dock = layout.chat == ChatPlacement::Dock;
        let narrow = layout.narrow;
        let project_split = self.project_inspector_width(width, cx).is_some();
        let resources_width = self.claimed_resources_width(width, cx);
        let dock_span = if dock {
            (chat_width - resources_width).max(0.)
        } else {
            chat_width
        };
        let insights_app_selected = matches!(self.navigation.current(), Some(WorkspaceItem::App { name, .. }) if name == "insights");
        if (cfg!(not(target_family = "wasm")) && (project_insights_visible || insights_app_selected))
            || !layout.embedded_surface_visible
            || (!project_insights_visible && !matches!(self.navigation.current(), Some(WorkspaceItem::App { .. })))
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
        let workbench = div()
            .id("workbench")
            .relative()
            .map(|el| self.shortcut_handlers(el, cx))
            .track_focus(&self.workspace_focus)
            .when(self.pane_tabs.switching(), |el| {
                el.key_context("PeroWorkbench PaneTabSwitcher")
            })
            .when(!self.pane_tabs.switching(), |el| {
                el.key_context(if window.has_active_dialog(cx) { "WebSurface" } else { "PeroWorkbench WebSurface" })
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
            .on_action(cx.listener(|this, _: &gpui_kit::component::input::Copy, window, cx| {
                let selected = gpui_kit::base::TextSelection::selected_text(window, cx);
                if selected.trim().is_empty() && this.forward_web_editing("copy", cx) {
                    return;
                }
                cx.propagate();
            }))
            .on_action(cx.listener(|this, _: &gpui_kit::component::input::Cut, _, cx| {
                if !this.forward_web_editing("cut", cx) {
                    cx.propagate();
                }
            }))
            .on_action(cx.listener(|this, _: &gpui_kit::component::input::Paste, _, cx| {
                #[cfg(not(target_family = "wasm"))]
                if this.paste_app_text(cx) {
                    return;
                }
                if !this.forward_web_editing("paste", cx) {
                    cx.propagate();
                }
            }))
            .on_action(cx.listener(|this, _: &gpui_kit::component::input::SelectAll, _, cx| {
                if !this.forward_web_editing("selectAll", cx) {
                    cx.propagate();
                }
            }))
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
            .child(self.layout_drag_events(cx))
            .child(
                div()
                    .flex_1()
                    .min_h_0()
                    .w_full()
                    .flex()
                    .bg(p.surface_muted)
                    .child(self.sidebar_column(&dragging, window, cx))
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .h_full()
                            .flex()
                            .flex_col()
                            .bg(p.surface_muted)
                            .child(
                                div()
                                    .flex_1()
                                    .min_h_0()
                                    .flex()
                                    .flex_col()
                                    .child(
                                        div()
                                            .id("workbench-columns")
                                            .flex_1()
                                            .min_h_0()
                                            .w_full()
                                            .flex()
                                            .child(
                                                div()
                                                    .id("workbench-main-column")
                                                    .flex_1()
                                                    .min_w_0()
                                                    .h_full()
                                                    .flex()
                                                    .flex_col()
                                                    .child(self.main_titleband(&dragging, window, cx))
                                                    .child(
                                                        div()
                                                            .flex_1()
                                                            .min_h_0()
                                                            .relative()
                                                            .flex()
                                                            .flex_col()
                                                            .when(!project_split, |el| el.child(pero_theme::edge_shadow_plate(p.border)))
                                                            .child(
                                                        div()
                                                            .flex_1()
                                                            .min_h_0()
                                                            .relative()
                                                            .overflow_hidden()
                                                            .flex()
                                                            .flex_col()
                                                            .rounded_tl(px(pero_theme::RADIUS_PANEL))
                                                            .when(project_split, |el| el.border_t(px(0.5)).border_color(p.border))
                                                            // Reading surface owns the cutout. Opaque children
                                                            // must not repaint a square fill over this corner.
                                                            .bg(p.surface)
                                                            .child(
                                                                canvas(
                                                                    |bounds, _, _| note_content_corner(bounds.origin),
                                                                    |_, _, _, _| {},
                                                                )
                                                                .absolute()
                                                                .top_0()
                                                                .left_0()
                                                                .size_full(),
                                                            )
                    .children(self.recovery_controls(cx))
                    .when(self.error.is_some(), |el| {
                        el.child(
                            div()
                                .id("workbench-error")
                                .role(Role::Alert)
                                .flex()
                                .items_center()
                                .gap(px(8.))
                                .px(px(20.))
                                .py(px(10.))
                                .bg(p.error_bg)
                                .text_color(p.error)
                                .child(
                                    div().flex_1().min_w_0().child(
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
                                .child(
                                    Button::new("workbench-error-dismiss")
                                        .ghost()
                                        .small()
                                        .label(self.t("error.dismiss"))
                                        .on_click(cx.listener(|this, _, _, cx| {
                                            this.error = None;
                                            cx.notify();
                                        })),
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
                                        .when(
                                            self.navigation.page() == WorkbenchPage::Projects,
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
                                el.child(self.chat_dock(dock_span, narrow, window, cx))
                            })
                            .when(floating, |el| {
                                el.child(self.floating_app_chat(width, window, cx))
                            }),
                    )
                                                        )
                                                    ),
                                            )
                                            .when(resources_width > 0., |row| {
                                                row.child(self.resources_column(&dragging, window, cx))
                                            }),
                                    )
                    .when(self.terminal.visible, |el| el.child(self.terminal_panel((f32::from(window.viewport_size().height)*0.4).clamp(180.,320.),cx))),
                                )
                    )
            )
            .when(self.spotlight.is_some(), |el| {
                el.child(self.spotlight_overlay(cx))
            })
            .when(resizing, |el| {
                // A transparent input layer retains the drag in GPUI while the
                // native App continues painting below it.
                el.child(deferred(div().id("layout-drag-input").absolute().top_0().left_0().w(window.viewport_size().width).h(window.viewport_size().height).occlude()
                    .cursor(if self.pane_resize.as_ref().is_some_and(|resize| resize.axis == pero_contracts::workspace_panes::PaneAxis::Vertical) {
                        CursorStyle::ResizeUpDown
                    } else { CursorStyle::ResizeLeftRight })).with_priority(gpui_kit::base::POPUP_PRIORITY))
            });
        #[cfg(not(target_family = "wasm"))]
        let workbench = workbench.when_some(app_window_modal, |el, owner| {
            let WorkspaceItem::App { name, panel } = owner else { return el; };
            let page = self.native_app_pages[&(name, panel)].view.clone();
            el.child(div().id("app-window-backdrop").absolute().inset_0().occlude().bg(Rgba {
                r: 0.,
                g: 0.,
                b: 0.,
                a: pero_theme::MODAL_BACKDROP_OPACITY,
            }).on_any_mouse_down(move |_, window, cx| {
                let page = page.clone();
                window.defer(cx, move |_, cx| {
                    let page = page.read(cx);
                    if page.window_modal {
                        page.focus(cx);
                    }
                });
            }))
        });
        workbench
    }
}
