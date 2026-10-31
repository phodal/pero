use super::{ActionHandler, Ui, click};
use crate::workspace::WorkbenchPage;
use gpui_kit::{
    component::{
        menu::{DropdownMenu, PopupMenuItem},
        *,
    },
    prelude::*,
    *,
};
pub(crate) struct RecentRow {
    pub bounds: Option<AnyElement>,
    pub label: String,
    pub icon: Option<&'static str>,
    pub active: bool,
    pub busy: bool,
    pub attention: bool,
    pub action: SidebarAction,
    pub delete: Option<DeleteAffordance>,
}
pub(crate) struct DeleteAffordance {
    pub request: SidebarAction,
    pub confirm: SidebarAction,
    pub cancel: SidebarAction,
}
pub(crate) struct ProjectGroup {
    pub key: String,
    pub name: String,
    pub collapsed: bool,
    pub revealed: usize,
    pub rows: Vec<RecentRow>,
}
pub(crate) struct AppShortcut {
    pub placement: crate::apps::AppPlacement,
    pub name: String, pub panel: String, pub label: String, pub icon: String, pub active: bool,
}
pub(crate) struct SidebarProps<'a> {
    pub shortcut_bounds: &'a crate::view_bounds::ViewBounds,
    pub navigation: WorkbenchPage,
    pub catalog_open: bool,
    pub terminal_open: bool,
    pub identity: String,
    pub local_connected: bool,
    pub collapsed: bool,
    pub apps: Vec<AppShortcut>,
}
pub(crate) struct SessionsProps<'a> {
    pub empty_text: &'static str,
    pub groups: Vec<ProjectGroup>, pub ungrouped: Vec<RecentRow>,
    pub new_chat_bounds: &'a crate::view_bounds::ViewBounds,
}

#[derive(Clone)]
pub(crate) enum SidebarAction {
    Terminal,
    NewChat,
    Navigate(WorkbenchPage),
    OpenApp { name: String, panel: String },
    ToggleProject(String),
    RevealSessions(String),
    SelectSession(usize),
    RequestDelete(usize),
    ConfirmDelete(usize),
    CancelDelete,
}

fn recent_row(
    ui: Ui<'_>,
    row: RecentRow,
    index: usize,
    on_action: &ActionHandler<SidebarAction>,
    cx: &App,
) -> impl IntoElement {
    let chrome = ui.chrome();
    let title = row.label.clone();
    let accessible = if row.attention {
        format!("{} · {}", title, ui.t("insights.attention"))
    } else {
        title.clone()
    };
    let lead = if row.attention {
        Some("alert-circle")
    } else {
        row.icon
    };
    let trailing = row
        .delete
        .map(|delete| session_menu(ui, index, &title, delete, on_action, chrome, cx));
    pero_theme::interaction_row(
        ("recent-work", index),
        row.active,
        pero_theme::ROW_NAV,
        chrome,
    )
    .relative().children(row.bounds)
    .cursor_pointer()
    .overflow_hidden()
    .pl(chrome.geo(pero_theme::SPACE_8))
    .pr(chrome.geo(pero_theme::SPACE_8))
    .gap(chrome.geo(pero_theme::ICON_GAP))
    .aria_label(accessible)
    .on_click(click(on_action, row.action))
    .child(
        div()
            .w(chrome.geo(pero_theme::LEAD_BOX))
            .h(chrome.geo(pero_theme::LEAD_BOX))
            .flex_shrink_0()
            .flex()
            .items_center()
            .justify_center()
            .children(lead.map(|name| ui.icon(name))),
    )
    .child(
        div()
            .flex_1()
            .min_w_0()
            .overflow_hidden()
            .whitespace_nowrap()
            .text_ellipsis()
            .line_height(relative(1.2))
            .child(row.label),
    )
    .when(row.attention || row.busy, |el| el.child(div().text_size(px(12.)).text_color(if row.attention {ui.palette.warning} else {ui.palette.text_muted})
        .child(ui.t(if row.attention {"cloud.group.attention"} else {"filter.running"}))))
    .children(trailing)
}

