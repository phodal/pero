use super::{ActionHandler, Ui, click};
use crate::workspace::WorkbenchPage;
use gpui_kit::{
    component::{
        input::{Input, InputState},
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
    pub confirming: bool,
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
    pub rows: Vec<RecentRow>,
}
pub(crate) struct SidebarProps<'a> {
    pub navigation: WorkbenchPage,
    pub local_connected: bool,
    pub groups: Vec<ProjectGroup>,
    pub ungrouped: Vec<RecentRow>,
    pub search: &'a Entity<InputState>,
}
#[derive(Clone)]
pub(crate) enum SidebarAction {
    NewChat,
    Navigate(WorkbenchPage),
    OpenProject(String),
    ToggleProject(String),
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
    let trailing = row.delete.map(|delete| {
        let request = delete.request.clone();
        let confirm = delete.confirm.clone();
        let cancel = delete.cancel.clone();
        let confirm_title = title.clone();
        div()
            .id(("recent-actions", index))
            .flex_shrink_0()
            .flex()
            .items_center()
            .gap(chrome.geo(pero_theme::ICON_GAP))
            .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
            .on_click(|_, _, cx| cx.stop_propagation())
            .when(!delete.confirming, |el| {
                el.child(
                    pero_theme::ghost_icon_button(("recent-delete", index), chrome, cx)
                        .icon(Icon::default().path("icons/x.svg"))
                        .tooltip(ui.t("chat.delete"))
                        .accessibility_label(format!("{}, {}", ui.t("chat.delete"), title))
                        .on_click(click(on_action, request)),
                )
            })
            .when(delete.confirming, |el| {
                el.child(
                    pero_theme::action_button(
                        ("recent-delete-cancel", index),
                        ui.t("chat.delete_cancel"),
                        pero_theme::ActionKind::Ghost,
                        chrome,
                        cx,
                    )
                    .on_click(click(on_action, cancel)),
                )
                .child(
                    pero_theme::action_button(
                        ("recent-delete-confirm", index),
                        ui.t("chat.delete_confirm"),
                        pero_theme::ActionKind::Danger,
                        chrome,
                        cx,
                    )
                    .accessibility_label(format!("{}, {}", ui.t("chat.delete_confirm"), confirm_title))
                    .on_click(click(on_action, confirm)),
                )
            })
    });
    pero_theme::interaction_row(("recent-work", index), row.active, pero_theme::ROW_NAV, chrome)
        .cursor_pointer()
        .px(chrome.geo(pero_theme::SPACE_8))
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
                .text_ellipsis()
                .child(row.label),
        )
        .children(trailing)
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
            "sidebar-new-chat",
            ui.t("chat.new"),
            None,
            None,
            false,
            pero_theme::RowLevel::Nav,
            Some(Icon::new(IconName::Plus).into_any_element()),
            chrome,
            click(&on_action, SidebarAction::NewChat),
        ))
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
                            let count = group.rows.len();
                            let rows = group
                                .rows
                                .into_iter()
                                .map(|row| {
                                    index += 1;
                                    recent_row(ui, row, index, &on_action, cx)
                                })
                                .collect::<Vec<_>>();
                            div()
                                .mb(px(4.))
                                .child(
                                    div()
                                        .w_full()
                                        .h(chrome.geo(pero_theme::ROW_NAV))
                                        .flex()
                                        .items_center()
                                        .gap(chrome.geo(pero_theme::ICON_GAP))
                                        .text_color(p.text_muted)
                                        .child(
                                            pero_theme::ghost_icon_button(
                                                ("project-disclosure", group_index),
                                                chrome,
                                                cx,
                                            )
                                            .icon(Icon::default().path(if group.collapsed {
                                                "icons/chevron-right.svg"
                                            } else {
                                                "icons/chevron-down.svg"
                                            }))
                                            .accessibility_label(format!(
                                                "{} {}",
                                                ui.t(if group.collapsed {
                                                    "project.expand"
                                                } else {
                                                    "project.collapse"
                                                }),
                                                group.name
                                            ))
                                            .on_click(click(
                                                &on_action,
                                                SidebarAction::ToggleProject(group.key.clone()),
                                            )),
                                        )
                                        .child(
                                            pero_theme::action_button(
                                                ("sidebar-project", group_index),
                                                group.name.clone(),
                                                pero_theme::ActionKind::Ghost,
                                                chrome,
                                                cx,
                                            )
                                            .flex_1()
                                            .min_w_0()
                                            .justify_start()
                                            .text_color(if group.active { p.text } else { p.text_muted })
                                            .tooltip(group.path)
                                            .on_click(click(
                                                &on_action,
                                                SidebarAction::OpenProject(group.key),
                                            )),
                                        ),
                                )
                                .when(!group.collapsed, |el| {
                                    el.child(
                                        div().pl(px(22.)).flex().flex_col().children(rows).when(
                                            count == 0,
                                            |el| {
                                                el.child(
                                                    div()
                                                        .px(px(8.))
                                                        .py(px(8.))
                                                        .text_size(px(
                                                            pero_theme::TextRole::Caption
                                                                .pixels(ui.typography.ui),
                                                        ))
                                                        .text_color(p.text_muted)
                                                        .child(ui.t("project.no_recent")),
                                                )
                                            },
                                        ),
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
                    "sidebar-insights",
                    ui.t("nav.insights"),
                    None,
                    None,
                    props.navigation == WorkbenchPage::Insights,
                    pero_theme::RowLevel::Nav,
                    Some(Icon::default().path("icons/layout-list.svg").into_any_element()),
                    chrome,
                    click(&on_action, SidebarAction::Navigate(WorkbenchPage::Insights)),
                ))
                .child(pero_theme::sidebar_row(
                    "sidebar-apps",
                    ui.t("nav.apps"),
                    None,
                    None,
                    props.navigation == WorkbenchPage::Apps,
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
