use crate::{AccentColor, ResolvedTypography, TextRole};
use gpui_kit::{
    component::{Sizable, Theme, ThemeMode, input::Input},
    *,
};
use pero_contracts::workbench::WorkbenchPreferences;
use serde::{Deserialize, Serialize};

/// Shared geometry for the compact workbench and standalone App chat.
/// Component behavior and focus treatment remain owned by GPUI Kit.
pub struct WorkbenchStyle;

impl WorkbenchStyle {
    pub const ICON: f32 = 16.;
    pub const TAB: f32 = 30.;
    pub const RADIUS: f32 = 4.;
    pub const GAP: f32 = 4.;
    pub const INSET: f32 = 6.;
    pub const PAGE: f32 = 12.;
    pub const SECTION: f32 = 12.;
    pub const MENU_WIDTH: f32 = 240.;

    /// Input's inherent `h` only sizes multiline editors; style the frame too.
    pub fn input(input: Input, cx: &App) -> Input {
        let typography = UiAppearance::global(cx).typography;
        Styled::h(input.small(), px(typography.control_height()))
            .text_size(px(typography.ui))
            .line_height(relative(1.3))
    }
}

#[derive(Clone, Deserialize)]
pub struct Palettes {
    pub light: Palette,
    pub dark: Palette,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case", deny_unknown_fields)]
pub struct Palette {
    #[serde(deserialize_with = "color", serialize_with = "serialize_color")]
    pub bg: Hsla,
    #[serde(deserialize_with = "color", serialize_with = "serialize_color")]
    pub surface: Hsla,
    #[serde(deserialize_with = "color", serialize_with = "serialize_color")]
    pub surface_muted: Hsla,
    #[serde(deserialize_with = "color", serialize_with = "serialize_color")]
    pub text: Hsla,
    #[serde(deserialize_with = "color", serialize_with = "serialize_color")]
    pub text_muted: Hsla,
    #[serde(deserialize_with = "color", serialize_with = "serialize_color")]
    pub border: Hsla,
    #[serde(deserialize_with = "color", serialize_with = "serialize_color")]
    pub input_border: Hsla,
    #[serde(deserialize_with = "color", serialize_with = "serialize_color")]
    pub action: Hsla,
    #[serde(deserialize_with = "color", serialize_with = "serialize_color")]
    pub action_hover: Hsla,
    #[serde(deserialize_with = "color", serialize_with = "serialize_color")]
    pub on_action: Hsla,
    #[serde(deserialize_with = "color", serialize_with = "serialize_color")]
    pub accent: Hsla,
    #[serde(deserialize_with = "color", serialize_with = "serialize_color")]
    pub on_accent: Hsla,
    #[serde(deserialize_with = "color", serialize_with = "serialize_color")]
    pub accent_soft: Hsla,
    #[serde(deserialize_with = "color", serialize_with = "serialize_color")]
    pub accent_text: Hsla,
    #[serde(deserialize_with = "color", serialize_with = "serialize_color")]
    pub link: Hsla,
    #[serde(deserialize_with = "color", serialize_with = "serialize_color")]
    pub focus: Hsla,
    #[serde(deserialize_with = "color", serialize_with = "serialize_color")]
    pub success: Hsla,
    #[serde(deserialize_with = "color", serialize_with = "serialize_color")]
    pub on_success: Hsla,
    #[serde(deserialize_with = "color", serialize_with = "serialize_color")]
    pub success_bg: Hsla,
    #[serde(deserialize_with = "color", serialize_with = "serialize_color")]
    pub warning: Hsla,
    #[serde(deserialize_with = "color", serialize_with = "serialize_color")]
    pub on_warning: Hsla,
    #[serde(deserialize_with = "color", serialize_with = "serialize_color")]
    pub warning_bg: Hsla,
    #[serde(deserialize_with = "color", serialize_with = "serialize_color")]
    pub error: Hsla,
    #[serde(deserialize_with = "color", serialize_with = "serialize_color")]
    pub on_error: Hsla,
    #[serde(deserialize_with = "color", serialize_with = "serialize_color")]
    pub error_bg: Hsla,
    #[serde(deserialize_with = "color", serialize_with = "serialize_color")]
    pub info: Hsla,
    #[serde(deserialize_with = "color", serialize_with = "serialize_color")]
    pub on_info: Hsla,
    #[serde(deserialize_with = "color", serialize_with = "serialize_color")]
    pub info_bg: Hsla,
    #[serde(deserialize_with = "color", serialize_with = "serialize_color")]
    pub disabled: Hsla,
    #[serde(deserialize_with = "color", serialize_with = "serialize_color")]
    pub disabled_text: Hsla,
}

fn color<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<Hsla, D::Error> {
    let value = String::deserialize(deserializer)?;
    let hex = value
        .strip_prefix('#')
        .filter(|hex| hex.len() == 6)
        .ok_or_else(|| serde::de::Error::custom("Expected a six-digit palette color"))?;
    u32::from_str_radix(hex, 16)
        .map(|value| rgb(value).into())
        .map_err(serde::de::Error::custom)
}

// Compatibility for existing status presenters that select a semantic token by name.
impl Palette {
    pub fn color(&self, token: &str) -> Hsla {
        match token {
            "bg" => self.bg,
            "surface" => self.surface,
            "surface-muted" => self.surface_muted,
            "text" => self.text,
            "text-muted" => self.text_muted,
            "border" => self.border,
            "input-border" => self.input_border,
            "action" => self.action,
            "action-hover" => self.action_hover,
            "on-action" => self.on_action,
            "accent" => self.accent,
            "on-accent" => self.on_accent,
            "accent-soft" => self.accent_soft,
            "accent-text" => self.accent_text,
            "link" => self.link,
            "focus" => self.focus,
            "success" => self.success,
            "on-success" => self.on_success,
            "success-bg" => self.success_bg,
            "warning" => self.warning,
            "on-warning" => self.on_warning,
            "warning-bg" => self.warning_bg,
            "error" => self.error,
            "on-error" => self.on_error,
            "error-bg" => self.error_bg,
            "info" => self.info,
            "on-info" => self.on_info,
            "info-bg" => self.info_bg,
            "disabled" => self.disabled,
            "disabled-text" => self.disabled_text,
            _ => panic!("Unknown design token: {token}"),
        }
    }
}

fn serialize_color<S: serde::Serializer>(color: &Hsla, serializer: S) -> Result<S::Ok, S::Error> {
    let rgb = color.to_rgb();
    serializer.serialize_str(&format!(
        "#{:02X}{:02X}{:02X}",
        (rgb.r * 255.).round() as u8,
        (rgb.g * 255.).round() as u8,
        (rgb.b * 255.).round() as u8
    ))
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ResolvedAppearance {
    pub dark: bool,
    pub accent: AccentColor,
    pub palette: Palette,
    pub typography: ResolvedTypography,
}
/// The resolved appearance is the application-global value, with no second copy.
pub type UiAppearance = ResolvedAppearance;
impl Global for ResolvedAppearance {}

impl ResolvedAppearance {
    pub fn resolve(
        preferences: &WorkbenchPreferences,
        system_dark: bool,
        palettes: &Palettes,
    ) -> Self {
        let dark = preferences.appearance.dark(system_dark);
        let mut palette = palettes.get(dark).clone();
        match preferences.accent {
            AccentColor::Teal => {}
            AccentColor::Blue => {
                palette.action = palette.info;
                palette.on_action = palette.on_info;
                palette.action_hover = palette.info;
                palette.action_hover.l =
                    (palette.action_hover.l + if dark { 0.06 } else { -0.06 }).clamp(0., 1.);
                palette.accent = palette.info;
                palette.on_accent = palette.on_info;
                palette.accent_soft = palette.info_bg;
                palette.accent_text = palette.info;
                palette.link = palette.info;
                palette.focus = palette.info;
            }
            AccentColor::Neutral => {
                palette.action = palette.text;
                palette.on_action = palette.surface;
                palette.action_hover = palette.text_muted;
                palette.accent = palette.text;
                palette.on_accent = palette.surface;
                palette.accent_soft = palette.surface_muted;
                palette.accent_text = palette.text;
                palette.link = palette.text;
                palette.focus = palette.text;
            }
        }
        Self {
            dark,
            accent: preferences.accent,
            palette,
            typography: preferences.typography.resolve(),
        }
    }
    pub fn global(cx: &App) -> &Self {
        cx.global::<Self>()
    }
    pub fn text(&self, role: TextRole) -> Pixels {
        px(role.pixels(self.typography.ui))
    }

    /// Called only by application roots after resolving Host/platform inputs.
    pub fn install(self, cx: &mut App) {
        Theme::change(
            if self.dark {
                ThemeMode::Dark
            } else {
                ThemeMode::Light
            },
            None,
            cx,
        );
        let p = &self.palette;
        Theme::update(cx, |theme| {
            theme.font_family = ".SystemUIFont".into();
            theme.font_size = px(self.typography.ui);
            theme.mono_font_size = px(self.typography.code);
            theme.radius = px(WorkbenchStyle::RADIUS);
            theme.radius_lg = px(WorkbenchStyle::INSET);
            theme.mono_font_family = "JetBrains Mono".into();
            let c = &mut theme.colors;
            c.background = p.surface;
            c.foreground = p.text;
            c.border = p.border;
            c.input = p.input_border;
            c.popover = p.surface;
            c.popover_foreground = p.text;
            c.list_active_border = p.focus;
            c.muted = p.surface_muted;
            c.muted_foreground = p.text_muted;
            c.primary = p.action;
            c.primary_foreground = p.on_action;
            c.primary_hover = p.action_hover;
            c.primary_active = p.action_hover;
            c.button_primary = p.action;
            c.button_primary_foreground = p.on_action;
            c.button_primary_hover = p.action_hover;
            c.button_primary_active = p.action_hover;
            c.ring = p.focus;
            c.selection = p.accent_soft;
            c.list_active = p.accent_soft;
            c.list_hover = p.surface_muted;
            c.table = p.surface;
            c.table_head = p.surface_muted;
            c.table_head_foreground = p.text;
            c.table_foot = p.surface_muted;
            c.table_foot_foreground = p.text;
            c.table_even = p.surface_muted;
            c.table_hover = p.surface_muted;
            // Kit paints cell selection above its text, so this is a translucent overlay.
            c.table_active = Hsla { a:0.18, ..p.focus };
            c.table_active_border = p.focus;
            c.table_row_border = p.border;
            c.sidebar = p.bg;
            c.sidebar_foreground = p.text;
            c.sidebar_border = p.border;
            c.sidebar_accent = p.accent_soft;
            c.sidebar_accent_foreground = p.accent_text;
            c.sidebar_primary = p.action;
            c.sidebar_primary_foreground = p.on_action;
            c.secondary = p.surface_muted;
            c.secondary_foreground = p.text;
            c.secondary_hover = p.surface_muted;
            c.secondary_active = p.accent_soft;
            c.accent = p.accent_soft;
            c.accent_foreground = p.accent_text;
            (c.success, c.success_foreground) = (p.success, p.on_success);
            (c.success_hover, c.success_active) = (c.success, c.success);
            (c.warning, c.warning_foreground) = (p.warning, p.on_warning);
            (c.warning_hover, c.warning_active) = (c.warning, c.warning);
            (c.info, c.info_foreground) = (p.info, p.on_info);
            (c.info_hover, c.info_active) = (c.info, c.info);
            (c.danger, c.danger_foreground) = (p.error, p.on_error);
            (c.danger_hover, c.danger_active) = (c.danger, c.danger);
        });
        cx.set_global(self);
        cx.refresh_windows();
    }
}

impl Palettes {
    pub fn get(&self, dark: bool) -> &Palette {
        if dark { &self.dark } else { &self.light }
    }
}

#[cfg(test)]
mod tests {
    use super::{AccentColor, Palettes, ResolvedAppearance, WorkbenchPreferences};
    use pero_contracts::workbench::Appearance;

    #[test]
    fn resolved_appearance_respects_mode_and_preserves_typography_and_status_colors() {
        let palettes: Palettes =
            serde_json::from_str(include_str!("../../../web/src/theme.generated.json")).unwrap();
        for (mode, system_dark, dark) in [
            (Appearance::System, false, false),
            (Appearance::System, true, true),
            (Appearance::Light, true, false),
            (Appearance::Dark, false, true),
        ] {
            for accent in [AccentColor::Teal, AccentColor::Blue, AccentColor::Neutral] {
                let preferences = WorkbenchPreferences {
                    appearance: mode,
                    accent,
                    typography: serde_json::from_str(
                        r#"{"ui_size":18,"chat_size":20,"code_size":14}"#,
                    )
                    .unwrap(),
                    ..Default::default()
                };
                let resolved = ResolvedAppearance::resolve(&preferences, system_dark, &palettes);
                assert_eq!(resolved.dark, dark);
                assert_eq!(
                    (
                        resolved.typography.ui,
                        resolved.typography.chat,
                        resolved.typography.code
                    ),
                    (18., 20., 14.)
                );
                let base = palettes.get(dark);
                assert_eq!(
                    (
                        resolved.palette.error,
                        resolved.palette.warning,
                        resolved.palette.success
                    ),
                    (base.error, base.warning, base.success)
                );
                match accent {
                    AccentColor::Teal => assert_eq!(resolved.palette.action, base.action),
                    AccentColor::Blue => assert_eq!(resolved.palette.action, base.info),
                    AccentColor::Neutral => assert_eq!(resolved.palette.action, base.text),
                }
                let snapshot = serde_json::to_value(&resolved).unwrap();
                let restored: ResolvedAppearance =
                    serde_json::from_value(snapshot.clone()).unwrap();
                assert_eq!(serde_json::to_value(restored).unwrap(), snapshot);
            }
        }
    }
}
