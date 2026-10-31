use super::{ActionHandler, Ui, click};
use crate::workspace::WorkbenchPage;
use gpui_kit::{
    component::{
        input::{Input, InputState},
        menu::{DropdownMenu, PopupMenuItem},
        tooltip::Tooltip,
        *,
    },
    prelude::*,
    *,
};
use pero_chat_ui::theme::WorkbenchStyle as W;

pub(crate) struct RecentRow {
    pub label: String,
    pub icon: &'static str,
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
    pub path: String,
    pub active: bool,
    pub collapsed: bool,
    pub revealed: usize,
    pub rows: Vec<RecentRow>,
}
pub(crate) struct SidebarProps<'a> {
    pub navigation: WorkbenchPage,
    pub insights_open: bool,
    pub local_connected: bool,
    pub groups: Vec<ProjectGroup>,
    pub ungrouped: Vec<RecentRow>,
    pub search: &'a Entity<InputState>,
}
#[derive(Clone)]
pub(crate) enum SidebarAction {
    NewChat,
    Navigate(WorkbenchPage),
    OpenApp { name: String, panel: String },
    ToggleSidebar,
    OpenProject(String),
    ToggleProject(String),
    RevealSessions(String),
    SelectSession(usize),
    SelectTask(String),
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
    } else if row.busy {
        Some("clock")
    } else if row.icon != "terminal" {
        Some(row.icon)
    } else {
        None
    };
    let trailing = row
        .delete
        .map(|delete| session_menu(ui, index, &title, delete, on_action, chrome, cx));
    pero_theme::interaction_row(("recent-work", index), row.active, pero_theme::ROW_NAV, chrome)
        .cursor_pointer()
        .overflow_hidden()
        .pl(chrome.geo(pero_theme::SPACE_8 + pero_theme::SUB_INDENT))
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
                    menu.min_w(px(148.)).item(PopupMenuItem::new(label).on_click(
                        move |_, window, cx| {
                            on_delete(&request, window, cx);
                            on_delete(&confirm, window, cx);
                        },
                    ))
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
) -> impl IntoElement + use<> {
    let p = ui.palette;
    let hover = p.text.opacity(0.08);
    let path = group.path.clone();
    let name = group.name.clone();
    let collapsed = group.collapsed;
    let key = group.key.clone();
    div()
        .id(("project-header", group_index))
        .w_full()
        .h(chrome.geo(pero_theme::ROW_NAV))
        .pl(chrome.geo(pero_theme::SPACE_8))
        .pr(chrome.geo(pero_theme::SPACE_8))
        .flex()
        .items_center()
        .gap(chrome.geo(pero_theme::ICON_GAP))
        .rounded(chrome.geo(pero_theme::RADIUS_SELECTION))
        .text_size(chrome.text(pero_theme::TYPE_BODY))
        .text_color(if group.active { p.text } else { p.text_muted })
        .hover(move |row| row.bg(hover))
        .child(
            div()
                .id(("project-disclosure", group_index))
                .w(chrome.geo(pero_theme::LEAD_BOX))
                .h_full()
                .flex_shrink_0()
                .flex()
                .items_center()
                .justify_center()
                .cursor_pointer()
                .aria_label(format!(
                    "{} {}",
                    ui.t(if collapsed {
                        "project.expand"
                    } else {
                        "project.collapse"
                    }),
                    &name
                ))
                .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
                .on_click(click(
                    on_action,
                    SidebarAction::ToggleProject(key.clone()),
                ))
                .child(Icon::default().path(if collapsed {
                    "icons/chevron-right.svg"
                } else {
                    "icons/chevron-down.svg"
                })),
        )
        .child({
            let open = format!("{} {}", ui.t("project.open"), name);
            div()
                .id(("sidebar-project", group_index))
                .min_w_0()
                .flex_1()
                .h_full()
                .flex()
                .items_center()
                .cursor_pointer()
                .aria_label(open)
                .when(!path.is_empty(), |row| {
                    let path = path.clone();
                    row.tooltip(move |window, cx| Tooltip::new(path.clone()).build(window, cx))
                })
                .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
                .on_click(click(on_action, SidebarAction::OpenProject(key)))
                .child(div().min_w_0().flex_1().text_ellipsis().child(name))
        })
}

fn show_more(
    ui: Ui<'_>,
    group_index: usize,
    key: String,
    on_action: &ActionHandler<SidebarAction>,
    chrome: pero_theme::Chrome<'_>,
) -> impl IntoElement {
    let rest = chrome.palette.text.opacity(0.08);
    let hover = chrome.palette.text.opacity(0.14);
    let muted = chrome.palette.text_muted;
    div()
        .pl(chrome.geo(
            pero_theme::SPACE_8 + pero_theme::SUB_INDENT + pero_theme::LEAD_BOX + pero_theme::ICON_GAP,
        ))
        .pr(chrome.geo(pero_theme::SPACE_8))
        .py(chrome.geo(pero_theme::SPACE_4))
        .child(
            div()
                .id(("project-show-more", group_index))
                .self_start()
                .h(chrome.geo(pero_theme::ROW_SUB))
                .px(chrome.geo(pero_theme::SPACE_12))
                .rounded(chrome.geo(pero_theme::RADIUS_SELECTION))
                .flex()
                .items_center()
                .cursor_pointer()
                .bg(rest)
                .hover(move |row| row.bg(hover))
                .text_size(chrome.text(pero_theme::TYPE_BODY))
                .text_color(muted)
                .child(ui.t("project.show_more"))
                .on_click(click(on_action, SidebarAction::RevealSessions(key))),
        )
}

