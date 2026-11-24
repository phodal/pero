use super::{ComputerError, ComputerErrorCode, ComputerText};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ComputerSelectionType {
    #[default]
    Text,
    CursorBefore,
    CursorAfter,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ComputerTextSelection {
    pub text: ComputerText,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prefix: Option<ComputerText>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub suffix: Option<ComputerText>,
    #[serde(default)]
    pub selection_type: ComputerSelectionType,
}

/// Native text APIs address UTF-16 code units, not UTF-8 bytes.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ComputerTextRange {
    pub start: usize,
    pub length: usize,
}

impl ComputerTextSelection {
    pub fn range_in(&self, value: &str) -> Result<ComputerTextRange, ComputerError> {
        let text = self.text.as_str();
        let first_width = text.chars().next().unwrap().len_utf8();
        let mut remaining = value;
        let mut selection = None;
        while let Some(found) = remaining.find(text) {
            let start = value.len() - remaining.len() + found;
            let end = start + text.len();
            let prefix_matches = self
                .prefix
                .as_ref()
                .is_none_or(|prefix| value[..start].ends_with(prefix.as_str()));
            let suffix_matches = self
                .suffix
                .as_ref()
                .is_none_or(|suffix| value[end..].starts_with(suffix.as_str()));
            if prefix_matches && suffix_matches && selection.replace((start, end)).is_some() {
                return Err(ComputerError::new(
                    ComputerErrorCode::InvalidRequest,
                    "More than one selection matches. Specify adjacent prefix or suffix text.",
                ));
            }
            // Advance a scalar so overlapping matches are also detected.
            remaining = &value[start + first_width..];
        }
        let (start, end) = selection.ok_or_else(|| {
            ComputerError::new(
                ComputerErrorCode::StaleObservation,
                "The requested text and context are absent. Observe the editor again.",
            )
        })?;
        let start = match self.selection_type {
            ComputerSelectionType::CursorAfter => end,
            _ => start,
        };
        Ok(ComputerTextRange {
            start: value[..start].encode_utf16().count(),
            length: if self.selection_type == ComputerSelectionType::Text {
                text.encode_utf16().count()
            } else {
                0
            },
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn resolves_exact_unique_context_and_selection_in_utf16() {
        use ComputerErrorCode::*;
        for (contents, spec, expected) in [
            ("🌱 alpha 🌱", json!({"text":"alpha 🌱"}), Ok((3, 8))),
            (
                "🌱 alpha 🌱",
                json!({"text":"alpha 🌱","selection_type":"cursor_after"}),
                Ok((11, 0)),
            ),
            (
                "🌱 alpha 🌱",
                json!({"text":"alpha 🌱","selection_type":"cursor_before"}),
                Ok((3, 0)),
            ),
            (
                "one / one!",
                json!({"text":"one","prefix":"/ ","suffix":"!"}),
                Ok((6, 3)),
            ),
            ("one / one", json!({"text":"one"}), Err(InvalidRequest)),
            ("aaa", json!({"text":"aa"}), Err(InvalidRequest)),
            (
                "one / one",
                json!({"text":"one","prefix":"missing"}),
                Err(StaleObservation),
            ),
        ] {
            let selection: ComputerTextSelection = serde_json::from_value(spec.clone()).unwrap();
            assert_eq!(
                selection
                    .range_in(contents)
                    .map(|range| (range.start, range.length))
                    .map_err(|error| error.code),
                expected,
                "selection {spec}",
            );
        }
    }
}
