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
    session: Option<WorkspaceSession>,
    uploads: Vec<super::workspace_source_upload::SourceUpload>,
    retired: Vec<uuid::Uuid>,
    pub drafts: super::workspace_drafts::WorkspaceDrafts,
}
impl WorkspaceStore {
    pub fn new(settings: &Path) -> Self {
        Self {
            directory: settings.with_extension("workspace"),
            sources: vec![],
            session: None,
            uploads: vec![],
            retired: vec![],
            drafts: super::workspace_drafts::WorkspaceDrafts::new(
                settings.with_extension("workspace").join("drafts"),
            ),
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
        self.sources = saved.sources;
        self.session = Some(saved.session.clone());
        let mut restored = WorkspaceRestore {
            session: Some(saved.session.clone()),
            ..Default::default()
        };
        for document in &saved.session.documents {
            let item = document.item();
            let visible = saved.session.navigation.route
                == pero_contracts::workspace_session::WorkspaceRoute::Content(item.clone())
                || saved.session.navigation.other.as_ref()
                    == Some(&pero_contracts::workspace_session::WorkspaceRoute::Content(
                        item.clone(),
                    ))
                || saved.session.navigation.route.supports_pane() && saved.session.navigation.panes.as_ref().is_some_and(|panes|panes.is_active(&saved.session.navigation.route) && panes.leaves().iter().any(|view|view.route==pero_contracts::workspace_session::WorkspaceRoute::Content(item.clone())));
            if visible {
                let key = SourceKey::of(&document.header);
                match self.read_source(&key) {
                    Ok(source) => restored.sources.push(source),
                    Err(_) => restored.unavailable.push(key),
                }
            }
        }
        Ok(restored)
    }
    pub fn read_source(&self, key: &SourceKey) -> io::Result<WorkspaceSource> {
        let header = self
            .session
            .as_ref()
            .and_then(|session| {
                session
                    .documents
                    .iter()
                    .find(|document| SourceKey::of(&document.header) == *key)
            })
            .map(|document| document.header.clone())
            .ok_or_else(|| {
                io::Error::new(
                    io::ErrorKind::NotFound,
                    "Saved source descriptor is unavailable",
                )
            })?;
        let text = self.read_source_text(key)?;
        Ok(WorkspaceSource { header, text })
    }
    pub fn materialize_file_source(
        &mut self,
        document: &pero_contracts::content_document::ContentDocument,
    ) -> io::Result<()> {
        let key = SourceKey::of(&document.header());
        if !self.needs_source(&key) {
            return Ok(());
        }
        std::fs::create_dir_all(&self.directory)?;
        let blob = uuid::Uuid::new_v4();
        write(
            &self.directory.join(format!("{blob}.txt")),
            document.source().as_bytes(),
        )?;
        self.sources.push(StoredSource { key, blob });
        Ok(())
    }
    pub fn read_source_text(&self, key: &SourceKey) -> io::Result<String> {
        if self
            .uploads
            .iter()
            .any(|upload| SourceKey::of(&upload.header) == *key)
        {
            return Err(io::Error::other("A workspace source upload is unfinished"));
        }
        let stored = self
            .sources
            .iter()
            .find(|source| source.key == *key)
            .ok_or_else(|| {
                io::Error::new(io::ErrorKind::NotFound, "Saved source is unavailable")
            })?;
        std::fs::read_to_string(self.directory.join(format!("{}.txt", stored.blob)))
    }
    pub fn reset(&mut self) -> io::Result<()> {
        self.uploads.clear();
        match std::fs::remove_dir_all(&self.directory) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
        self.retired.clear();
        self.sources.clear();
        self.session = None;
        self.drafts.clear();
        Ok(())
    }
    pub fn read_draft(
        &mut self,
        reference: &pero_contracts::workspace_draft::DraftRef,
    ) -> io::Result<String> {
        let source = if self.drafts.needs_source(&reference.source) {
            Some(self.read_source(&reference.source)?.text)
        } else {
            None
        };
        self.drafts.read(reference, source.as_deref())
    }
    pub fn legacy_draft(&self, key: &SourceKey) -> Option<&str> {
        self.session
            .as_ref()?
            .documents
            .iter()
            .find(|document| SourceKey::of(&document.header) == *key)?
            .draft
            .as_deref()
    }
    pub fn saved_draft(
        &self,
        key: &SourceKey,
    ) -> Option<pero_contracts::workspace_draft::DraftRef> {
        self.session
            .as_ref()?
            .documents
            .iter()
            .find(|document| SourceKey::of(&document.header) == *key)?
            .draft_ref
            .clone()
    }
    pub fn begin_source(
        &mut self,
        request: String,
        header: pero_contracts::content_document::DocumentHeader,
        total: u64,
    ) -> io::Result<()> {
        let key = SourceKey::of(&header);
        let mut index = 0;
        while index < self.uploads.len() {
            if self.uploads[index].request == request
                || SourceKey::of(&self.uploads[index].header) == key
            {
                self.uploads.remove(index).discard();
            } else {
                index += 1;
            }
        }
        self.uploads
            .push(super::workspace_source_upload::SourceUpload::new(
                &self.directory,
                request,
                header,
                total,
            )?);
        Ok(())
    }
    pub fn append_source(
        &mut self,
        request: &str,
        chunk: pero_contracts::workspace_source::SourceChunk,
    ) -> io::Result<()> {
        let index = self
            .uploads
            .iter()
            .position(|upload| upload.request == request)
            .ok_or_else(|| {
                io::Error::new(io::ErrorKind::NotFound, "Source upload is unavailable")
            })?;
        self.uploads[index].append(&chunk)?;
        if self.uploads[index].progress.complete {
            let (header, blob) = self.uploads[index].publish(&self.directory)?;
            self.uploads.remove(index);
            let key = SourceKey::of(&header);
            if let Some(source) = self.sources.iter_mut().find(|source| source.key == key) {
                self.retired.push(source.blob);
                source.blob = blob;
            } else {
                self.sources.push(StoredSource { key, blob });
            }
        }
        Ok(())
    }
    pub fn needs_source(&self, key: &SourceKey) -> bool {
        !self.sources.iter().any(|source| &source.key == key)
    }
    /// Source text is supplied only for new revisions. Reading-state and draft changes update metadata.
    pub fn save(
        &mut self,
        mut session: WorkspaceSession,
        sources: Vec<WorkspaceSource>,
    ) -> io::Result<()> {
        for document in &mut session.documents {
            if document.legacy_draft && document.draft.is_none() {
                document.draft = Some(
                    self.legacy_draft(&SourceKey::of(&document.header))
                        .ok_or_else(|| {
                            io::Error::new(
                                io::ErrorKind::NotFound,
                                "Legacy saved draft is unavailable",
                            )
                        })?
                        .to_owned(),
                );
            }
        }
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
        if self.uploads.iter().any(|upload| {
            session
                .documents
                .iter()
                .any(|document| SourceKey::of(&document.header) == SourceKey::of(&upload.header))
        }) {
            return Err(io::Error::other("A workspace source upload is unfinished"));
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
            session: session.clone(),
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
        let references = session
            .documents
            .iter()
            .filter_map(|document| document.draft_ref.clone())
            .collect::<Vec<_>>();
        let _ = self.drafts.retain(&references);
        self.session = Some(session);
        // Publish the checkpoint first. Cleanup only removes superseded recovery copies, never producer files.
        for blob in unused.into_iter().chain(self.retired.drain(..)) {
            let _ = std::fs::remove_file(self.directory.join(format!("{blob}.txt")));
        }
        Ok(())
    }
}
pub(crate) fn write(path: &Path, bytes: &[u8]) -> io::Result<()> {
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
            draft_ref: None,
            legacy_draft: false,
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
