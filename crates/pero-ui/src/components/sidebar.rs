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
    pub key: String,
    pub bounds: Option<AnyElement>,
    pub label: String,
    pub active: bool,
    pub status: pero_chat_ui::session_state::SessionListStatus,
    pub unread: bool,
    pub menu_open: bool,
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
    pub workspace: Option<String>,
    pub collapsed: bool,
    pub revealed: usize,
    pub rows: Vec<RecentRow>,
}
pub(crate) struct AppShortcut {
    pub badge: Option<String>,
    pub placement: crate::apps::AppPlacement,
    pub name: String, pub panel: String, pub label: String, pub icon: String, pub active: bool,
}
pub(crate) struct SidebarProps<'a> {
    pub shortcut_bounds: &'a crate::view_bounds::ViewBounds,
    pub new_chat_bounds: &'a crate::view_bounds::ViewBounds,
    pub navigation: WorkbenchPage,
    pub catalog_open: bool,
    pub terminal_open: bool,
    pub local_connected: bool,
    pub collapsed: bool,
    pub apps: Vec<AppShortcut>,
    pub context_navigation: Option<AnyElement>,
}
pub(crate) struct SessionsProps {
    pub empty_text: &'static str,
    pub searching: bool,
    pub groups: Vec<ProjectGroup>, pub ungrouped: Vec<RecentRow>,
}

#[derive(Clone)]
pub(crate) enum SidebarAction {
    Terminal,
    NewChat,
    NewProjectChat(String),
    ToggleSessionSearch,
    SessionMenu(Option<String>),
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
    use pero_chat_ui::session_state::SessionListStatus as S;
    let chrome = ui.chrome();
    let (icon, color, status) = match row.status {
        S::Quiet => (None, ui.palette.info, None),
        S::Preparing => (Some("clock"), ui.palette.info, Some(ui.t("chat.preparing_app"))),
        S::Running => (Some("loader-circle"), ui.palette.info, Some(ui.t("filter.running"))),
        S::NeedsInput => (Some("message-circle"), ui.palette.warning, Some(ui.t("chat.question_waiting"))),
        S::Failed => (Some("alert-circle"), ui.palette.error, Some(ui.t("cloud.phase.failed"))),
        S::Authentication => (Some("shield"), ui.palette.warning, Some(ui.t("roadmap.auth_required"))),
        S::Completed => (Some("circle-check"), ui.palette.success, Some(ui.t("research.completed"))),
        S::Cancelled => (Some("circle-x"), ui.palette.text_muted, Some(ui.t("project.agent.cancelled"))),
        S::Interrupted => (Some("player-pause"), ui.palette.warning, Some(ui.t("project.agent.interrupted"))),
    };
    let mut accessible = status.map(|status| format!("{} · {}", row.label, status)).unwrap_or_else(|| row.label.clone());
    if row.unread { accessible = format!("{} · {}", accessible, ui.t("sessions.unread")); }
    let lead = icon.map(|name| div().id(("session-status",index)).size(chrome.geo(pero_theme::SESSION_STATUS))
        .flex().items_center().justify_center()
        .child(ui.icon(name).size(chrome.geo(pero_theme::SESSION_STATUS)).text_color(color))
        .when_some(status, |el,label|el.tooltip(move |window,cx|gpui_kit::component::tooltip::Tooltip::new(label).build(window,cx)))
        .into_any_element())
        .or_else(|| row.unread.then(|| div().size(px(6.)).rounded_full().bg(ui.palette.info).into_any_element()));
    let trailing = row.delete.map(|delete| {
        pero_theme::session_actions(("session-actions", index), row.active || row.menu_open,
            session_menu(ui, index, &row.key, &row.label, delete, on_action, chrome, cx)).into_any_element()
    });
    pero_theme::session_row(row.key, row.label, accessible, row.active,
        lead, trailing, chrome, cx, click(on_action, row.action))
        .relative().children(row.bounds)
}

fn session_menu(
    ui: Ui<'_>,
    index: usize,
    key: &str,
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
    let key = key.to_owned();
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
                    on_dismiss(&SidebarAction::SessionMenu(open.then(|| key.clone())), window, cx);
                    if !*open { on_dismiss(&cancel, window, cx); }
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
    let accent = pero_theme::project_accent(&group.key, chrome);
    div().w_full().flex().items_center().mt(chrome.geo(pero_theme::SPACE_8)).mb(chrome.geo(pero_theme::SPACE_4))
        .child(pero_theme::ghost_icon_button(("session-group",group_index),chrome,cx)
            .flex_1().min_w_0().h(chrome.control(pero_theme::SESSION_ROW))
            .px(chrome.geo(pero_theme::SPACE_8)).text_size(chrome.text(pero_theme::TYPE_TAB))
            .child(div().w_full().flex().items_center().gap(chrome.geo(pero_theme::ICON_GAP))
                .child(Icon::default().path(if group.collapsed {"icons/chevron-right.svg"} else {"icons/chevron-down.svg"}).size(px(12.)))
                .child(Icon::default().path("icons/folder.svg").size(chrome.geo(pero_theme::SESSION_STATUS)).text_color(accent))
                .child(div().min_w_0().text_ellipsis().child(group.name.clone())))
            .accessibility_label(label)
            .on_click(click(on_action,SidebarAction::ToggleProject(group.key.clone()))))
        .children(group.workspace.clone().map(|workspace| {
            let label = format!("{} · {}", ui.t("chat.new"), group.name);
            pero_theme::ghost_icon_button(("project-new-chat", group_index), chrome, cx)
                .icon(Icon::default().path("icons/plus.svg")).tooltip(label.clone()).accessibility_label(label)
                .on_click(click(on_action, SidebarAction::NewProjectChat(workspace)))
        }))
}

