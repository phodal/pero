//! The shell lays titleband segments out at the column widths.
//! It does not choose which actions belong to a column.
use crate::app::Workbench;
use crate::components::sidebar::{self, keep_click, window_drag};
use crate::layout::ChatPlacement;
use crate::titleband::{self, Action, ColumnKind, MainFocus, Primary, Segment, SegmentWidth};
use crate::workspace::{WorkbenchPage, WorkspaceItem, WorkspaceRoute};
use gpui_kit::{component::Icon, prelude::*, *};
use serde_json::json;

impl Workbench {
    pub(crate) fn focused_app(&self) -> Option<(String, String)> {
        match self.focused_item()? {
            WorkspaceItem::App { name, panel } => Some((name, panel)),
            _ => None,
        }
    }

    fn focused_item(&self) -> Option<WorkspaceItem> {
        if self.navigation.pane_layout_visible() {
            let layout = self.navigation.pane_layout()?;
            let leaf = layout.leaf(layout.focused?)?;
            match leaf.route()? {
                WorkspaceRoute::Content(item) => Some(item.clone()),
                _ => None,
            }
        } else {
            self.navigation.current().cloned()
        }
    }

    pub(crate) fn web_in_titleband(&self) -> bool {
        let web = self.web_entry_open
            || matches!(self.focused_item(), Some(WorkspaceItem::Web(_)))
            || self.navigation.page() == WorkbenchPage::Web;
        let multi = self.navigation.pane_layout_visible()
            && self
                .navigation
                .pane_layout()
                .is_some_and(|layout| layout.leaves().len() > 1);
        web && !multi
    }

    fn resource_band_claimed(&self, cx: &App) -> bool {
        // A conversation leaf inside a pane split is not a workbench column; its toolbar stays in the pane.
        if self.navigation.pane_layout_visible()
            && self
                .navigation
                .pane_layout()
                .is_some_and(|layout| layout.conversation().is_some())
        {
            return false;
        }
        matches!(self.layout.chat, ChatPlacement::Main | ChatPlacement::Dock)
            && self.chat.read(cx).resource_column.is_some()
    }

    fn content_tabs_hold_chat_toggle(&self) -> bool {
        let single = self.navigation.pane_layout_visible()
            && self
                .navigation
                .pane_layout()
                .is_some_and(|layout| layout.leaves().len() == 1);
        !self.web_in_titleband() && !single && self.workspace_controls_visible()
    }

    fn workspace_controls_visible(&self) -> bool {
        self.navigation.titlebar_tabs().next().is_some()
            || matches!(self.navigation.current(), Some(WorkspaceItem::Project(_)))
    }

    fn titleband_open_chat(&self) -> bool {
        if self.content_tabs_hold_chat_toggle() {
            return false;
        }
        !self.preferences.layout.chat_open
            && self
                .navigation
                .pane_layout()
                .is_none_or(|layout| layout.conversation().is_none())
            && matches!(
                self.focused_item(),
                Some(
                    WorkspaceItem::App { .. }
                        | WorkspaceItem::Web(_)
                        | WorkspaceItem::Document { .. }
                        | WorkspaceItem::Task(_)
                )
            )
    }

    fn titleband_close_chat(&self, cx: &App) -> bool {
        if self.content_tabs_hold_chat_toggle() {
            return false;
        }
        self.layout.chat == ChatPlacement::Dock && self.resource_band_claimed(cx)
    }

    fn focused_column_app(&self, cx: &App) -> Option<titleband::FocusedApp> {
        let (name, panel) = self.focused_app()?;
        if self.apps.preparation.as_ref().is_some_and(|value| {
            value.name == name && value.phase != "ready"
        }) {
            return None;
        }
        let actions = self
            .apps
            .entries
            .iter()
            .find(|app| app.name == name)
            .map(|app| {
                app.column_header
                    .actions
                    .iter()
                    .map(|action| titleband::DeclaredAction {
                        id: action.id.clone(),
                        label: column_label(&action.label, action.chinese_label.as_deref(), &self.locale),
                        icon: action.icon.clone(),
                    })
                    .collect()
            })
            .unwrap_or_default();
        Some(titleband::FocusedApp {
            failed: self.app_header_failed(&name, &panel, cx),
            actions,
        })
    }

    fn app_header_failed(&self, name: &str, panel: &str, cx: &App) -> bool {
        #[cfg(not(target_family = "wasm"))]
        {
            let key = (name.to_owned(), panel.to_owned());
            let open_error = self
                .native_app_pages
                .get(&key)
                .and_then(|page| page.view.read(cx).failure().map(str::to_owned));
            return open_error.is_some() || self.apps.error.is_some();
        }
        #[cfg(target_family = "wasm")]
        {
            let _ = (name, panel, cx);
            self.apps.error.is_some()
        }
    }

