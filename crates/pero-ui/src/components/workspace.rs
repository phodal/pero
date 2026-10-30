use super::{ActionHandler, Ui, click};
use crate::settings_controls::setting_row;
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
    cx: &App,
) -> Div {
    let chrome = ui.chrome();
    div().flex().flex_col()
        .child(pero_theme::settings_message(ui.t("agents.description"), pero_theme::SettingMessage::Help, chrome))
        .children(agents.iter().enumerate().map(|(i, agent)| {
            setting_row(&agent.name, "", Some(ui.badge(ui.t(if agent.available { "agents.installed" } else { "agents.missing" }), if agent.available { "success" } else { "warning" }).into_any_element()),
                Button::new(("connect-agent", i)).outline().small().h(px(pero_theme::ACTION_BUTTON_HEIGHT)).label(ui.t("chat.new")).disabled(!agent.available)
                    .on_click(click(&on_action, WorkspaceAction::NewSession(i))).into_any_element(),
                cx)
        }))
}
