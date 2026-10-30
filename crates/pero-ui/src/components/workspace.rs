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
    let chrome = ui.chrome();
    div()
        .flex_1()
        .bg(chrome.list())
        .child(pero_theme::library_header(
            "agents-header",
            ui.t("settings.agents"),
            Some(ui.t("agents.description").into()),
            None,
            chrome,
        ))
        .child(
            div()
                .w(px(pero_theme::LIST_COLUMN))
                .max_w_full()
                .px(px(pero_theme::SPACE_8))
                .flex()
                .flex_col()
                .children(agents.iter().enumerate().map(|(i, a)| {
                    pero_theme::list_row(
                        ("agent", i),
                        a.name.clone(),
                        None,
                        None,
                        false,
                        Some(
                            div()
                                .flex()
                                .items_center()
                                .gap(px(pero_theme::SPACE_8))
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
                                        .h(px(pero_theme::ACTION_BUTTON_HEIGHT))
                                        .label(ui.t("chat.new"))
                                        .disabled(!a.available)
                                        .on_click(click(&on_action, WorkspaceAction::NewSession(i))),
                                )
                                .into_any_element(),
                        ),
                        chrome,
                    )
                })),
        )
}