fn show_more(
    ui: Ui<'_>,
    group_index: usize,
    key: String,
    on_action: &ActionHandler<SidebarAction>,
    chrome: pero_theme::Chrome<'_>,
    cx: &App,
) -> impl IntoElement {
    div().pl(chrome.geo(pero_theme::SPACE_8)).child(
        pero_theme::action_button(("project-show-more", group_index), ui.t("project.show_more"),
            pero_theme::ActionKind::Ghost, chrome, cx)
            .text_color(chrome.palette.text_muted).text_size(chrome.text(pero_theme::TYPE_CAPTION))
            .on_click(click(on_action, SidebarAction::RevealSessions(key))))
}

/// Shared window metric; native traffic lights occupy the leading inset.
pub(crate) const WINDOW_CHROME: f32 = pero_theme::WINDOW_TITLEBAR;

pub(crate) fn traffic_inset(window: &Window) -> f32 {
    if cfg!(target_os = "macos") && !window.is_fullscreen() {
        crate::layout::TRAFFIC_LIGHT_INSET
    } else {
        crate::layout::WINDOW_LEADING_INSET
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

pub(crate) fn sessions(ui: Ui<'_>, width: f32, props: SessionsProps, search: AnyElement, on_action: ActionHandler<SidebarAction>, cx: &App) -> Stateful<Div> {
    let p = ui.palette; let chrome = ui.chrome(); let mut index = 0;
    let empty = props.groups.is_empty() && props.ungrouped.is_empty();
    div().id("sessions-list").w(px(width)).flex_shrink_0().h_full().flex().flex_col()
        .bg(p.surface).border_r(px(1.)).border_color(p.border).p(px(8.))
        .child(div().flex().items_center().justify_between().gap(chrome.geo(pero_theme::SPACE_8))
            .child(div().pl(chrome.geo(pero_theme::SPACE_8)).text_size(chrome.text(pero_theme::TYPE_TAB)).text_color(p.text_muted).child(ui.t("nav.sessions")))
            .child(pero_theme::ghost_icon_button("session-search-toggle", chrome, cx)
                .selected(props.searching).icon(Icon::default().path("icons/search.svg"))
                .tooltip(ui.t("sessions.search")).accessibility_label(ui.t("sessions.search"))
                .on_click(click(&on_action, SidebarAction::ToggleSessionSearch))))
        .when(props.searching, |el| el.child(div().mt(chrome.geo(pero_theme::SPACE_4)).mb(chrome.geo(pero_theme::SPACE_8)).child(search)))
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
                                                    cx,
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

/// Current Project's Agent conversations share the ordinary session row owner.
pub(crate) fn project_navigation(ui: Ui<'_>, group: ProjectGroup, on_action: ActionHandler<SidebarAction>, cx: &App) -> AnyElement {
    let chrome = ui.chrome();
    let header = project_header(ui, 300000, &group, &on_action, chrome, cx);
    let more = group.rows.len() > group.revealed;
    let rows = group.rows.into_iter().take(group.revealed).enumerate().map(|(index,row)|
        recent_row(ui,row,300000+index,&on_action,cx).into_any_element()).collect::<Vec<_>>();
    div().id("project-agent-navigation").w_full().flex().flex_col()
        .child(header)
        .when(!group.collapsed, |el| el.children(rows).when(more, |el|
            el.child(show_more(ui,300000,group.key,&on_action,chrome,cx))))
        .into_any_element()
}

pub(crate) fn sidebar(ui: Ui<'_>, width: f32, props: SidebarProps<'_>, settings: AnyElement, on_action: ActionHandler<SidebarAction>, cx: &App) -> Stateful<Div> {
    let p = ui.palette; let chrome = ui.chrome(); let collapsed = props.collapsed;
    let nav = |id: &'static str, label: &'static str, icon: &'static str, selected: bool, action: SidebarAction| {
        let element = if collapsed {
            pero_theme::ghost_icon_button(id, chrome, cx).selected(selected)
                .when(selected, |button| button.border_color(chrome.palette.action))
                .icon(Icon::default().path(icon))
                .tooltip(label).accessibility_label(label).on_click(click(&on_action, action)).into_any_element()
        } else {
            pero_theme::sidebar_row(id, label, None, None, selected, pero_theme::RowLevel::Nav,
                Some(Icon::default().path(icon).into_any_element()), chrome, cx, click(&on_action, action)).into_any_element()
        };
        div().w_full().flex().justify_center().child(element)
    };
    use crate::apps::AppPlacement;
    let mut automation = Vec::new(); let mut primary = Vec::new(); let mut workspace = Vec::new(); let mut catalog = Vec::new(); let mut customize = Vec::new();
    for (index, app) in props.apps.into_iter().enumerate() {
        match app.placement {
            AppPlacement::Automation => automation.push((index, app)),
            AppPlacement::Primary => primary.push((index, app)),
            AppPlacement::Workspace | AppPlacement::WorkspaceCatalog => workspace.push((index, app)),
            AppPlacement::Customize => customize.push((index, app)),
            AppPlacement::Catalog => catalog.push((index, app)),
        }
    }
    workspace.sort_by_key(|(_, app)| if app.name == "paper-agent" { 0 } else { 1 });
    let app_rows = |apps: Vec<(usize, AppShortcut)>| apps.into_iter().map(|(index, app)| {
                let action = SidebarAction::OpenApp { name: app.name.clone(), panel: app.panel };
                let element = if collapsed {
                    pero_theme::ghost_icon_button(("sidebar-app", index), chrome, cx)
                        .selected(app.active)
                        .when(app.active, |button| button.border_color(chrome.palette.action))
                        .icon(Icon::default().path(app.icon)).tooltip(app.label.clone()).accessibility_label(app.label)
                        .on_click(click(&on_action, action)).into_any_element()
                } else {
                    pero_theme::sidebar_row(("sidebar-app", index), app.label, None, app.badge.map(Into::into), app.active, pero_theme::RowLevel::Nav,
                        Some(Icon::default().path(app.icon).into_any_element()), chrome, cx, click(&on_action, action)).into_any_element()
                };
                div().relative().w_full().flex().justify_center().child(element).child(props.shortcut_bounds.probe(app.name))
            }).collect::<Vec<_>>();
    pero_theme::sidebar_surface("sidebar", width, chrome)
        .text_size(chrome.text(pero_theme::TYPE_BODY))
        .child(div().w_full().flex().items_center().gap(chrome.geo(pero_theme::SPACE_4))
            .when(collapsed, |row| row.flex_col())
            .child(nav("sidebar-sessions", ui.t("nav.sessions"), "icons/message-circle.svg", props.navigation == WorkbenchPage::Conversation, SidebarAction::Navigate(WorkbenchPage::Conversation))
                .flex_1().min_w_0().relative().child(props.shortcut_bounds.probe("sessions".into())))
            // Independent sibling controls keep navigation and creation separate.
            .child(div().relative().flex_shrink_0()
                .child(pero_theme::ghost_icon_button("sidebar-new", chrome, cx)
                    .icon(Icon::default().path("icons/plus.svg"))
                    .tooltip(ui.t("chat.new")).accessibility_label(ui.t("chat.new"))
                    .on_click(click(&on_action, SidebarAction::NewChat)))
                .child(props.new_chat_bounds.probe("new-chat".into()))))
        .child(nav("sidebar-projects", ui.t("nav.projects"), "icons/folder.svg", matches!(props.navigation, WorkbenchPage::Projects | WorkbenchPage::Tasks), SidebarAction::Navigate(WorkbenchPage::Projects)).relative().child(props.shortcut_bounds.probe("projects".into())))
        .children(app_rows(primary))
        .child(div().id("sidebar-app-scroll").flex_1().min_h_0().overflow_y_scroll()
            .children(props.context_navigation)
            .when(!workspace.is_empty(), |scroll| scroll.child(pero_theme::sidebar_group(None, true, chrome).children(app_rows(workspace))))
            .child(pero_theme::sidebar_group(None, true, chrome)
            .child(nav("sidebar-apps", ui.t("apps.manage"), "icons/layout-grid.svg", props.navigation == WorkbenchPage::Apps && props.catalog_open, SidebarAction::Navigate(WorkbenchPage::Apps)).relative().child(props.shortcut_bounds.probe("apps".into())))
            .children(app_rows(catalog))))
        .child(nav("sidebar-terminal", ui.t("terminal.title"), "icons/terminal.svg", props.terminal_open, SidebarAction::Terminal).relative().child(props.shortcut_bounds.probe("terminal".into())))
        .when(!props.local_connected && !collapsed, |el| el.child(div().px(px(8.)).py(px(6.)).text_color(p.warning).text_size(px(12.)).child(ui.t("status.disconnected"))))
        .children(app_rows(customize))
        .children(app_rows(automation))
        .child(settings)
}
