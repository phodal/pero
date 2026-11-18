//! Palette format shared by the Desktop themes and the headless contract test.
use serde::{Deserialize, Serialize};

#[cfg(any(target_family = "wasm", feature = "native"))]
use gpui_kit::Hsla as PaletteColor;
#[cfg(not(any(target_family = "wasm", feature = "native")))]
type PaletteColor = u32;

#[derive(Clone, Deserialize)]
pub struct Palettes {
    pub light: Palette,
    pub dark: Palette,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case", deny_unknown_fields)]
pub struct Palette {
    #[serde(deserialize_with = "color", serialize_with = "serialize_color")]
    pub bg: PaletteColor,
    #[serde(deserialize_with = "color", serialize_with = "serialize_color")]
    pub surface: PaletteColor,
    #[serde(deserialize_with = "color", serialize_with = "serialize_color")]
    pub surface_muted: PaletteColor,
    #[serde(deserialize_with = "color", serialize_with = "serialize_color")]
    pub text: PaletteColor,
    #[serde(deserialize_with = "color", serialize_with = "serialize_color")]
    pub text_muted: PaletteColor,
    #[serde(deserialize_with = "color", serialize_with = "serialize_color")]
    pub border: PaletteColor,
    #[serde(deserialize_with = "color", serialize_with = "serialize_color")]
    pub input_border: PaletteColor,
    #[serde(deserialize_with = "color", serialize_with = "serialize_color")]
    pub action: PaletteColor,
    #[serde(deserialize_with = "color", serialize_with = "serialize_color")]
    pub action_hover: PaletteColor,
    #[serde(deserialize_with = "color", serialize_with = "serialize_color")]
    pub on_action: PaletteColor,
    #[serde(deserialize_with = "color", serialize_with = "serialize_color")]
    pub accent: PaletteColor,
    #[serde(deserialize_with = "color", serialize_with = "serialize_color")]
    pub on_accent: PaletteColor,
    #[serde(deserialize_with = "color", serialize_with = "serialize_color")]
    pub accent_soft: PaletteColor,
    #[serde(deserialize_with = "color", serialize_with = "serialize_color")]
    pub accent_text: PaletteColor,
    #[serde(deserialize_with = "color", serialize_with = "serialize_color")]
    pub link: PaletteColor,
    #[serde(deserialize_with = "color", serialize_with = "serialize_color")]
    pub focus: PaletteColor,
    #[serde(deserialize_with = "color", serialize_with = "serialize_color")]
    pub success: PaletteColor,
    #[serde(deserialize_with = "color", serialize_with = "serialize_color")]
    pub on_success: PaletteColor,
    #[serde(deserialize_with = "color", serialize_with = "serialize_color")]
    pub success_bg: PaletteColor,
    #[serde(deserialize_with = "color", serialize_with = "serialize_color")]
    pub warning: PaletteColor,
    #[serde(deserialize_with = "color", serialize_with = "serialize_color")]
    pub on_warning: PaletteColor,
    #[serde(deserialize_with = "color", serialize_with = "serialize_color")]
    pub warning_bg: PaletteColor,
    #[serde(deserialize_with = "color", serialize_with = "serialize_color")]
    pub error: PaletteColor,
    #[serde(deserialize_with = "color", serialize_with = "serialize_color")]
    pub on_error: PaletteColor,
    #[serde(deserialize_with = "color", serialize_with = "serialize_color")]
    pub error_bg: PaletteColor,
    #[serde(deserialize_with = "color", serialize_with = "serialize_color")]
    pub info: PaletteColor,
    #[serde(deserialize_with = "color", serialize_with = "serialize_color")]
    pub on_info: PaletteColor,
    #[serde(deserialize_with = "color", serialize_with = "serialize_color")]
    pub info_bg: PaletteColor,
    #[serde(deserialize_with = "color", serialize_with = "serialize_color")]
    pub surface_hover: PaletteColor,
    #[serde(deserialize_with = "color", serialize_with = "serialize_color")]
    pub surface_pressed: PaletteColor,
    #[serde(deserialize_with = "color", serialize_with = "serialize_color")]
    pub action_pressed: PaletteColor,
    #[serde(deserialize_with = "color", serialize_with = "serialize_color")]
    pub tint_blue_surface: PaletteColor,
    #[serde(deserialize_with = "color", serialize_with = "serialize_color")]
    pub tint_blue_soft: PaletteColor,
    #[serde(deserialize_with = "color", serialize_with = "serialize_color")]
    pub tint_blue_strong: PaletteColor,
    #[serde(deserialize_with = "color", serialize_with = "serialize_color")]
    pub tint_blue_text: PaletteColor,
    #[serde(deserialize_with = "color", serialize_with = "serialize_color")]
    pub tint_apricot_surface: PaletteColor,
    #[serde(deserialize_with = "color", serialize_with = "serialize_color")]
    pub tint_apricot_soft: PaletteColor,
    #[serde(deserialize_with = "color", serialize_with = "serialize_color")]
    pub tint_apricot_strong: PaletteColor,
    #[serde(deserialize_with = "color", serialize_with = "serialize_color")]
    pub tint_apricot_text: PaletteColor,
    #[serde(deserialize_with = "color", serialize_with = "serialize_color")]
    pub disabled: PaletteColor,
    #[serde(deserialize_with = "color", serialize_with = "serialize_color")]
    pub disabled_text: PaletteColor,
    #[serde(deserialize_with = "color", serialize_with = "serialize_color")]
    pub chart_1: PaletteColor,
    #[serde(deserialize_with = "color", serialize_with = "serialize_color")]
    pub chart_2: PaletteColor,
    #[serde(deserialize_with = "color", serialize_with = "serialize_color")]
    pub chart_3: PaletteColor,
    #[serde(deserialize_with = "color", serialize_with = "serialize_color")]
    pub chart_4: PaletteColor,
    #[serde(deserialize_with = "color", serialize_with = "serialize_color")]
    pub chart_5: PaletteColor,
    #[serde(deserialize_with = "color", serialize_with = "serialize_color")]
    pub chart_6: PaletteColor,
}

fn color<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<PaletteColor, D::Error> {
    let value = String::deserialize(deserializer)?;
    let hex = value
        .strip_prefix('#')
        .filter(|hex| hex.len() == 6)
        .ok_or_else(|| serde::de::Error::custom("Expected a six-digit palette color"))?;
    let value = u32::from_str_radix(hex, 16).map_err(serde::de::Error::custom)?;
    #[cfg(any(target_family = "wasm", feature = "native"))]
    let value = gpui_kit::rgb(value).into();
    Ok(value)
}

// Compatibility for existing status presenters that select a semantic token by name.
#[cfg(any(target_family = "wasm", feature = "native"))]
impl Palette {
    pub fn color(&self, token: &str) -> PaletteColor {
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
            "surface-hover" => self.surface_hover,
            "surface-pressed" => self.surface_pressed,
            "action-pressed" => self.action_pressed,
            "tint-blue-surface" => self.tint_blue_surface,
            "tint-blue-soft" => self.tint_blue_soft,
            "tint-blue-strong" => self.tint_blue_strong,
            "tint-blue-text" => self.tint_blue_text,
            "tint-apricot-surface" => self.tint_apricot_surface,
            "tint-apricot-soft" => self.tint_apricot_soft,
            "tint-apricot-strong" => self.tint_apricot_strong,
            "tint-apricot-text" => self.tint_apricot_text,
            "disabled" => self.disabled,
            "disabled-text" => self.disabled_text,
            _ => panic!("Unknown design token: {token}"),
        }
    }
}