    fn project_titleband(&self, cx: &mut Context<Self>) -> titleband::Titleband {
        let claim = self.resource_band_claimed(cx);
        self.chat
            .update(cx, |chat, _| chat.host_titleband = claim);
        let resources = self.chat.read(cx).resource_column.filter(|_| claim).map(|column| {
            titleband::ResourcesColumn {
                width: column.width,
                primary: match column.primary {
                    pero_chat_ui::ResourcePrimary::Files => titleband::ResourcePrimary::Files,
                    pero_chat_ui::ResourcePrimary::Artifacts => titleband::ResourcePrimary::Artifacts,
                    pero_chat_ui::ResourcePrimary::Changes => titleband::ResourcePrimary::Changes,
                },
            }
        });
        titleband::project(&titleband::WorkbenchColumns {
            sidebar_width: self.layout.sidebar_width,
            main: titleband::MainColumn {
                focus: if self.web_in_titleband() {
                    MainFocus::Web
                } else {
                    MainFocus::Tabs
                },
                app: if self.web_in_titleband() {
                    None
                } else {
                    self.focused_column_app(cx)
                },
                open_chat: self.titleband_open_chat(),
                close_chat: self.titleband_close_chat(cx),
            },
            resources,
        })
    }

    pub(crate) fn claimed_resources_width(&mut self, cx: &mut Context<Self>) -> f32 {
        match self
            .project_titleband(cx)
            .segment(ColumnKind::Resources)
            .map(|segment| segment.width)
        {
            Some(SegmentWidth::Fixed(width)) => width,
            _ => 0.,
        }
    }

    pub(crate) fn sidebar_column(
        &self,
        dragging: &Entity<bool>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let width = self.layout.sidebar_width;
        let band = self.project_titleband(cx);
        let bg = self.ui(cx).palette.surface_muted;
        div()
            .id("titleband-sidebar-column")
            .w(px(width))
            .h_full()
            .flex_shrink_0()
            .flex()
            .flex_col()
            .relative()
            .bg(bg)
            .children(band.segment(ColumnKind::Sidebar).map(|segment| {
                self.sidebar_segment(segment, dragging, window, cx)
            }))
            .child(div().flex_1().min_h_0().child(self.sidebar(width, cx)))
            .when(!self.sidebar_collapsed, |el| {
                el.child(self.sidebar_resize(window, cx))
            })
    }

    pub(crate) fn main_titleband(
        &self,
        dragging: &Entity<bool>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let band = self.project_titleband(cx);
        let height = self.ui(cx).chrome().control(pero_theme::WINDOW_TITLEBAR);
        // Tabs stay on the chrome. The rounded app surface begins underneath.
        let bg = self.ui(cx).palette.surface_muted;
        div()
            .id("titleband-main-row")
            .w_full()
            .h(height)
            .flex_shrink_0()
            .flex()
            .bg(bg)
            .children(band.segment(ColumnKind::Main).map(|segment| {
                self.main_segment(segment, dragging, window, cx)
            }))
    }

    pub(crate) fn resources_column(
        &self,
        dragging: &Entity<bool>,
        window: &Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let Some(segment) = self
            .project_titleband(cx)
            .segment(ColumnKind::Resources)
            .cloned()
        else {
            return div().into_any_element();
        };
        let width = match segment.width {
            SegmentWidth::Fixed(width) => width,
            SegmentWidth::Fill => 0.,
        };
        let bg = resources_surface(&segment, &self.ui(cx).palette);
        let border = self.ui(cx).palette.border;
        let height = self.ui(cx).chrome().control(pero_theme::WINDOW_TITLEBAR);
        let body = self
            .chat
            .update(cx, |chat, cx| chat.resource_column_body(cx));
        div()
            .id("titleband-resources-column")
            .w(px(width))
            .h_full()
            .flex_shrink_0()
            .min_w_0()
            .flex()
            .flex_col()
            .bg(bg)
            .border_l(px(1.))
            .border_color(border)
            .child(
                div()
                    .h(height)
                    .w_full()
                    .flex_shrink_0()
                    .bg(bg)
                    .child(self.resources_segment(&segment, dragging, window, cx)),
            )
            .child(div().flex_1().min_h_0().min_w_0().overflow_hidden().bg(bg).child(body))
            .into_any_element()
    }

