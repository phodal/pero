//! A selected context is a frozen value, independent of the picker that found it.
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ContextKind {
    File,
    Directory,
    Symbol,
    Thread,
    Skill,
    Image,
    Selection,
    BranchDiff,
    Fetch,
    AppObject,
}

impl ContextKind {
    pub fn keyword(self) -> &'static str {
        match self {
            Self::File => "file",
            Self::Directory => "directory",
            Self::Symbol => "symbol",
            Self::Thread => "thread",
            Self::Skill => "skill",
            Self::Image => "image",
            Self::Selection => "selection",
            Self::BranchDiff => "diff",
            Self::Fetch => "fetch",
            Self::AppObject => "app",
        }
    }
    pub fn from_keyword(keyword: &str) -> Option<Self> {
        [
            Self::File,
            Self::Directory,
            Self::Symbol,
            Self::Thread,
            Self::Skill,
            Self::Image,
            Self::Selection,
            Self::BranchDiff,
            Self::Fetch,
            Self::AppObject,
        ]
        .into_iter()
        .find(|kind| kind.keyword() == keyword)
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ContextCandidate {
    pub kind: ContextKind,
    pub label: String,
    pub source: String,
    pub detail: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum ContextContent {
    Text { text: String },
    Image { data: String, mime_type: String },
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ContextReference {
    pub id: String,
    pub kind: ContextKind,
    pub label: String,
    pub source: String,
    pub content: ContextContent,
}

impl ContextReference {
    pub fn validate_all(references: &[Self]) -> Result<(), &'static str> {
        if references.len() > 16 {
            return Err("Choose at most 16 context references");
        }
        let mut text_size = 0;
        let mut image_size = 0;
        for reference in references {
            if reference.id.is_empty() || reference.source.is_empty() || reference.label.is_empty()
            {
                return Err("Context identity is missing");
            }
            match &reference.content {
                ContextContent::Text { text } => {
                    text_size += text.len();
                    if text.contains('\0') || text_size > 128_000 {
                        return Err("Context text exceeds 128 KB or contains binary data");
                    }
                }
                ContextContent::Image { data, mime_type } => {
                    image_size += data.len();
                    if reference.kind != ContextKind::Image
                        || !matches!(
                            mime_type.as_str(),
                            "image/png" | "image/jpeg" | "image/gif" | "image/webp"
                        )
                        || data.is_empty()
                        || image_size > 14_000_000
                    {
                        return Err("Images must be PNG, JPEG, GIF or WebP, up to 10 MB total");
                    }
                }
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn context_limits_cover_the_whole_turn() {
        let reference = ContextReference {
            id: "file:a".into(),
            kind: ContextKind::File,
            label: "a".into(),
            source: "a".into(),
            content: ContextContent::Text { text: "a".into() },
        };
        for (references, valid) in [
            (vec![reference.clone()], true),
            (vec![reference.clone(); 17], false),
            (
                vec![ContextReference {
                    content: ContextContent::Text {
                        text: "x".repeat(128_001),
                    },
                    ..reference.clone()
                }],
                false,
            ),
            (
                vec![ContextReference {
                    content: ContextContent::Image {
                        data: "YWJj".into(),
                        mime_type: "image/png".into(),
                    },
                    ..reference
                }],
                false,
            ),
        ] {
            assert_eq!(ContextReference::validate_all(&references).is_ok(), valid);
        }
    }
}