fn session_menu(
    ui: Ui<'_>,
    index: usize,
    title: &str,
    delete: DeleteAffordance,
    on_action: &ActionHandler<SidebarAction>,
    chrome: pero_theme::Chrome<'_>,
    cx: &App,
) -> impl IntoElement {
    let label = ui.t("chat.delete_confirm");
    let request = delete.request;
    let confirm = delete.confirm;
    let cancel = delete.cancel;
    let on_delete = on_action.clone();
    let on_dismiss = on_action.clone();
    div()
        .id(("recent-actions", index))
        .flex_shrink_0()
        .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
        .on_click(|_, _, cx| cx.stop_propagation())
        .child(
            pero_theme::ghost_icon_button(("recent-more", index), chrome, cx)
                .icon(Icon::default().path("icons/dots.svg"))
                .tooltip(ui.t("chat.actions"))
                .accessibility_label(format!("{}, {}", ui.t("chat.actions"), title))
                .dropdown_caret(false)
                .dropdown_menu_with_anchor(Anchor::TopRight, move |menu, _, _| {
                    let on_delete = on_delete.clone();
                    let request = request.clone();
                    let confirm = confirm.clone();
                    menu.min_w(px(148.))
                        .item(PopupMenuItem::new(label).on_click(move |_, window, cx| {
                            on_delete(&request, window, cx);
                            on_delete(&confirm, window, cx);
                        }))
                })
                .on_open_change(move |open, window, cx| {
                    if !*open {
                        on_dismiss(&cancel, window, cx);
                    }
                }),
        )
}

fn project_header(
    ui: Ui<'_>,
    group_index: usize,
    group: &ProjectGroup,
    on_action: &ActionHandler<SidebarAction>,
    chrome: pero_theme::Chrome<'_>,
    cx: &App,
) -> impl IntoElement + use<> {
    let label = format!("{} {}", ui.t(if group.collapsed {"project.expand"} else {"project.collapse"}), group.name);
    pero_theme::ghost_icon_button(("session-group",group_index),chrome,cx)
        .w_full().h(chrome.geo(pero_theme::ROW_NAV))
        .child(div().w_full().flex().items_center().gap(chrome.geo(pero_theme::ICON_GAP))
            .child(Icon::default().path(if group.collapsed {"icons/chevron-right.svg"} else {"icons/chevron-down.svg"}))
            .child(div().min_w_0().text_ellipsis().child(group.name.clone())))
        .accessibility_label(label)
        .on_click(click(on_action,SidebarAction::ToggleProject(group.key.clone())))
}

fn show_more(
    ui: Ui<'_>,
    group_index: usize,
    key: String,
    on_action: &ActionHandler<SidebarAction>,
    chrome: pero_theme::Chrome<'_>,
) -> impl IntoElement {
    let hover = chrome.palette.text.opacity(0.14);
    let muted = chrome.palette.text_muted;
    div()
        .flex()
        .items_start()
        .pl(chrome.geo(
            pero_theme::SPACE_8
                + pero_theme::SUB_INDENT
                + pero_theme::LEAD_BOX
                + pero_theme::ICON_GAP,
        ))
        .pr(chrome.geo(pero_theme::SPACE_8))
        .py(chrome.geo(pero_theme::SPACE_4))
        .child(
            div()
                .id(("project-show-more", group_index))
                .self_start()
                .h(chrome.geo(pero_theme::ROW_SUB))
                .px(chrome.geo(pero_theme::SPACE_4))
                .rounded(chrome.geo(pero_theme::RADIUS_SELECTION))
                .flex()
                .items_center()
                .cursor_pointer()
                .hover(move |row| row.bg(hover))
                .text_size(chrome.text(pero_theme::TYPE_BODY))
                .text_color(muted)
                .child(ui.t("project.show_more"))
                .on_click(click(on_action, SidebarAction::RevealSessions(key))),
        )
}

/// Split window chrome. The search field is 32px; macOS traffic lights sit in the left inset.
pub(crate) const WINDOW_CHROME: f32 = 40.;

pub(crate) fn traffic_inset(window: &Window) -> f32 {
    if cfg!(target_os = "macos") && !window.is_fullscreen() {
        78.
    } else {
        8.
    }
}

/// The system title bar is transparent and this process owns dragging, so empty chrome starts a window move.
pub(crate) fn window_drag(
    el: Stateful<Div>,
    dragging: &Entity<bool>,
    window: &Window,
) -> Stateful<Div> {
    let dragging = dragging.clone();
    el.on_double_click(|_, window, _| window.titlebar_double_click())
        .on_mouse_down(
            MouseButton::Left,
            window.listener_for(&dragging, |dragging, _, _, _| *dragging = true),
        )
        .on_mouse_down_out(window.listener_for(&dragging, |dragging, _, _, _| *dragging = false))
        .on_mouse_up(
            MouseButton::Left,
            window.listener_for(&dragging, |dragging, _, _, _| *dragging = false),
        )
        .on_mouse_move(window.listener_for(&dragging, |dragging, _, window, _| {
            if *dragging {
                *dragging = false;
                window.start_window_move();
            }
        }))
}

pub(crate) fn keep_click(el: Div) -> Div {
    el.on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
}