    fn sidebar_segment(
        &self,
        segment: &Segment,
        dragging: &Entity<bool>,
        window: &Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let width = match segment.width {
            SegmentWidth::Fixed(width) => width,
            SegmentWidth::Fill => self.layout.sidebar_width,
        };
        let height = self.ui(cx).chrome().control(pero_theme::WINDOW_TITLEBAR);
        let bg = self.ui(cx).palette.surface_muted;
        let (icon, label) = if self.sidebar_collapsed {
            ("icons/panel-left-open.svg", self.t("sidebar.show"))
        } else {
            ("icons/panel-left-close.svg", self.t("sidebar.hide"))
        };
        let toggle = segment
            .actions
            .iter()
            .any(|action| matches!(action, Action::SidebarToggle));
        window_drag(
            div()
                .id("titleband-sidebar")
                .w(px(width))
                .h(height)
                .flex_shrink_0()
                .flex()
                .items_center()
                .justify_end()
                .pl(px(sidebar::traffic_inset(window).min((width - 36.).max(0.))))
                .pr(px(pero_theme::SPACE_8))
                .bg(bg)
                .when(toggle, |el| {
                    el.child(keep_click(div()).child(
                        pero_theme::ghost_icon_button("sidebar-toggle", pero_theme::Chrome::from_app(cx), cx)
                            .icon(Icon::default().path(icon))
                            .tooltip(label)
                            .accessibility_label(label)
                            .on_click(cx.listener(|this, _, _, cx| this.toggle_sidebar(cx))),
                    ))
                }),
            dragging,
            window,
        )
        .into_any_element()
    }

