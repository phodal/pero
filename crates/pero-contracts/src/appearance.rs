//! User-owned appearance values, independent of GPUI and platform observation.
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "u8", into = "u8")]
pub struct FontSize(u8);

impl TryFrom<u8> for FontSize {
    type Error = &'static str;
    fn try_from(value: u8) -> Result<Self, Self::Error> {
        if (Self::MIN..=Self::MAX).contains(&value) {
            Ok(Self(value))
        } else {
            Err("Font size must be between 12 and 24")
        }
    }
}
impl From<FontSize> for u8 {
    fn from(value: FontSize) -> Self {
        value.0
    }
}
impl Default for FontSize {
    fn default() -> Self {
        Self(14)
    }
}
impl FontSize {
    const MIN: u8 = 12;
    const MAX: u8 = 24;

    pub fn pixels(self) -> f32 {
        self.0.into()
    }

    pub fn adjusted(self, delta: i8) -> Self {
        Self((self.0 as i16 + delta as i16).clamp(Self::MIN as i16, Self::MAX as i16) as u8)
    }
}
impl std::str::FromStr for FontSize {
    type Err = &'static str;
    fn from_str(value: &str) -> Result<Self, Self::Err> {
        value
            .parse::<u8>()
            .map_err(|_| "Font size must be an integer")
            .and_then(Self::try_from)
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AccentColor {
    #[default]
    Teal,
    Blue,
    Neutral,
}
impl AccentColor {
    pub fn label_key(self) -> &'static str {
        match self {
            Self::Teal => "appearance.teal",
            Self::Blue => "appearance.blue",
            Self::Neutral => "appearance.neutral",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct TypographyPreferences {
    pub ui_size: FontSize,
    pub chat_size: Option<FontSize>,
    pub code_size: Option<FontSize>,
}
impl Default for TypographyPreferences {
    fn default() -> Self {
        Self {
            ui_size: FontSize(14),
            chat_size: Some(FontSize(16)),
            code_size: None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct ResolvedTypography {
    #[serde(deserialize_with = "font_pixels")]
    pub ui: f32,
    #[serde(deserialize_with = "font_pixels")]
    pub chat: f32,
    #[serde(deserialize_with = "font_pixels")]
    pub code: f32,
}
fn font_pixels<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<f32, D::Error> {
    let value = f32::deserialize(deserializer)?;
    if value.fract() != 0. {
        return Err(serde::de::Error::custom("Font size must be an integer"));
    }
    FontSize::try_from(value as u8)
        .map(FontSize::pixels)
        .map_err(serde::de::Error::custom)
}

impl TypographyPreferences {
    pub fn resolve(self) -> ResolvedTypography {
        let ui = self.ui_size.pixels();
        ResolvedTypography {
            ui,
            chat: self.chat_size.map(FontSize::pixels).unwrap_or(ui),
            code: self.code_size.map(FontSize::pixels).unwrap_or(ui),
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum FontScope {
    Interface,
    Chat,
    Code,
}
impl TypographyPreferences {
    pub fn selected(self, scope: FontScope) -> Option<FontSize> {
        match scope {
            FontScope::Interface => Some(self.ui_size),
            FontScope::Chat => self.chat_size,
            FontScope::Code => self.code_size,
        }
    }
    pub fn effective(self, scope: FontScope) -> FontSize {
        self.selected(scope).unwrap_or(self.ui_size)
    }
    pub fn set_size(&mut self, scope: FontScope, size: FontSize) {
        match scope {
            FontScope::Interface => self.ui_size = size,
            FontScope::Chat => self.chat_size = Some(size),
            FontScope::Code => self.code_size = Some(size),
        }
    }
    pub fn adjust(&mut self, scope: FontScope, delta: i8) {
        self.set_size(scope, self.effective(scope).adjusted(delta));
    }
    pub fn inherit(&mut self, scope: FontScope, inherit: bool) {
        let next = if inherit {
            None
        } else {
            Some(self.effective(scope))
        };
        match scope {
            FontScope::Interface => {}
            FontScope::Chat => self.chat_size = next,
            FontScope::Code => self.code_size = next,
        }
    }
}

#[derive(Clone, Copy)]
pub enum TextRole {
    Caption,
    Body,
    Heading,
    Title,
}
impl TextRole {
    pub fn pixels(self, base: f32) -> f32 {
        match self {
            Self::Caption => (base * 12. / 14.).max(12.),
            Self::Body => base,
            Self::Heading => base * 18. / 14.,
            Self::Title => base * 24. / 14.,
        }
    }
}
impl ResolvedTypography {
    pub fn row_height(self) -> f32 {
        (self.ui * 1.4).ceil().max(20.) + 4.
    }
    pub fn control_height(self) -> f32 {
        self.row_height()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn typography_bounds_and_inheritance() {
        for (input, expected) in [
            (r#"{}"#, Some((14., 16., 14.))),
            (r#"{"ui_size":18,"chat_size":null}"#, Some((18., 18., 18.))),
            (
                r#"{"ui_size":20,"chat_size":16,"code_size":14}"#,
                Some((20., 16., 14.)),
            ),
            (r#"{"ui_size":12,"chat_size":24}"#, Some((12., 24., 12.))),
            (r#"{"ui_size":11}"#, None),
            (r#"{"chat_size":25}"#, None),
            (r#"{"code_size":13.5}"#, None),
            (r#"{"ui_size":"14"}"#, None),
        ] {
            let resolved = serde_json::from_str::<TypographyPreferences>(input)
                .ok()
                .map(|p| p.resolve());
            assert_eq!(
                resolved.map(|p| (p.ui, p.chat, p.code)),
                expected,
                "{input}"
            );
        }
        for (text, expected) in [
            ("18", Some(18)),
            ("12", Some(12)),
            ("24", Some(24)),
            ("11", None),
            ("25", None),
            ("14.5", None),
            ("", None),
        ] {
            assert_eq!(
                text.parse::<FontSize>().ok().map(u8::from),
                expected,
                "{text}"
            );
        }
        for (scope, delta, expected) in [
            (FontScope::Interface, 1, (15., 16., 15.)),
            (FontScope::Chat, 1, (14., 17., 14.)),
            (FontScope::Code, 1, (14., 16., 15.)),
            (FontScope::Interface, -100, (12., 16., 12.)),
            (FontScope::Chat, 100, (14., 24., 14.)),
        ] {
            let mut preferences = TypographyPreferences::default();
            preferences.adjust(scope, delta);
            let resolved = preferences.resolve();
            assert_eq!((resolved.ui, resolved.chat, resolved.code), expected);
        }
        let mut preferences = TypographyPreferences::default();
        preferences.inherit(FontScope::Chat, true);
        preferences.adjust(FontScope::Interface, 2);
        assert_eq!(preferences.resolve().chat, 16.);
        preferences.inherit(FontScope::Chat, false);
        preferences.adjust(FontScope::Interface, 2);
        assert_eq!(
            (preferences.resolve().ui, preferences.resolve().chat),
            (18., 16.)
        );
        for base in [12., 14., 18., 24.] {
            assert!(TextRole::Caption.pixels(base) >= 12.);
            let typography = TypographyPreferences {
                ui_size: FontSize::try_from(base as u8).unwrap(),
                ..Default::default()
            }
            .resolve();
            assert!(typography.control_height() >= base + 10.);
        }
    }
}