pub(crate) fn sessions(ui: Ui<'_>, width: f32, props: SessionsProps<'_>, search: AnyElement, on_action: ActionHandler<SidebarAction>, cx: &App) -> Stateful<Div> {
    let p = ui.palette; let chrome = ui.chrome(); let mut index = 0;
    let empty = props.groups.is_empty() && props.ungrouped.is_empty();
    div().id("sessions-list").w(px(width)).flex_shrink_0().h_full().flex().flex_col()
        .bg(p.surface).border_r_1().border_color(p.border).p(px(8.))
        .child(div().flex().items_center().justify_between().gap(px(8.)).mb(px(8.))
            .child(div().font_weight(FontWeight::SEMIBOLD).child(ui.t("nav.sessions")))
            .child(pero_theme::action_button("sessions-new", ui.t("chat.new"), pero_theme::ActionKind::Primary, chrome, cx)
                .icon(Icon::default().path("icons/plus.svg"))
                .relative().child(props.new_chat_bounds.probe("new-chat".into()))
                .on_click(click(&on_action, SidebarAction::NewChat))))
        .child(div().mb(px(8.)).child(search))
        .when(empty, |el| el.child(div().p(px(8.)).text_color(p.text_muted).child(props.empty_text)))
.child(
                    div()
                        .id("sidebar-project-scroll")
                        .flex_1()
                        .min_h_0()
                        .overflow_y_scroll()
                        .children(props.groups.into_iter().enumerate().map(
                            |(group_index, group)| {
                                let header =
                                    project_header(ui, group_index, &group, &on_action, chrome, cx);
                                let key = group.key.clone();
                                let revealed = group.revealed;
                                let collapsed = group.collapsed;
                                let (sessions, tasks): (Vec<_>, Vec<_>) =
                                    group.rows.into_iter().partition(|row| {
                                        matches!(row.action, SidebarAction::SelectSession(_))
                                    });
                                let more = sessions.len() > revealed;
                                let empty = sessions.is_empty() && tasks.is_empty();
                                let mut session_rows = Vec::new();
                                for row in sessions.into_iter().take(revealed) {
                                    index += 1;
                                    session_rows.push(
                                        recent_row(ui, row, index, &on_action, cx)
                                            .into_any_element(),
                                    );
                                }
                                let mut task_rows = Vec::new();
                                for row in tasks {
                                    index += 1;
                                    task_rows.push(
                                        recent_row(ui, row, index, &on_action, cx)
                                            .into_any_element(),
                                    );
                                }
                                div().mb(px(4.)).child(header).when(!collapsed, |el| {
                                    el.child(
                                        div()
                                            .flex()
                                            .flex_col()
                                            .children(session_rows)
                                            .when(more, |el| {
                                                el.child(show_more(
                                                    ui,
                                                    group_index,
                                                    key,
                                                    &on_action,
                                                    chrome,
                                                ))
                                            })
                                            .children(task_rows)
                                            .when(empty, |el| {
                                                el.child(
                                                    div()
                                                        .pl(chrome.geo(
                                                            pero_theme::SPACE_8
                                                                + pero_theme::SUB_INDENT,
                                                        ))
                                                        .pr(chrome.geo(pero_theme::SPACE_8))
                                                        .py(px(8.))
                                                        .text_size(px(
                                                            pero_theme::TextRole::Caption
                                                                .pixels(ui.typography.ui),
                                                        ))
                                                        .text_color(p.text_muted)
                                                        .child(ui.t("project.no_recent")),
                                                )
                                            }),
                                    )
                                })
                            },
                        ))
                        .when(!props.ungrouped.is_empty(), |el| {
                            el.child(
                                div()
                                    .pt(px(8.))
                                    .child(
                                        div()
                                            .px(px(8.))
                                            .py(px(5.))
                                            .text_size(px(pero_theme::TextRole::Caption
                                                .pixels(ui.typography.ui)))
                                            .text_color(p.text_muted)
                                            .child(ui.t("project.unassigned")),
                                    )
                                    .children(props.ungrouped.into_iter().enumerate().map(
                                        |(i, row)| recent_row(ui, row, 100000 + i, &on_action, cx),
                                    )),
                            )
                        }),
                )
}