    fn main_segment(
        &self,
        segment: &Segment,
        dragging: &Entity<bool>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let bg = self.ui(cx).palette.surface_muted;
        let primary = match segment.primary {
            Primary::Address => self.web_toolbar(true, cx).into_any_element(),
            Primary::Tabs => self.main_tabs(cx).into_any_element(),
            _ => div().into_any_element(),
        };
        let actions = self.main_actions(&segment.actions, cx);
        window_drag(
            div()
                .id("titleband-main")
                .flex_1()
                .min_w_0()
                .h_full()
                .flex()
                .items_center()
                .bg(bg)
                .child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .h_full()
                        .flex()
                        .items_center()
                        .child(primary),
                )
                .child(
                    keep_click(div())
                        .h_full()
                        .flex()
                        .items_center()
                        .flex_shrink_0()
                        .pr(px(pero_theme::SPACE_8))
                        .gap(px(pero_theme::SPACE_4))
                        .children(actions),
                ),
            dragging,
            window,
        )
        .into_any_element()
    }

    fn resources_segment(
        &self,
        segment: &Segment,
        dragging: &Entity<bool>,
        window: &Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let bg = resources_surface(segment, &self.ui(cx).palette);
        let toolbar = segment
            .actions
            .iter()
            .any(|action| matches!(action, Action::ResourceToolbar))
            .then(|| self.chat.update(cx, |chat, cx| chat.resource_column_toolbar(cx)));
        window_drag(
            div()
                .id("titleband-resources")
                .w_full()
                .h_full()
                .min_w_0()
                .flex()
                .items_center()
                .bg(bg)
                .children(toolbar),
            dragging,
            window,
        )
        .into_any_element()
    }

    fn main_tabs(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let single = self
            .navigation
            .pane_layout()
            .filter(|_| self.navigation.pane_layout_visible())
            .and_then(|layout| {
                let leaves = layout.leaves();
                (leaves.len() == 1).then(|| leaves[0].clone())
            });
        if let Some(leaf) = single {
            div().flex_1().min_w_0().h_full().child(self.pane_tab_bar(
                &leaf,
                crate::workspace_pane_tabs::TabBarPlacement::WindowChrome,
                cx,
            ))
        } else if self.workspace_controls_visible() {
            div()
                .flex_1()
                .min_w_0()
                .h_full()
                .child(self.content_tabs(false, cx))
        } else {
            div().flex_1().min_w_0().h_full()
        }
    }

    fn main_actions(&self, actions: &[Action], cx: &mut Context<Self>) -> Vec<AnyElement> {
        let mut painted = Vec::new();
        for action in actions {
            match action {
                Action::Search => {
                    let shortcut =
                        self.shortcut_label(pero_contracts::shortcuts::CommandId::SearchWorkspace, cx);
                    let label = format!("{}  {shortcut}", self.t("spotlight.open"));
                    painted.push(
                        pero_theme::ghost_icon_button("spotlight-open", pero_theme::Chrome::from_app(cx), cx)
                            .icon(Icon::default().path("icons/search.svg"))
                            .tooltip(label.clone())
                            .accessibility_label(label)
                            .on_click(cx.listener(|this, _, window, cx| this.toggle_spotlight(window, cx)))
                            .into_any_element(),
                    );
                }
                Action::WebRefresh => {
                    if let Some(button) = self.web_refresh_button(cx) {
                        painted.push(button);
                    }
                }
                Action::Retry => {
                    let label = self.t("apps.retry_open");
                    painted.push(
                        pero_theme::action_button("titleband-retry", label, pero_theme::ActionKind::Primary, pero_theme::Chrome::from_app(cx), cx)
                            .on_click(cx.listener(|this, _, _, cx| this.retry_focused_app(cx)))
                            .into_any_element(),
                    );
                }
                Action::OpenChat => painted.push(
                    pero_theme::ghost_icon_button("titleband-chat-open", pero_theme::Chrome::from_app(cx), cx)
                        .icon(Icon::default().path("icons/panel-right-open.svg"))
                        .tooltip(self.t("chat.open_panel"))
                        .accessibility_label(self.t("chat.open_panel"))
                        .on_click(cx.listener(|this, _, _, cx| this.set_chat_dock(true, cx)))
                        .into_any_element(),
                ),
                Action::CloseChat => painted.push(
                    pero_theme::ghost_icon_button("titleband-chat-close", pero_theme::Chrome::from_app(cx), cx)
                        .icon(Icon::default().path("icons/panel-right-close.svg"))
                        .tooltip(self.t("chat.close_panel"))
                        .accessibility_label(self.t("chat.close_panel"))
                        .on_click(cx.listener(|this, _, _, cx| this.set_chat_dock(false, cx)))
                        .into_any_element(),
                ),
                Action::App { id, label, icon } => {
                    let element_id = SharedString::from(format!("titleband-app-{id}"));
                    let id_owned = id.clone();
                    let button = if let Some(path) = icon.as_deref().and_then(shared_icon) {
                        pero_theme::ghost_icon_button(element_id, pero_theme::Chrome::from_app(cx), cx)
                            .icon(Icon::default().path(path))
                            .tooltip(label.clone())
                            .accessibility_label(label.clone())
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.deliver_column_header_action(&id_owned, cx)
                            }))
                            .into_any_element()
                    } else {
                        pero_theme::action_button(
                            element_id,
                            label.clone(),
                            pero_theme::ActionKind::Ghost,
                            pero_theme::Chrome::from_app(cx),
                            cx,
                        )
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.deliver_column_header_action(&id_owned, cx)
                        }))
                        .into_any_element()
                    };
                    painted.push(button);
                }
                Action::SidebarToggle | Action::ResourceToolbar => {}
            }
        }
        painted
    }

    fn retry_focused_app(&mut self, cx: &mut Context<Self>) {
        let Some((name, panel)) = self.focused_app() else { return };
        #[cfg(not(target_family = "wasm"))]
        {
            self.native_app_pages.remove(&(name.clone(), panel.clone()));
            self.pending_app = Some((name.clone(), panel));
            self.refresh_apps(cx);
        }
        #[cfg(target_family = "wasm")]
        self.command(json!({"action":"apps_open","name":name,"panel":panel}), cx);
    }

    /// Posts the action on the existing host-to-app event channel.
    /// No installed app subscribes to `column-header` yet, so the click has no further effect.
    fn deliver_column_header_action(&mut self, id: &str, cx: &mut Context<Self>) {
        let Some((name, panel)) = self.focused_app() else { return };
        #[cfg(not(target_family = "wasm"))]
        if let Some(page) = self.native_app_pages.get(&(name, panel)) {
            page.view.read(cx).send(
                json!({"type":"pero:app:event","event":"column-header","value":{"id":id}}),
                cx,
            );
        }
        #[cfg(target_family = "wasm")]
        {
            let _ = cx;
            #[wasm_bindgen::prelude::wasm_bindgen]
            extern "C" {
                #[wasm_bindgen(js_namespace = window, js_name = peroColumnHeader, catch)]
                fn send(json: &str) -> Result<(), wasm_bindgen::JsValue>;
            }
            let _ = send(&json!({"name":name,"panel":panel,"id":id}).to_string());
        }
    }
}

fn resources_surface(segment: &Segment, palette: &pero_theme::Palette) -> Hsla {
    match segment.primary {
        Primary::Resource(titleband::ResourcePrimary::Files) => palette.surface_muted,
        Primary::Resource(_) => palette.surface,
        _ => palette.bg,
    }
}

fn column_label(label: &str, chinese: Option<&str>, locale: &str) -> String {
    if locale.starts_with("zh") {
        chinese.unwrap_or(label).to_owned()
    } else {
        label.to_owned()
    }
}

fn shared_icon(name: &str) -> Option<&'static str> {
    let path = pero_chat_ui::assets::UiIcon::named(name).path();
    path.strip_prefix("icons/")?
        .strip_suffix(".svg")
        .filter(|stem| *stem == name)
        .map(|_| path)
}
