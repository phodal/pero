use super::{ActionHandler, Ui, click};
use gpui_kit::{
    component::{button::*, *},
    prelude::*,
    *,
};

pub(crate) struct SessionHeader {
    pub title: String,
    pub agent: String,
    pub closed: bool,
}
pub(crate) struct TaskDetailProps {
    pub session: Option<SessionHeader>,
    pub tab: usize,
}
pub(crate) enum TaskDetailAction {
    NewSession,
    CloseSession,
    SelectTab(usize),
}
pub(crate) fn task_detail(
    ui: Ui<'_>,
    props: TaskDetailProps,
    content: AnyElement,
    on_action: ActionHandler<TaskDetailAction>,
) -> Div {
    let p = ui.palette;
    let chat = props.session.as_ref();
    div()
        .flex_1()
        .min_w_0()
        .h_full()
        .flex()
        .flex_col()
        .when(chat.is_some(), |el| {
            el.child(
                div()
                    .h(px(44.))
                    .px(px(16.))
                    .flex_shrink_0()
                    .flex()
                    .items_center()
                    .gap(px(10.))
                    .border_b_1()
                    .border_color(p.color("border"))
                    .child(ui.icon("terminal"))
                    .child(
                        div()
                            .flex_1()
                            .truncate()
                            .font_weight(FontWeight::BOLD)
                            .child(chat.map(|c| c.title.clone()).unwrap_or_default()),
                    )
                    .child(ui.badge(chat.map(|c| c.agent.clone()).unwrap_or_default(), "muted"))
                    .child(
                        Button::new("close-chat")
                            .ghost()
                            .small()
                            .label(ui.t("chat.close"))
                            .disabled(chat.is_none_or(|c| c.closed))
                            .on_click(click(&on_action, TaskDetailAction::CloseSession)),
                    )
                    .child(
                        Button::new("new-task")
                            .ghost()
                            .small()
                            .icon(IconName::Plus)
                            .label(ui.t("chat.new"))
                            .on_click(click(&on_action, TaskDetailAction::NewSession)),
                    ),
            )
        })
        .when(chat.is_none(), |el| {
            el.child(
                div()
                    .h(px(54.))
                    .flex_shrink_0()
                    .px(px(20.))
                    .pt(px(14.))
                    .flex()
                    .justify_end()
                    .child(
                        Button::new("new-task")
                            .primary()
                            .small()
                            .icon(IconName::Plus)
                            .label(ui.t("chat.new"))
                            .on_click(click(&on_action, TaskDetailAction::NewSession)),
                    ),
            )
        })
        .child(
            div()
                .mx(px(16.))
                .flex()
                .gap(px(14.))
                .border_b_1()
                .border_color(p.color("border"))
                .children(
                    [
                        "tab.overview",
                        "tab.changes",
                        "tab.verification",
                        "tab.logs",
                        "chat.session",
                    ]
                    .into_iter()
                    .enumerate()
                    .map(|(i, key)| {
                        div()
                            .id(("detail-tab", i))
                            .h(px(34.))
                            .flex()
                            .items_center()
                            .px(px(6.))
                            .cursor_pointer()
                            .border_b_2()
                            .border_color(p.color(if props.tab == i {
                                "action"
                            } else {
                                "surface"
                            }))
                            .text_color(p.color(if props.tab == i {
                                "accent-text"
                            } else {
                                "text-muted"
                            }))
                            .child(ui.t(key))
                            .on_click(click(&on_action, TaskDetailAction::SelectTab(i)))
                    }),
                ),
        )
        .child(content)
}