fn serialize_color<S: serde::Serializer>(
    color: &PaletteColor,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    #[cfg(any(target_family = "wasm", feature = "native"))]
    let value = {
        let rgb = color.to_rgb();
        let [red, green, blue] =
            [rgb.r, rgb.g, rgb.b].map(|channel| (channel * 255.).round() as u8);
        u32::from_be_bytes([0, red, green, blue])
    };
    #[cfg(not(any(target_family = "wasm", feature = "native")))]
    let value = *color;
    serializer.serialize_str(&format!("#{value:06X}"))
}

impl Palettes {
    pub fn get(&self, dark: bool) -> &Palette {
        if dark { &self.dark } else { &self.light }
    }
}

#[cfg(test)]
mod tests {
    use super::Palettes;
    use serde_json::{Value, json};

    #[test]
    fn generated_palettes_preserve_chart_colors_and_reject_unknown_tokens() {
        let source = include_str!("../../../web/src/theme.generated.json");
        let palettes: Palettes = serde_json::from_str(source).unwrap();
        let mut input: Value = serde_json::from_str(source).unwrap();
        for (dark, mode) in [(false, "light"), (true, "dark")] {
            let output = serde_json::to_value(palettes.get(dark)).unwrap();
            for series in 1..=6 {
                let token = format!("chart-{series}");
                let expected = input[mode][&token].as_str().expect("generated chart color");
                assert_eq!(output[&token].as_str(), Some(expected), "{mode} {token}");
            }
        }

        input["light"]["unknown-token"] = json!("#112233");
        let error = serde_json::from_value::<Palettes>(input)
            .err()
            .expect("unknown palette token must fail");
        assert!(
            error.to_string().contains("unknown field `unknown-token`"),
            "{error}"
        );
    }
}
