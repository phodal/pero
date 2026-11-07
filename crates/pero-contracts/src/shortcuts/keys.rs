//! Canonical key sequences at the settings boundary. Modifier order is not identity.
use serde::{Deserialize, Serialize};
use std::{fmt, str::FromStr};

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ShortcutPlatform {
    Macos,
    Other,
}
impl ShortcutPlatform {
    pub fn primary(self) -> &'static str {
        if self == Self::Macos { "cmd" } else { "ctrl" }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct KeyStroke {
    pub command: bool,
    pub control: bool,
    pub alt: bool,
    pub shift: bool,
    key: String,
}
impl KeyStroke {
    pub fn key(&self) -> &str {
        &self.key
    }
    fn parse(source: &str) -> Result<Self, String> {
        let mut stroke = Self {
            command: false,
            control: false,
            alt: false,
            shift: false,
            key: String::new(),
        };
        let mut rest = source;
        while let Some((modifier, tail)) = rest.split_once('-') {
            let flag = match modifier {
                "cmd" => &mut stroke.command,
                "ctrl" => &mut stroke.control,
                "alt" => &mut stroke.alt,
                "shift" => &mut stroke.shift,
                _ => break,
            };
            if *flag {
                return Err("Duplicate modifier".into());
            }
            *flag = true;
            rest = tail;
        }
        let named = matches!(
            rest,
            "enter"
                | "escape"
                | "tab"
                | "space"
                | "backspace"
                | "delete"
                | "left"
                | "right"
                | "up"
                | "down"
                | "home"
                | "end"
                | "pageup"
                | "pagedown"
        );
        let function = rest
            .strip_prefix('f')
            .and_then(|n| n.parse::<u8>().ok())
            .is_some_and(|n| (1..=24).contains(&n));
        let character = rest.len() == 1
            && rest.as_bytes()[0].is_ascii_graphic()
            && !rest.as_bytes()[0].is_ascii_uppercase();
        if !(named || function || character) {
            return Err("Use a letter, digit, punctuation, navigation key or F1–F24".into());
        }
        stroke.key = rest.into();
        Ok(stroke)
    }
}
impl fmt::Display for KeyStroke {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        for (enabled, name) in [
            (self.control, "ctrl"),
            (self.alt, "alt"),
            (self.shift, "shift"),
            (self.command, "cmd"),
        ] {
            if enabled {
                write!(f, "{name}-")?;
            }
        }
        f.write_str(&self.key)
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(try_from = "String", into = "String")]
pub struct KeySequence(Vec<KeyStroke>);
impl KeySequence {
    pub fn strokes(&self) -> &[KeyStroke] {
        &self.0
    }
    pub fn overlaps(&self, other: &Self) -> bool {
        self.0.starts_with(&other.0) || other.0.starts_with(&self.0)
    }
    pub fn label(&self, platform: ShortcutPlatform) -> String {
        self.0
            .iter()
            .map(|key| {
                let mut label = String::new();
                let mac = platform == ShortcutPlatform::Macos;
                for (enabled, symbol, word) in [
                    (key.control, "Ctrl+", "Ctrl+"),
                    (key.alt, "Alt+", "Alt+"),
                    (key.shift, "Shift+", "Shift+"),
                    (key.command, "⌘", "Super+"),
                ] {
                    if enabled {
                        label.push_str(if mac { symbol } else { word });
                    }
                }
                label.push_str(match key.key() {
                    "left" => "←",
                    "right" => "→",
                    "up" => "↑",
                    "down" => "↓",
                    "escape" => "Esc",
                    "enter" => "Enter",
                    "tab" => "Tab",
                    "space" => "Space",
                    _ => "",
                });
                if !matches!(
                    key.key(),
                    "left" | "right" | "up" | "down" | "escape" | "enter" | "tab" | "space"
                ) {
                    label.push_str(&key.key.to_uppercase());
                }
                label
            })
            .collect::<Vec<_>>()
            .join("  ")
    }
    /// Single strokes can be displayed in native menus. Chords stay in the GPUI dispatcher.
    pub fn accelerator(&self) -> Option<String> {
        let [key] = self.0.as_slice() else {
            return None;
        };
        let mut parts = Vec::new();
        for (enabled, name) in [
            (key.command, "Super"),
            (key.control, "Control"),
            (key.alt, "Alt"),
            (key.shift, "Shift"),
        ] {
            if enabled {
                parts.push(name.to_string());
            }
        }
        parts.push(match key.key() {
            "space" => "Space".into(),
            "-" => "Minus".into(),
            "+" => "Plus".into(),
            s => s.into(),
        });
        Some(parts.join("+"))
    }
}
impl FromStr for KeySequence {
    type Err = String;
    fn from_str(source: &str) -> Result<Self, String> {
        let keys = source
            .to_ascii_lowercase()
            .split_whitespace()
            .map(KeyStroke::parse)
            .collect::<Result<Vec<_>, _>>()?;
        if keys.is_empty() || keys.len() > 2 {
            return Err("Use one or two keystrokes".into());
        }
        let first = &keys[0];
        if !first.command && !first.control && !first.alt {
            return Err("Start with Command, Control or Alt".into());
        }
        // Standard editing and OS/window lifecycle remain with their existing owners.
        if (first.command || first.control)
            && !first.alt
            && !first.shift
            && matches!(first.key(), "c" | "x" | "v" | "a" | "z" | "q")
            || first.alt && !first.command && !first.control && first.key() == "f4"
        {
            return Err("This shortcut is reserved for system editing or window controls".into());
        }
        Ok(Self(keys))
    }
}
impl TryFrom<String> for KeySequence {
    type Error = String;
    fn try_from(s: String) -> Result<Self, String> {
        s.parse()
    }
}
impl From<KeySequence> for String {
    fn from(value: KeySequence) -> String {
        value.to_string()
    }
}
impl fmt::Display for KeySequence {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(
            &self
                .0
                .iter()
                .map(ToString::to_string)
                .collect::<Vec<_>>()
                .join(" "),
        )
    }
}
