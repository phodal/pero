//! Shared appearance definitions; application roots own installation.
pub use pero_contracts::appearance::{AccentColor, ResolvedTypography, TextRole};
mod design_tokens;
pub use design_tokens::*;
#[cfg(any(target_family = "wasm", feature = "native"))]
mod design;
#[cfg(any(target_family = "wasm", feature = "native"))]
pub use design::{
    action_button, badge, chat_heading, empty_state, ghost_icon_button, hairline, interaction_row,
    library_header, list_row, outline_badge, reader_frame, search_field, sidebar_menu_button,
    settings_actions, settings_check, settings_field, settings_group, settings_message,
    settings_panel, settings_row, settings_status, sidebar_row, ActionKind, Chrome, RowLevel,
    SettingMessage,
};
#[cfg(any(target_family = "wasm", feature = "native"))]
mod appearance;
#[cfg(any(target_family = "wasm", feature = "native"))]
pub use appearance::*;
#[cfg(any(target_family = "wasm", feature = "native"))]
mod scope;
#[cfg(any(target_family = "wasm", feature = "native"))]
pub use scope::TypographyScope;

#[cfg(test)]
mod contract {
    use super::{
        ACCENT_SOFT_DARK, ACCENT_SOFT_LIGHT, ACTION_DARK, ACTION_HOVER_DARK, ACTION_HOVER_LIGHT,
        ACTION_LIGHT, BORDER_DARK, BORDER_LIGHT, DANGER_DARK, DANGER_LIGHT, FOCUS_DARK, FOCUS_LIGHT,
        ON_ACTION_DARK, ON_ACTION_LIGHT, PAGE_DARK, PAGE_LIGHT, READING_DARK, READING_LIGHT,
        SIDEBAR_DARK, SIDEBAR_LIGHT, TEXT_DARK, TEXT_LIGHT, TEXT_MUTED_DARK, TEXT_MUTED_LIGHT,
    };

    #[test]
    fn roles_match_design_md_theme() {
        let theme: serde_json::Value =
            serde_json::from_str(include_str!("../../../web/src/theme.generated.json")).unwrap();
        for (key, light, dark) in [
            ("bg", PAGE_LIGHT, PAGE_DARK),
            ("surface-muted", SIDEBAR_LIGHT, SIDEBAR_DARK),
            ("surface", READING_LIGHT, READING_DARK),
            ("text", TEXT_LIGHT, TEXT_DARK),
            ("text-muted", TEXT_MUTED_LIGHT, TEXT_MUTED_DARK),
            ("action", ACTION_LIGHT, ACTION_DARK),
            ("action-hover", ACTION_HOVER_LIGHT, ACTION_HOVER_DARK),
            ("on-action", ON_ACTION_LIGHT, ON_ACTION_DARK),
            ("accent-soft", ACCENT_SOFT_LIGHT, ACCENT_SOFT_DARK),
            ("border", BORDER_LIGHT, BORDER_DARK),
            ("error", DANGER_LIGHT, DANGER_DARK),
            ("focus", FOCUS_LIGHT, FOCUS_DARK),
        ] {
            assert_eq!(theme["light"][key].as_str().unwrap(), light, "{key}");
            assert_eq!(theme["dark"][key].as_str().unwrap(), dark, "{key}");
        }
    }
}
