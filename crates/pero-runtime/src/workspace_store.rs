//! Host-owned workspace checkpoints. Large source snapshots are separate from settings and metadata.
use pero_contracts::workspace_session::{
    SourceKey, WorkspaceRestore, WorkspaceSession, WorkspaceSource,
};
use serde::{Deserialize, Serialize};
use std::{
    io,
    path::{Path, PathBuf},
};

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct StoredSource {
    key: SourceKey,
    blob: uuid::Uuid,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Checkpoint {
    session: WorkspaceSession,
    sources: Vec<StoredSource>,
}
pub struct WorkspaceStore {
    directory: PathBuf,
    sources: Vec<StoredSource>,
}
impl WorkspaceStore {
    pub fn new(settings: &Path) -> Self {
        Self {
            directory: settings.with_extension("workspace"),
            sources: vec![],
        }
    }
    pub fn load(&mut self) -> io::Result<WorkspaceRestore> {
        let bytes = match std::fs::read(self.directory.join("session.json")) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                return Ok(WorkspaceRestore::default());
            }
            Err(error) => return Err(error),
        };
        let saved: Checkpoint = serde_json::from_slice(&bytes)?;
        if !saved.session.valid() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Invalid saved workspace",
            ));
        }
        let mut sources = Vec::new();
        for document in &saved.session.documents {
            let key = SourceKey::of(&document.header);
            let stored = saved
                .sources
                .iter()
                .find(|source| source.key == key)
                .ok_or_else(|| {
                    io::Error::new(io::ErrorKind::InvalidData, "Saved source is unavailable")
                })?;
            let text =
                std::fs::read_to_string(self.directory.join(format!("{}.txt", stored.blob)))?;
            sources.push(WorkspaceSource {
                header: document.header.clone(),
                text,
            });
        }
        self.sources = saved.sources;
        Ok(WorkspaceRestore {
            session: Some(saved.session),
            sources,
            conflicts: vec![],
        })
    }
    pub fn needs_source(&self, key: &SourceKey) -> bool {
        !self.sources.iter().any(|source| &source.key == key)
    }
    /// Source text is supplied only for new revisions. Reading-state and draft changes update metadata.
    pub fn save(
        &mut self,
        session: WorkspaceSession,
        sources: Vec<WorkspaceSource>,
    ) -> io::Result<()> {
        std::fs::create_dir_all(&self.directory)?;
        let mut stored = self.sources.clone();
        for source in sources {
            let key = SourceKey::of(&source.header);
            let blob = uuid::Uuid::new_v4();
            write(
                &self.directory.join(format!("{blob}.txt")),
                source.text.as_bytes(),
            )?;
            if let Some(previous) = stored.iter_mut().find(|source| source.key == key) {
                *previous = StoredSource { key, blob };
            } else {
                stored.push(StoredSource { key, blob });
            }
        }
        // A metadata-only write must not quietly turn a missing source into a different document.
        if session.documents.iter().any(|document| {
            !stored
                .iter()
                .any(|source| source.key == SourceKey::of(&document.header))
        }) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "A workspace source was not materialized",
            ));
        }
        stored.retain(|source| {
            session
                .documents
                .iter()
                .any(|document| SourceKey::of(&document.header) == source.key)
        });
        let saved = Checkpoint {
            session,
            sources: stored.clone(),
        };
        write(
            &self.directory.join("session.json"),
            &serde_json::to_vec(&saved)?,
        )?;
        let unused: Vec<_> = self
            .sources
            .iter()
            .filter(|old| !stored.iter().any(|source| source.blob == old.blob))
            .map(|source| source.blob)
            .collect();
        self.sources = stored;
        // Publish the checkpoint first. Cleanup only removes superseded recovery copies, never producer files.
        for blob in unused {
            let _ = std::fs::remove_file(self.directory.join(format!("{blob}.txt")));
        }
        Ok(())
    }
}
fn write(path: &Path, bytes: &[u8]) -> io::Result<()> {
    use std::io::Write;
    let pending = path.with_extension("pending");
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&pending)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    std::fs::rename(pending, path)
}
#[cfg(test)]
mod tests {
    use super::*;
    use pero_contracts::{
        reader_state::ReaderState,
        workspace_session::{SavedDocument, WorkspaceRoute, WorkspaceSnapshot},
    };
    #[test]
    fn checkpoint_reopens_sources_and_drafts_without_rewriting_source_blobs() {
        let directory =
            std::env::temp_dir().join(format!("pero-workspace-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join("numbers.json");
        std::fs::write(&path, "[{\"n\":9007199254740993}]").unwrap();
        let mut files = crate::file_documents::FileDocuments::default();
        let source = files.open(&path).unwrap();
        let document = SavedDocument {
            header: source.header(),
            reading: ReaderState {
                source: true,
                selection: 3..8,
                ..Default::default()
            },
            draft: Some("draft 中文".into()),
        };
        let item = document.item();
        let session = WorkspaceSession {
            version: 1,
            workspace: directory.to_string_lossy().into(),
            navigation: WorkspaceSnapshot {
                items: vec![item.clone()],
                route: WorkspaceRoute::Content(item),
                ..Default::default()
            },
            documents: vec![document],
            web: vec![],
        };
        assert!(session.valid());
        let settings = directory.join("settings.json");
        let mut store = WorkspaceStore::new(&settings);
        store
            .save(
                session.clone(),
                vec![WorkspaceSource {
                    header: source.header(),
                    text: source.source().into(),
                }],
            )
            .unwrap();
        let mut moved = session.clone();
        moved.documents[0].reading.selection = 8..9;
        store.save(moved.clone(), vec![]).unwrap();
        assert_eq!(
            std::fs::read_dir(settings.with_extension("workspace"))
                .unwrap()
                .filter_map(Result::ok)
                .filter(|entry| entry
                    .path()
                    .extension()
                    .is_some_and(|extension| extension == "txt"))
                .count(),
            1
        );
        let restored = WorkspaceStore::new(&settings).load().unwrap();
        assert_eq!(restored.session.unwrap(), moved);
        assert_eq!(restored.sources[0].text, source.source());
        // A producer restart can reuse the same key with new immutable bytes.
        store
            .save(
                session.clone(),
                vec![WorkspaceSource {
                    header: source.header(),
                    text: "republished source".into(),
                }],
            )
            .unwrap();
        assert_eq!(
            WorkspaceStore::new(&settings).load().unwrap().sources[0].text,
            "republished source"
        );
        assert_eq!(
            std::fs::read_dir(settings.with_extension("workspace"))
                .unwrap()
                .filter_map(Result::ok)
                .filter(|entry| entry
                    .path()
                    .extension()
                    .is_some_and(|extension| extension == "txt"))
                .count(),
            1
        );
        let empty = WorkspaceSession {
            version: 1,
            workspace: session.workspace.clone(),
            navigation: WorkspaceSnapshot::default(),
            documents: vec![],
            web: vec![],
        };
        store.save(empty, vec![]).unwrap();
        assert_eq!(
            std::fs::read_dir(settings.with_extension("workspace"))
                .unwrap()
                .filter_map(Result::ok)
                .filter(|entry| entry
                    .path()
                    .extension()
                    .is_some_and(|extension| extension == "txt"))
                .count(),
            0
        );
        std::fs::write(&path, "changed on disk").unwrap();
        let mut files = crate::file_documents::FileDocuments::default();
        assert!(
            files.restore(
                restored
                    .sources
                    .into_iter()
                    .next()
                    .unwrap()
                    .header
                    .into_document(source.source().into())
            )
        );
        assert!(matches!(
            files.save(&source.id, source.revision, "draft 中文".into()),
            Err(crate::file_documents::FileError::Conflict)
        ));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "changed on disk");
        std::fs::remove_dir_all(directory).unwrap();
    }
}
