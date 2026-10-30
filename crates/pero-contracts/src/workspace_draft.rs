//! Ordered UTF-8 edits form a versioned draft over one immutable source.
use crate::workspace_session::SourceKey;
use ropey::Rope;
use serde::{Deserialize, Serialize};
use std::{fmt, ops::Range};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DraftRef {
    pub source: SourceKey,
    pub version: u64,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DraftEdit {
    pub old: Range<usize>,
    pub inserted: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DraftUpdate {
    pub base: Option<DraftRef>,
    pub draft: DraftRef,
    pub edits: Vec<DraftEdit>,
}
#[derive(Clone, Debug)]
pub struct DraftBuffer {
    source: SourceKey,
    version: u64,
    text: Rope,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DraftError {
    Base,
    Version,
    Empty,
    Range,
}
impl fmt::Display for DraftError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Base => "Draft base does not match the current source and version",
            Self::Version => "Draft version must advance by one",
            Self::Empty => "Draft update contains no edits",
            Self::Range => "Draft edit is outside the text or splits a UTF-8 character",
        })
    }
}
impl std::error::Error for DraftError {}
impl DraftBuffer {
    pub fn from_source(source: SourceKey, text: &str) -> Self {
        Self {
            source,
            version: 0,
            text: Rope::from_str(text),
        }
    }
    pub fn reference(&self) -> Option<DraftRef> {
        (self.version > 0).then(|| DraftRef {
            source: self.source.clone(),
            version: self.version,
        })
    }
    pub fn text(&self) -> &Rope {
        &self.text
    }
    pub fn apply(&self, update: &DraftUpdate) -> Result<Self, DraftError> {
        if update.base != self.reference() || update.draft.source != self.source {
            return Err(DraftError::Base);
        }
        if self.version.checked_add(1) != Some(update.draft.version) {
            return Err(DraftError::Version);
        }
        if update.edits.is_empty() {
            return Err(DraftError::Empty);
        }
        // Rope clones share their unchanged chunks. A rejected batch leaves the
        // previous buffer intact without copying the complete document.
        let mut next = self.clone();
        for edit in &update.edits {
            if next.text.get_byte_slice(edit.old.clone()).is_none() {
                return Err(DraftError::Range);
            }
            let start = next.text.byte_to_char(edit.old.start);
            let end = next.text.byte_to_char(edit.old.end);
            next.text.remove(start..end);
            next.text.insert(start, &edit.inserted);
        }
        next.version = update.draft.version;
        Ok(next)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::content_origin::ContentOrigin;
    fn source() -> SourceKey {
        SourceKey {
            origin: ContentOrigin::File {
                path: "/example.txt".into(),
            },
            source: "/example.txt".into(),
            revision: 7,
        }
    }
    #[test]
    fn ordered_unicode_edits_advance_one_draft_atomically() {
        let baseline = DraftBuffer::from_source(source(), "a中🙂z");
        let edits = vec![
            DraftEdit {
                old: 1..4,
                inserted: "你\n".into(),
            },
            DraftEdit {
                old: 5..9,
                inserted: "好".into(),
            },
        ];
        // After the first edit the emoji occupies bytes 5..9.
        let update = DraftUpdate {
            base: None,
            draft: DraftRef {
                source: source(),
                version: 1,
            },
            edits,
        };
        let draft = baseline.apply(&update).unwrap();
        assert_eq!(draft.text().to_string(), "a你\n好z");
        assert_eq!(baseline.text().to_string(), "a中🙂z");
        for (base, version, edits, error) in [
            (None, 2, update.edits.clone(), DraftError::Version),
            (None, 1, vec![], DraftError::Empty),
            (draft.reference(), 1, update.edits.clone(), DraftError::Base),
            (
                None,
                1,
                vec![DraftEdit {
                    old: 2..3,
                    inserted: "x".into(),
                }],
                DraftError::Range,
            ),
            (
                None,
                1,
                vec![
                    update.edits[0].clone(),
                    DraftEdit {
                        old: 90..91,
                        inserted: "x".into(),
                    },
                ],
                DraftError::Range,
            ),
            (
                None,
                1,
                vec![DraftEdit {
                    old: 4..1,
                    inserted: "x".into(),
                }],
                DraftError::Range,
            ),
        ] {
            assert_eq!(
                baseline
                    .apply(&DraftUpdate {
                        base,
                        draft: DraftRef {
                            source: source(),
                            version
                        },
                        edits
                    })
                    .unwrap_err(),
                error
            );
            assert_eq!(baseline.text().to_string(), "a中🙂z");
        }
        let second = draft
            .apply(&DraftUpdate {
                base: draft.reference(),
                draft: DraftRef {
                    source: source(),
                    version: 2,
                },
                edits: vec![DraftEdit {
                    old: 0..1,
                    inserted: String::new(),
                }],
            })
            .unwrap();
        assert_eq!(second.text().to_string(), "你\n好z");
        let mut other = update;
        other.draft.source.revision += 1;
        assert_eq!(baseline.apply(&other).unwrap_err(), DraftError::Base);
    }
}
