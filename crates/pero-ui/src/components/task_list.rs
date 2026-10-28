use super::{ActionHandler, Ui, click};
use gpui_kit::{prelude::*, *};

use gpui_kit::component::input::{Input, InputState};
pub(crate) struct SessionRow {
    pub title: String,
    pub agent: String,
    pub busy: bool,
}
pub(crate) struct TaskListProps<'a> {
    pub search: &'a Entity<InputState>,
    pub query: String,
    pub sessions: &'a [SessionRow],
    pub active_chat: Option<usize>,
}
pub(crate) enum TaskListAction {
    SelectSession(usize),
}
pub(crate) fn task_list(
    ui: Ui<'_>,
    width: f32,
    props: TaskListProps<'_>,
    on_action: ActionHandler<TaskListAction>,
) -> Div {
    let p = ui.palette;
    let query = &props.query;
    div()
        .w(px(width))
        .h_full()
        .flex_shrink_0()
        .flex()
        .flex_col()
        .border_r_1()
        .border_color(p.color("border"))
        .child(
            div()
                .px(px(14.))
                .pt(px(18.))
                .child(
                    div()
                        .text_size(px(22.))
                        .font_weight(FontWeight::BOLD)
                        .child(ui.t("nav.sessions")),
                )
                .child(
                    div()
                        .mt(px(16.))
                        .mb(px(12.))
                        .child(Input::new(props.search).prefix(ui.icon("search")).w_full()),
                ),
        )
        .child(
            div()
                .id("task-list")
                .flex_1()
                .min_h_0()
                .overflow_y_scroll()
                .border_t_1()
                .border_color(p.color("border"))
                .children(
                    props
                        .sessions
                        .iter()
                        .enumerate()
                        .filter(|(_, c)| {
                            query.is_empty() || c.title.to_lowercase().contains(query.as_str())
                        })
                        .map(|(i, chat)| {
                            div()
                                .id(("chat-row", i))
                                .px(px(14.))
                                .py(px(10.))
                                .border_b_1()
                                .border_color(p.color("border"))
                                .cursor_pointer()
                                .bg(p.color(if props.active_chat == Some(i) {
                                    "accent-soft"
                                } else {
                                    "surface"
                                }))
                                .child(
                                    div()
                                        .font_weight(FontWeight::BOLD)
                                        .child(chat.title.clone()),
                                )
                                .child(
                                    div()
                                        .mt(px(6.))
                                        .flex()
                                        .items_center()
                                        .gap(px(10.))
                                        .text_size(px(12.))
                                        .text_color(p.color("text-muted"))
                                        .child(ui.icon("terminal"))
                                        .child(chat.agent.clone())
                                        .child(ui.badge(
                                            ui.t(if chat.busy {
                                                "filter.running"
                                            } else {
                                                "chat.session"
                                            }),
                                            "info",
                                        )),
                                )
                                .on_click(click(&on_action, TaskListAction::SelectSession(i)))
                        }),
                )
                .when(props.sessions.is_empty(), |el| {
                    el.child(
                        div()
                            .p(px(14.))
                            .text_color(p.color("text-muted"))
                            .child(ui.t("sessions.empty")),
                    )
                }),
        )
}