pub(crate) fn sidebar(
    ui: Ui<'_>,
    width: f32,
    props: SidebarProps<'_>,
    settings: AnyElement,
    on_action: ActionHandler<SidebarAction>,
    cx: &App,
) -> Stateful<Div> {
    let p = ui.palette;
    let chrome = ui.chrome();
    let mut index = 0;
    let projects_active = matches!(
        props.navigation,
        WorkbenchPage::Projects | WorkbenchPage::Tasks
    );
    div()
        .id("sidebar")
        .w(px(width))
        .h_full()
        .flex_shrink_0()
        .flex()
        .flex_col()
        .bg(p.surface_muted)
        .text_size(chrome.text(pero_theme::TYPE_BODY))
        .text_color(p.text)
        .border_r_1()
        .border_color(p.border)
        .p(px(pero_theme::SPACE_8))
        .gap(px(pero_theme::SPACE_4))
        .child(pero_theme::sidebar_row(
            "sidebar-insights",
            ui.t("nav.insights"),
            None,
            None,
            props.insights_open,
            pero_theme::RowLevel::Nav,
            Some(Icon::default().path("icons/layout-list.svg").into_any_element()),
            chrome,
            click(&on_action, SidebarAction::OpenApp { name: "insights".into(), panel: "main".into() }),
        ))
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(pero_theme::ICON_GAP))
                .child(
                    div().min_w_0().flex_1().child(pero_theme::sidebar_row(
                        "sidebar-new-chat",
                        ui.t("chat.new"),
                        None,
                        None,
                        false,
                        pero_theme::RowLevel::Nav,
                        Some(Icon::new(IconName::Plus).into_any_element()),
                        chrome,
                        click(&on_action, SidebarAction::NewChat),
                    )),
                )
                .child(
                    div().flex_shrink_0().child(
                        pero_theme::ghost_icon_button("sidebar-collapse", chrome, cx)
                            .icon(Icon::default().path("icons/panel-left-close.svg"))
                            .tooltip(ui.t("sidebar.hide"))
                            .accessibility_label(ui.t("sidebar.hide"))
                            .on_click(click(&on_action, SidebarAction::ToggleSidebar)),
                    ),
                ),
        )
        .child(pero_theme::sidebar_row(
            "sidebar-projects",
            ui.t("nav.projects"),
            None,
            None,
            projects_active,
            pero_theme::RowLevel::Nav,
            Some(Icon::default().path("icons/folder.svg").into_any_element()),
            chrome,
            click(&on_action, SidebarAction::Navigate(WorkbenchPage::Projects)),
        ))
        .child(
            pero_theme::search_field(Input::new(props.search), chrome)
                .prefix(ui.icon("search").size(px(W::ICON)))
                .w_full(),
        )
        .child(
            div()
                .id("sidebar-project-scroll")
                .flex_1()
                .min_h_0()
                .overflow_y_scroll()
                .children(
                    props
                        .groups
                        .into_iter()
                        .enumerate()
                        .map(|(group_index, group)| {
                            let header = project_header(ui, group_index, &group, &on_action, chrome);
                            let key = group.key.clone();
                            let revealed = group.revealed;
                            let collapsed = group.collapsed;
                            let (sessions, tasks): (Vec<_>, Vec<_>) = group
                                .rows
                                .into_iter()
                                .partition(|row| matches!(row.action, SidebarAction::SelectSession(_)));
                            let more = sessions.len() > revealed;
                            let empty = sessions.is_empty() && tasks.is_empty();
                            let mut session_rows = Vec::new();
                            for row in sessions.into_iter().take(revealed) {
                                index += 1;
                                session_rows.push(
                                    recent_row(ui, row, index, &on_action, cx).into_any_element(),
                                );
                            }
                            let mut task_rows = Vec::new();
                            for row in tasks {
                                index += 1;
                                task_rows.push(
                                    recent_row(ui, row, index, &on_action, cx).into_any_element(),
                                );
                            }
                            div()
                                .mb(px(4.))
                                .child(header)
                                .when(!collapsed, |el| {
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
                                                            pero_theme::SPACE_8 + pero_theme::SUB_INDENT,
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
                        }),
                )
                .when(!props.ungrouped.is_empty(), |el| {
                    el.child(
                        div()
                            .pt(px(8.))
                            .child(
                                div()
                                    .px(px(8.))
                                    .py(px(5.))
                                    .text_size(px(
                                        pero_theme::TextRole::Caption.pixels(ui.typography.ui)
                                    ))
                                    .text_color(p.text_muted)
                                    .child(ui.t("project.unassigned")),
                            )
                            .children(
                                props
                                    .ungrouped
                                    .into_iter()
                                    .enumerate()
                                    .map(|(i, row)| recent_row(ui, row, 100000 + i, &on_action, cx)),
                            ),
                    )
                }),
        )
        .child(
            div()
                .pt(px(8.))
                .border_t_1()
                .border_color(p.border)
                .flex()
                .flex_col()
                .gap(px(2.))
                .child(pero_theme::sidebar_row(
                    "sidebar-apps",
                    ui.t("nav.apps"),
                    None,
                    None,
                    props.navigation == WorkbenchPage::Apps && !props.insights_open,
                    pero_theme::RowLevel::Nav,
                    Some(Icon::default().path("icons/file-code.svg").into_any_element()),
                    chrome,
                    click(&on_action, SidebarAction::Navigate(WorkbenchPage::Apps)),
                )),
        )
        .when(!props.local_connected, |el| {
            el.child(
                div()
                    .px(px(8.))
                    .py(px(6.))
                    .text_size(px(pero_theme::TextRole::Caption.pixels(ui.typography.ui)))
                    .text_color(p.warning)
                    .child(ui.t("status.disconnected")),
            )
        })
        .child(
            div()
                .pt(px(8.))
                .border_t_1()
                .border_color(p.border)
                .child(settings),
        )
}
