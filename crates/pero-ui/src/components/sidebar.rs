use pero_chat_ui::theme::WorkbenchStyle as W;
use super::{ActionHandler, Ui, click};
use crate::workspace::WorkbenchPage;
use gpui_kit::{
    component::{
        button::*,
        input::{Input, InputState},
        *,
    },
    prelude::*,
    *,
};

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
) -> impl IntoElement {
    let title = row.label.clone();
    let label = if row.attention {
        format!("{} · {}", title, ui.t("insights.attention"))
    } else {
        title.clone()
    };
    let deletable = row.delete.is_some();
    let confirming = row.delete.as_ref().is_some_and(|delete| delete.confirming);
    let button = Button::new(("recent-work", index))
        .ghost()
        .small()
        .h(px(ui.typography.row_height()))
        .justify_start()
        .child(div().flex_1())
        .selected(row.active)
        .toggled(row.active)
        .icon(Icon::default().path(format!(
            "icons/{}.svg",
            if row.attention {
                "alert-circle"
            } else if row.busy {
                "clock"
            } else {
                row.icon
            }
        )))
        .label(row.label)
        .accessibility_label(label)
        .tooltip(title.clone())
        .on_click(click(on_action, row.action))
        .when(!deletable, |button| button.w_full())
        .when(deletable, |button| {
            button
                .flex_1()
                .min_w_0()
                .when(confirming, |button| button.max_w(px(96.)))
        });
    let delete = row.delete.map(|delete| {
        let request = delete.request.clone();
        let confirm = delete.confirm.clone();
        let cancel = delete.cancel.clone();
        let confirm_title = title.clone();
        div()
            .flex_shrink_0()
            .flex()
            .items_center()
            .gap(px(2.))
            .when(!delete.confirming, |el| {
                el.child(
                    Button::new(("recent-delete", index))
                        .ghost()
                        .small()
                        .w(px(ui.typography.control_height()))
                        .h(px(ui.typography.control_height()))
                        .icon(Icon::default().path("icons/x.svg"))
                        .tooltip(ui.t("chat.delete"))
                        .accessibility_label(format!("{}, {}", ui.t("chat.delete"), title))
                        .on_click(click(on_action, request)),
                )
            })
            .when(delete.confirming, |el| {
                el.child(
                    Button::new(("recent-delete-cancel", index))
                        .ghost()
                        .small()
                        .h(px(ui.typography.control_height()))
                        .label(ui.t("chat.delete_cancel"))
                        .on_click(click(on_action, cancel)),
                )
                .child(
                    Button::new(("recent-delete-confirm", index))
                        .outline()
                        .small()
                        .h(px(ui.typography.control_height()))
                        .label(ui.t("chat.delete_confirm"))
                        .accessibility_label(format!(
                            "{}, {}",
                            ui.t("chat.delete_confirm"),
                            confirm_title
                        ))
                        .on_click(click(on_action, confirm)),
                )
            })
    });
    div()
        .w_full()
        .h(px(ui.typography.row_height()))
        .flex()
        .items_center()
        .overflow_hidden()
        .child(button)

        .children(delete)
}

pub(crate) fn sidebar(
    ui: Ui<'_>,
    width: f32,
    props: SidebarProps<'_>,
    settings: AnyElement,
    on_action: ActionHandler<SidebarAction>,
) -> Stateful<Div> {
    let p = ui.palette;
    let mut index = 0;
    div()
        .id("sidebar")
        .w(px(width))
        .h_full()
        .flex_shrink_0()
        .flex()
        .flex_col()
        .bg(p.bg)
        .text_size(px(pero_theme::TextRole::Body.pixels(ui.typography.ui)))
        .border_r_1()
        .border_color(p.border)
        .p(px(W::INSET))
        .gap(px(W::GAP))
        .child(
            Button::new("sidebar-new-chat")
                .ghost()
                .small()
                .w_full()
                .h(px(34.))
                .justify_start()
                .child(div().flex_1())
                .icon(IconName::Plus)
                .label(ui.t("chat.new"))
                .on_click(click(&on_action, SidebarAction::NewChat)),
        )
        .child(
            Button::new("sidebar-projects")
                .ghost()
                .small()
                .w_full()
                .h(px(ui.typography.row_height()))
                .justify_start()
                .child(div().flex_1())
                .icon(Icon::default().path("icons/folder.svg"))
                .label(ui.t("nav.projects"))
                .selected(matches!(props.navigation, WorkbenchPage::Projects | WorkbenchPage::Tasks))
                .toggled(matches!(
                    props.navigation,
                    WorkbenchPage::Projects | WorkbenchPage::Tasks
                ))
                .on_click(click(
                    &on_action,
                    SidebarAction::Navigate(WorkbenchPage::Projects),
                )),
        )
        .child(
            div()
                .py(px(6.))
                .child(Input::new(props.search).h(px(ui.typography.control_height())).prefix(ui.icon("search").size(px(W::ICON))).w_full()),
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
                                    recent_row(ui, row, index, &on_action)
                                })
                                .collect::<Vec<_>>();
                            div()
                                .mb(px(8.))
                                .child(
                                    div()
                                        .flex()
                                        .items_center()
                                        .gap(px(2.))
                                        .child(
                                            Button::new(("project-disclosure", group_index))
                                                .ghost()
                                                .small()
                                                .w(px(26.))
                                                .h(px(ui.typography.row_height()))
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
                                            Button::new(("sidebar-project", group_index))
                                                .ghost()
                                                .small()
                                                .flex_1()
                                                .min_w_0()
                                                .h(px(ui.typography.row_height()))
                                                .justify_start()
                                                .child(div().flex_1())
                                                .label(group.name)
                                                .tooltip(group.path)
                                                .selected(group.active)
                                                .toggled(group.active)
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
                                                        .text_size(px(pero_theme::TextRole::Caption.pixels(ui.typography.ui)))
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
                                    .text_size(px(pero_theme::TextRole::Caption.pixels(ui.typography.ui)))
                                    .text_color(p.text_muted)
                                    .child(ui.t("project.unassigned")),
                            )
                            .children(
                                props
                                    .ungrouped
                                    .into_iter()
                                    .enumerate()
                                    .map(|(i, row)| recent_row(ui, row, 100000 + i, &on_action)),
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
                .child(
                    Button::new("sidebar-insights")
                        .ghost()
                        .small()
                        .w_full()
                        .h(px(ui.typography.row_height()))
                        .justify_start()
                        .child(div().flex_1())
                        .icon(Icon::default().path("icons/layout-list.svg"))
                        .label(ui.t("nav.insights"))
                        .selected(props.navigation == WorkbenchPage::Insights)
                        .toggled(props.navigation == WorkbenchPage::Insights)
                        .on_click(click(
                            &on_action,
                            SidebarAction::Navigate(WorkbenchPage::Insights),
                        )),
                )
                .child(
                    Button::new("sidebar-apps")
                        .ghost()
                        .small()
                        .w_full()
                        .h(px(ui.typography.row_height()))
                        .justify_start()
                        .child(div().flex_1())
                        .icon(Icon::default().path("icons/file-code.svg"))
                        .label(ui.t("nav.apps"))
                        .selected(props.navigation == WorkbenchPage::Apps)
                        .toggled(props.navigation == WorkbenchPage::Apps)
                        .on_click(click(
                            &on_action,
                            SidebarAction::Navigate(WorkbenchPage::Apps),
                        )),
                ),
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
