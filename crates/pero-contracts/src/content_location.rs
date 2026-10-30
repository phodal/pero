//! A source-backed reading address carries no additional document authority.
use crate::content_document::DocumentHeader;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ReaderLocation {
    pub record: u32,
}

#[derive(Deserialize)]
#[serde(untagged)]
pub enum DocumentOpening {
    Located {
        header: DocumentHeader,
        location: ReaderLocation,
    },
    Source(DocumentHeader),
}
impl DocumentOpening {
    pub fn into_parts(self) -> (DocumentHeader, Option<ReaderLocation>) {
        match self {
            Self::Located { header, location } => (header, Some(location)),
            Self::Source(header) => (header, None),
        }
    }
}
