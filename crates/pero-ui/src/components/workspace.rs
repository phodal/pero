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
    let last = agents.len().saturating_sub(1);
    div().flex().flex_col()
        .child(div().px(chrome.geo(pero_theme::SPACE_16)).pt(chrome.geo(pero_theme::SPACE_12))
            .text_size(chrome.text(pero_theme::TYPE_CAPTION)).text_color(chrome.palette.text_muted)
            .whitespace_normal().child(ui.t("agents.description")))
        .children(agents.iter().enumerate().map(|(i, agent)| {
            setting_row(&agent.name, "", Some(ui.badge(ui.t(if agent.available { "agents.installed" } else { "agents.missing" }), if agent.available { "success" } else { "warning" }).into_any_element()),
                Button::new(("connect-agent", i)).outline().small().h(px(pero_theme::ACTION_BUTTON_HEIGHT)).label(ui.t("chat.new")).disabled(!agent.available)
                    .on_click(click(&on_action, WorkspaceAction::NewSession(i))).into_any_element(),
                i != last, cx)
        }))
}
