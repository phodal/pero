use super::{ActionHandler, Ui, click};
use gpui_kit::{
    component::{Disableable, Sizable, button::*},
    prelude::*,
    *,
};

pub(crate) struct AgentRow {
    pub name: String,
    pub available: bool,
}
pub(crate) enum WorkspaceAction {
    NewSession(usize),
}
pub(crate) fn environments(
    ui: Ui<'_>,
    agents: &[AgentRow],
    on_action: ActionHandler<WorkspaceAction>,
) -> Div {
    let p = ui.palette;
    div()
        .p(px(pero_theme::WorkbenchStyle::PAGE))
        .flex_1()
        .child(
            div()
                .text_size(px(pero_theme::TextRole::Heading.pixels(ui.typography.ui)))
                .font_weight(FontWeight::MEDIUM)
                .child(ui.t("settings.agents")),
        )
        .child(
            div()
                .mt(px(12.))
                .text_color(p.text_muted)
                .child(ui.t("agents.description")),
        )
        .children(agents.iter().enumerate().map(|(i, a)| {
            div()
                .py(px(8.))
                .border_b(px(0.5))
                .border_color(p.border)
                .flex()
                .items_center()
                .gap(px(8.))
                .child(ui.icon("terminal"))
                .child(a.name.clone())
                .child(div().flex_1())
                .child(ui.badge(
                    ui.t(if a.available {
                        "agents.installed"
                    } else {
                        "agents.missing"
                    }),
                    if a.available { "success" } else { "warning" },
                ))
                .child(
                    Button::new(("connect-agent", i))
                        .outline()
                        .small()
                        .h(px(ui.typography.control_height()))
                        .label(ui.t("chat.new"))
                        .disabled(!a.available)
                        .on_click(click(&on_action, WorkspaceAction::NewSession(i))),
                )
        }))
}