pub(crate) fn sidebar(ui: Ui<'_>, width: f32, props: SidebarProps<'_>, settings: AnyElement, on_action: ActionHandler<SidebarAction>, cx: &App) -> Stateful<Div> {
    let p = ui.palette; let chrome = ui.chrome(); let collapsed = props.collapsed;
    let nav = |id: &'static str, label: &'static str, icon: &'static str, selected: bool, action: SidebarAction| {
        let element = if collapsed {
            pero_theme::ghost_icon_button(id, chrome, cx).selected(selected).icon(Icon::default().path(icon))
                .tooltip(label).accessibility_label(label).on_click(click(&on_action, action)).into_any_element()
        } else {
            pero_theme::sidebar_row(id, label, None, None, selected, pero_theme::RowLevel::Nav,
                Some(Icon::default().path(icon).into_any_element()), chrome, click(&on_action, action)).into_any_element()
        };
        div().w_full().flex().justify_center().child(element)
    };
    use crate::apps::AppPlacement;
    let mut workspace = Vec::new(); let mut catalog = Vec::new(); let mut customize = Vec::new();
    for (index, app) in props.apps.into_iter().enumerate() {
        match app.placement { AppPlacement::Workspace => workspace.push((index, app)), AppPlacement::Customize => customize.push((index, app)), AppPlacement::Catalog => catalog.push((index, app)) }
    }
    workspace.sort_by_key(|(_, app)| if app.name == "paper-agent" { 0 } else { 1 });
    let app_rows = |apps: Vec<(usize, AppShortcut)>| apps.into_iter().map(|(index, app)| {
                let action = SidebarAction::OpenApp { name: app.name.clone(), panel: app.panel };
                let element = if collapsed {
                    pero_theme::ghost_icon_button(("sidebar-app", index), chrome, cx)
                        .selected(app.active).icon(Icon::default().path(app.icon)).tooltip(app.label.clone()).accessibility_label(app.label)
                        .on_click(click(&on_action, action)).into_any_element()
                } else {
                    pero_theme::sidebar_row(("sidebar-app", index), app.label, None, None, app.active, pero_theme::RowLevel::Nav,
                        Some(Icon::default().path(app.icon).into_any_element()), chrome, click(&on_action, action)).into_any_element()
                };
                div().relative().w_full().flex().justify_center().child(element).child(props.shortcut_bounds.probe(app.name))
            }).collect::<Vec<_>>();
    div().id("sidebar").w(px(width)).h_full().flex_shrink_0().flex().flex_col()
        .bg(p.surface_muted).text_color(p.text).text_size(chrome.text(pero_theme::TYPE_BODY))
        .border_r_1().border_color(p.border).p(px(8.)).gap(px(4.))
        .child(nav("sidebar-sessions", ui.t("nav.sessions"), "icons/message-circle.svg", props.navigation == WorkbenchPage::Conversation, SidebarAction::Navigate(WorkbenchPage::Conversation))
            .relative().child(props.shortcut_bounds.probe("sessions".into())))
        .child(nav("sidebar-projects", ui.t("nav.projects"), "icons/folder.svg", matches!(props.navigation, WorkbenchPage::Projects | WorkbenchPage::Tasks), SidebarAction::Navigate(WorkbenchPage::Projects)))
        .child(div().id("sidebar-app-scroll").flex_1().min_h_0().overflow_y_scroll()
            .when(!collapsed, |el| el.child(div().px(px(8.)).pt(px(16.)).pb(px(4.)).text_color(p.text_muted).text_size(px(12.)).child(ui.t("nav.workspace"))))
            .children(app_rows(workspace))
            .when(!collapsed, |el| el.child(div().px(px(8.)).py(px(6.)).flex().justify_between().text_color(p.disabled_text)
                .child(ui.t("nav.environment")).child(div().text_size(px(12.)).child(ui.t("nav.todo")))))
            .when(!collapsed, |el| el.child(div().px(px(8.)).pt(px(16.)).pb(px(4.)).text_color(p.text_muted).text_size(px(12.)).child(ui.t("nav.apps"))))
            .child(nav("sidebar-apps", ui.t("apps.manage"), "icons/layout-grid.svg", props.navigation == WorkbenchPage::Apps && props.catalog_open, SidebarAction::Navigate(WorkbenchPage::Apps)).relative().child(props.shortcut_bounds.probe("apps".into())))
            .children(app_rows(catalog)))
        .child(nav("sidebar-terminal", ui.t("terminal.title"), "icons/terminal.svg", props.terminal_open, SidebarAction::Terminal).relative().child(props.shortcut_bounds.probe("terminal".into())))
        .when(!props.local_connected && !collapsed, |el| el.child(div().px(px(8.)).py(px(6.)).text_color(p.warning).text_size(px(12.)).child(ui.t("status.disconnected"))))
        .children(app_rows(customize))
        .child(pero_theme::ghost_icon_button("sidebar-automations", chrome, cx)
            .w_full().h(chrome.geo(pero_theme::ROW_NAV)).px(px(8.)).text_size(chrome.text(pero_theme::TYPE_BODY))
            .disabled(true).accessibility_label(ui.t("nav.automations"))
            .icon(Icon::default().path("icons/clock.svg"))
            .when(!collapsed, |button| button.child(div().w_full().flex().items_center().justify_between()
                .child(ui.t("nav.automations"))
                .child(div().text_size(px(12.)).child(ui.t("nav.todo"))))))
        .child(settings)
        .when(!collapsed, |el| el.child(div().mt(px(4.)).border_t_1().border_color(p.border).px(px(8.)).py(px(8.))
            .text_ellipsis().child(props.identity)))
}
