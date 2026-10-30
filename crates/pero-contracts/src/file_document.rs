//! File save decisions are values; the runtime carries out the write.
use crate::{
    content_document::{ContentDocument, ContentFormat, DocumentSource},
    content_origin::ContentOrigin,
};
#[derive(Clone)]
pub struct FileDocument {
    snapshot: ContentDocument,
}
pub enum FileSave {
    Unchanged,
    Write(FileDocument),
}
#[derive(Debug, PartialEq, Eq)]
pub enum SaveError {
    StaleRevision,
    ChangedOnDisk,
}
impl FileDocument {
    pub fn loaded(path: String, title: String, text: String, format: ContentFormat) -> Self {
        Self {
            snapshot: ContentDocument::new(
                DocumentSource {
                    id: path.clone(),
                    origin: ContentOrigin::File { path },
                    title,
                },
                1,
                text,
                format,
            ),
        }
    }
    pub fn snapshot(&self) -> &ContentDocument {
        &self.snapshot
    }
    pub fn refreshed(&self, text: String) -> Self {
        if text == self.snapshot.source() {
            return self.clone();
        }
        Self {
            snapshot: ContentDocument::new(
                (*self.snapshot).clone(),
                self.snapshot.revision + 1,
                text,
                self.snapshot.format.clone(),
            ),
        }
    }
    pub fn prepare_save(
        &self,
        expected_revision: u64,
        disk: &str,
        text: String,
    ) -> Result<FileSave, SaveError> {
        if expected_revision != self.snapshot.revision {
            return Err(SaveError::StaleRevision);
        }
        if disk != self.snapshot.source() {
            return Err(SaveError::ChangedOnDisk);
        }
        if text == disk {
            Ok(FileSave::Unchanged)
        } else {
            Ok(FileSave::Write(self.refreshed(text)))
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn save_decisions_preserve_drafts_and_reject_external_changes() {
        let file = FileDocument::loaded(
            "/work/notes.md".into(),
            "notes.md".into(),
            "original".into(),
            ContentFormat::Markdown,
        );
        for (revision, disk, draft, expected) in [
            (1, "original", "edited", Ok(true)),
            (1, "original", "original", Ok(false)),
            (0, "original", "edited", Err(SaveError::StaleRevision)),
            (1, "external", "edited", Err(SaveError::ChangedOnDisk)),
        ] {
            let actual =
                file.prepare_save(revision, disk, draft.into())
                    .map(|effect| match effect {
                        FileSave::Unchanged => false,
                        FileSave::Write(next) => {
                            assert_eq!(next.snapshot.source(), draft);
                            assert_eq!(next.snapshot.revision, 2);
                            true
                        }
                    });
            assert_eq!(actual, expected);
            assert_eq!(file.snapshot.source(), "original");
        }
        assert_eq!(file.refreshed("original".into()).snapshot.revision, 1);
        assert_eq!(file.refreshed("external".into()).snapshot.revision, 2);
    }
}

/// File commands arrive from the trusted Workbench, never from an App frame.
#[derive(serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DocumentMethod {
    Documents,
}
#[derive(serde::Deserialize)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
pub enum FileCommand {
    Open {
        method: DocumentMethod,
        request_id: String,
        path: String,
    },
    Follow {
        method: DocumentMethod,
        request_id: String,
        source: String,
        href: String,
    },
    Save {
        method: DocumentMethod,
        request_id: String,
        source: String,
        revision: u64,
        text: String,
    },
    Release {
        method: DocumentMethod,
        source: String,
    },
}
