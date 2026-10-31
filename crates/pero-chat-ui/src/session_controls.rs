//! Capability-driven session controls share one choice menu and one selection action.
use crate::panel::ChatPanel;
use crate::session_state::SessionState;
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

fn permission_copy(value: &str) -> Option<(&'static str, &'static str)> {
    match value {
        "read-only" => Some((
            "composer.permission.read_only",
            "composer.permission.read_only_hint",
        )),
        "workspace-write" => Some((
            "composer.permission.workspace_write",
            "composer.permission.workspace_write_hint",
        )),
        "full-access" => Some((
            "composer.permission.full_access",
            "composer.permission.full_access_hint",
        )),
        "auto-review" => Some((
            "composer.permission.auto_review",
            "composer.permission.auto_review_hint",
        )),
        _ => None,
    }
}

fn localize_permission(locale: &str, setting: &SessionSetting) -> SessionSetting {
    if setting.id != "permission" {
        return setting.clone();
    }
    let mut setting = setting.clone();
    setting.name = pero_contracts::i18n::text(locale, "composer.permission").to_string();
    for choice in &mut setting.choices {
        if let Some((label, hint)) = permission_copy(&choice.value) {
            choice.label = pero_contracts::i18n::text(locale, label).to_string();
            choice.description = pero_contracts::i18n::text(locale, hint).to_string();
        }
    }
    setting
}

fn setting_menu(
    mut menu: PopupMenu,
    setting: &SessionSetting,
    thread: &str,
    workbench: &WeakEntity<ChatPanel>,
    heading: bool,
) -> PopupMenu {
    menu = menu
        .min_w(px(W::MENU_WIDTH))
        .max_w(px(420.))
        .max_h(px(320.))
        .scrollable(true)
        .check_side(Side::Right);
    if heading {
        menu = menu.item(PopupMenuItem::label(setting.name.clone()));
    }
    for choice in &setting.choices {
        let thread = thread.to_string();
        let id = setting.id.clone();
        let value = choice.value.clone();
        let workbench = workbench.clone();
        let mut item =
            PopupMenuItem::new(choice.label.clone()).checked(choice.value == setting.current);
        if setting.id == "permission" {
            let icon = match choice.value.as_str() {
                "workspace-write" => "icons/file-code.svg",
                "full-access" => "icons/alert-circle.svg",
                _ => "icons/shield.svg",
            };
            item = item.icon(Icon::default().path(icon));
        }
        menu = menu.item(item.on_click(move |_, _, cx| {
            let _ = workbench.update(cx, |this, cx| {
                this.select_session_setting(&thread, &id, &value, cx)
            });
        }));
        if setting.id != "permission" && !choice.description.is_empty() {
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
                    .small()
                    .h(px(pero_theme::UiAppearance::global(cx)
                        .typography
                        .control_height()))
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
                        setting_menu(menu, &setting, &thread, &workbench, true)
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
            .map(|option| localize_permission(&self.locale, option))
            .collect::<Vec<_>>();
        if options.is_empty() {
            return None;
        }
        let tooltip = options
            .iter()
            .map(|option| {
                let current = option
                    .choices
                    .iter()
                    .find(|choice| choice.value == option.current);
                let value = current
                    .map(|choice| choice.label.as_str())
                    .unwrap_or(&option.current);
                let hint = current
                    .map(|choice| choice.description.as_str())
                    .unwrap_or("");
                if hint.is_empty() {
                    format!("{}: {}", option.name, value)
                } else {
                    format!("{}: {}\n{}", option.name, value, hint)
                }
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
                .small()
                .h(px(pero_theme::UiAppearance::global(cx)
                    .typography
                    .control_height()))
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
                    if options.len() == 1 {
                        return setting_menu(menu, &options[0], &thread, &workbench, false);
                    }
                    options
                        .iter()
                        .fold(menu.min_w(px(W::MENU_WIDTH)), |menu, option| {
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
                                setting_menu(menu, &setting, &thread, &workbench, true)
                            })
                        })
                })
                .into_any_element(),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pero_contracts::session_settings::SettingChoice;

    #[test]
    fn harness_permission_uses_auto_review_label() {
        let setting = SessionSetting {
            id: "permission".into(),
            name: "Permission".into(),
            category: "mode".into(),
            current: "auto-review".into(),
            choices: vec![SettingChoice {
                value: "auto-review".into(),
                label: "Auto-review".into(),
                description: String::new(),
            }],
        };
        let localized = localize_permission("zh-CN", &setting);
        assert_eq!(localized.name, "权限");
        assert_eq!(localized.choices[0].label, "自动审查");
        assert_eq!(localized.current, "auto-review");
    }
}
