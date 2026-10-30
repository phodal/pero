//! Capability-driven session controls share one choice menu and one selection action.
use crate::session_state::SessionState;
use crate::panel::ChatPanel;
use crate::theme::WorkbenchStyle as W;
use gpui_kit::{
    component::{
        button::*,
        menu::{DropdownMenu, PopupMenu, PopupMenuItem},
        *,
    },
    prelude::*,
    *,
};
use pero_contracts::session_settings::SessionSetting;

fn setting_menu(
    mut menu: PopupMenu,
    setting: &SessionSetting,
    thread: &str,
    workbench: &WeakEntity<ChatPanel>,
) -> PopupMenu {
    menu = menu
        .min_w(px(W::MENU_WIDTH))
        .max_w(px(420.))
        .max_h(px(320.))
        .scrollable(true)
        .check_side(Side::Right)
        .item(PopupMenuItem::label(setting.name.clone()));
    for choice in &setting.choices {
        let thread = thread.to_string();
        let id = setting.id.clone();
        let value = choice.value.clone();
        let workbench = workbench.clone();
        menu = menu.item(
            PopupMenuItem::new(choice.label.clone())
                .checked(choice.value == setting.current)
                .on_click(move |_, _, cx| {
                    let _ = workbench.update(cx, |this, cx| {
                        this.select_session_setting(&thread, &id, &value, cx)
                    });
                }),
        );
        if !choice.description.is_empty() {
            menu = menu.item(PopupMenuItem::label(choice.description.clone()));
        }
    }
    menu
}

impl ChatPanel {
    pub(crate) fn session_setting_controls(
        &self,
        category: &str,
        cx: &mut Context<Self>,
    ) -> Vec<AnyElement> {
        let Some(chat) = self.active_chat.and_then(|index| self.chats.get(index)) else {
            return vec![];
        };
        let pending = chat.pending_setting.is_some() || chat.pending_model.is_some();
        chat.settings
            .options
            .iter()
            .enumerate()
            .filter(|(_, option)| option.category == category)
            .map(|(index, option)| {
                let label = option
                    .choices
                    .iter()
                    .find(|choice| choice.value == option.current)
                    .map(|choice| choice.label.clone())
                    .unwrap_or_else(|| option.name.clone());
                let thread = chat.id.clone();
                let setting = option.clone();
                let workbench = cx.entity().downgrade();
                Button::new(("session-setting", index))
                    .ghost()
                    .small().h(px(pero_theme::UiAppearance::global(cx).typography.control_height()))
                    .label(label)
                    .when(category == "thought_level", |button| {
                        button.icon(Icon::default().path("icons/lightbulb.svg"))
                    })
                    .tooltip(option.name.clone())
                    .dropdown_caret(false)
                    .max_w(px(160.))
                    .loading(
                        chat.pending_setting
                            .as_ref()
                            .is_some_and(|selection| selection.id == option.id),
                    )
                    .disabled(chat.busy() || pending || chat.state != SessionState::Idle)
                    .dropdown_menu_with_anchor(Anchor::BottomLeft, move |menu, _, _| {
                        setting_menu(menu, &setting, &thread, &workbench)
                    })
                    .into_any_element()
            })
            .collect()
    }

    pub(crate) fn session_extra_controls(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
        let chat = self.active_chat.and_then(|index| self.chats.get(index))?;
        let options = chat
            .settings
            .options
            .iter()
            .filter(|option| option.category != "thought_level")
            .cloned()
            .collect::<Vec<_>>();
        if options.is_empty() {
            return None;
        }
        let tooltip = options
            .iter()
            .map(|option| {
                let value = option
                    .choices
                    .iter()
                    .find(|choice| choice.value == option.current)
                    .map(|choice| choice.label.as_str())
                    .unwrap_or(&option.current);
                format!("{}: {}", option.name, value)
            })
            .collect::<Vec<_>>()
            .join("\n");
        let mode_label = options
            .iter()
            .find(|option| option.category == "mode")
            .and_then(|option| {
                option
                    .choices
                    .iter()
                    .find(|choice| choice.value == option.current)
            })
            .map(|choice| choice.label.clone());
        let thread = chat.id.clone();
        let workbench = cx.entity().downgrade();
        Some(
            Button::new("session-permissions")
                .ghost()
                .small().h(px(pero_theme::UiAppearance::global(cx).typography.control_height()))
                .icon(Icon::default().path("icons/shield.svg"))
                .when_some(mode_label, |button, label| button.label(label))
                .accessibility_label(tooltip.clone())
                .tooltip(tooltip)
                .loading(chat.pending_setting.as_ref().is_some_and(|selection| {
                    options.iter().any(|option| option.id == selection.id)
                }))
                .disabled(
                    chat.busy()
                        || chat.pending_setting.is_some()
                        || chat.pending_model.is_some()
                        || chat.state != SessionState::Idle,
                )
                .dropdown_menu_with_anchor(Anchor::BottomLeft, move |menu, window, cx| {
                    options.iter().fold(menu.min_w(px(W::MENU_WIDTH)), |menu, option| {
                        let label = option
                            .choices
                            .iter()
                            .find(|choice| choice.value == option.current)
                            .map(|choice| choice.label.as_str())
                            .unwrap_or(&option.current);
                        let title = format!("{}: {}", option.name, label);
                        let setting = option.clone();
                        let thread = thread.clone();
                        let workbench = workbench.clone();
                        menu.submenu(title, window, cx, move |menu, _, _| {
                            setting_menu(menu, &setting, &thread, &workbench)
                        })
                    })
                })
                .into_any_element(),
        )
    }
}
