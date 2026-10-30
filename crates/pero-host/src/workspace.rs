//! Private Workbench recovery transport. Restoring source snapshots starts no Agent work.
use pero_contracts::{
    HostEvent,
    workspace_session::{WorkspaceCommand, WorkspaceRestore},
};
use pero_runtime::{file_documents::FileDocuments, workspace_store::WorkspaceStore};
pub fn dispatch(
    store: Option<&mut WorkspaceStore>,
    files: &mut FileDocuments,
    value: serde_json::Value,
) -> HostEvent {
    let command = match serde_json::from_value::<WorkspaceCommand>(value) {
        Ok(command) => command,
        Err(_) => return HostEvent::message("error", None, "error.invalid_request"),
    };
    let request = match &command {
        WorkspaceCommand::Save { request_id, .. }
        | WorkspaceCommand::Read { request_id, .. }
        | WorkspaceCommand::Reset { request_id, .. }
        | WorkspaceCommand::SourceBegin { request_id, .. }
        | WorkspaceCommand::SourceChunk { request_id, .. }
        | WorkspaceCommand::StoreDraft { request_id, .. } => Some(request_id.clone()),
        _ => None,
    };
    let mut store = store;
    match &command {
        WorkspaceCommand::SourceBegin {
            request_id,
            header,
            total_bytes,
            ..
        } => {
            let result = store
                .as_mut()
                .ok_or_else(|| std::io::Error::other("Workspace recovery storage is unavailable"))
                .and_then(|store| {
                    store.begin_source(request_id.clone(), header.clone(), *total_bytes)
                });
            return match result {
                Ok(()) => HostEvent::new("workspace_source_stored", request, String::new()),
                Err(error) => HostEvent::new("workspace_error", request, error.to_string()),
            };
        }
        WorkspaceCommand::SourceChunk {
            request_id, chunk, ..
        } => {
            let result = store
                .as_mut()
                .ok_or_else(|| std::io::Error::other("Workspace recovery storage is unavailable"))
                .and_then(|store| store.append_source(request_id, chunk.clone()));
            return match result {
                Ok(()) => HostEvent::new("workspace_source_stored", request, String::new()),
                Err(error) => HostEvent::new("workspace_error", request, error.to_string()),
            };
        }
        WorkspaceCommand::StoreDraft {
            base, draft, edits, ..
        } => {
            let update = pero_contracts::workspace_draft::DraftUpdate {
                base: base.clone(),
                draft: draft.clone(),
                edits: edits.clone(),
            };
            let result = (|| {
                let store = store.as_mut().ok_or_else(|| {
                    std::io::Error::other("Workspace recovery storage is unavailable")
                })?;
                let file_source =
                    files.recovery_source(&draft.source.source, draft.source.revision);
                if let Some(source) = &file_source {
                    store.materialize_file_source(source)?;
                }
                let cached = if store.drafts.needs_source(&draft.source) && file_source.is_none() {
                    Some(store.read_source(&draft.source)?.text)
                } else {
                    None
                };
                let baseline = if store.drafts.needs_source(&draft.source) {
                    file_source
                        .as_ref()
                        .map(|source| source.source())
                        .or(cached.as_deref())
                } else {
                    None
                };
                store.drafts.apply(&update, baseline)
            })();
            return match result {
                Ok(draft) => {
                    let mut event = HostEvent::new("draft_stored", request, String::new());
                    event.data = serde_json::to_value(draft).expect("draft reference");
                    event
                }
                Err(error) => HostEvent::new("workspace_error", request, error.to_string()),
            };
        }
        _ => {}
    }
    if let WorkspaceCommand::Read { key, .. } = &command {
        let result = store
            .as_ref()
            .ok_or_else(|| "Workspace recovery storage is unavailable".to_string())
            .and_then(|store| store.read_source(key).map_err(|error| error.to_string()));
        return match result {
            Ok(source) => {
                let conflict = matches!(
                    source.header.source.origin,
                    pero_contracts::content_origin::ContentOrigin::File { .. }
                ) && files
                    .restore(source.header.clone().into_document(source.text.clone()));
                let key = pero_contracts::workspace_session::SourceKey::of(&source.header);
                let draft = if let Some(reference) =
                    store.as_ref().and_then(|store| store.saved_draft(&key))
                {
                    match store.as_mut().unwrap().read_draft(&reference) {
                        Ok(text) => Some(text),
                        Err(error) => {
                            let mut event = HostEvent::new(
                                "workspace_source_error",
                                request,
                                error.to_string(),
                            );
                            event.data = serde_json::json!({"key":key,"draft":store.as_ref().and_then(|store|store.legacy_draft(&key))});
                            return event;
                        }
                    }
                } else {
                    store
                        .as_ref()
                        .and_then(|store| store.legacy_draft(&key))
                        .map(str::to_owned)
                };
                let mut event = HostEvent::new("workspace_source", request, String::new());
                event.data =
                    serde_json::to_value(pero_contracts::workspace_session::RecoveredSource {
                        source,
                        conflict,
                        draft,
                    })
                    .expect("recovered source");
                event
            }
            Err(error) => {
                let mut event = HostEvent::new("workspace_source_error", request, error);
                event.data = serde_json::json!({"key":key,"draft":store.as_ref().and_then(|store|store.legacy_draft(&key))});
                event
            }
        };
    }
    if matches!(command, WorkspaceCommand::Reset { .. }) {
        return match store.as_mut().map(|store| store.reset()).transpose() {
            Ok(_) => HostEvent::new("workspace_reset", request, String::new()),
            Err(error) => HostEvent::new("workspace_error", request, error.to_string()),
        };
    }
    let result = (|| -> Result<Option<WorkspaceRestore>, String> {
        let Some(store) = store else {
            return match command {
                WorkspaceCommand::Get { .. } => Ok(Some(WorkspaceRestore::default())),
                _ => Err("Workspace recovery storage is unavailable".into()),
            };
        };
        match command {
            WorkspaceCommand::Get { .. } => {
                let mut restored = store.load().map_err(|error| error.to_string())?;
                if let Some(session) = &restored.session {
                    for document in &session.documents {
                        if matches!(
                            document.header.source.origin,
                            pero_contracts::content_origin::ContentOrigin::File { .. }
                        ) {
                            files.remember_revision(
                                &document.header.source.id,
                                document.header.revision,
                            );
                        }
                    }
                }
                for source in &restored.sources {
                    if matches!(
                        source.header.source.origin,
                        pero_contracts::content_origin::ContentOrigin::File { .. }
                    ) && files.restore(source.header.clone().into_document(source.text.clone()))
                    {
                        restored.conflicts.push(source.header.source.id.clone());
                    }
                }
                if let Some(session) = &mut restored.session {
                    for document in &mut session.documents {
                        if restored
                            .sources
                            .iter()
                            .any(|source| source.header == document.header)
                        {
                            if let Some(reference) = &document.draft_ref {
                                match store.read_draft(reference) {
                                    Ok(text) => document.draft = Some(text),
                                    Err(_) => {
                                        let key = pero_contracts::workspace_session::SourceKey::of(
                                            &document.header,
                                        );
                                        restored
                                            .sources
                                            .retain(|source| source.header != document.header);
                                        restored.unavailable.push(key);
                                    }
                                }
                            }
                        }
                    }
                }
                if let Some(session) = &mut restored.session {
                    for document in &mut session.documents {
                        if document.draft_ref.is_none() && document.draft.is_some() {
                            document.legacy_draft = true;
                            if !restored
                                .sources
                                .iter()
                                .any(|source| source.header == document.header)
                            {
                                document.draft = None;
                            }
                        }
                    }
                }
                Ok(Some(restored))
            }
            WorkspaceCommand::Read { .. }
            | WorkspaceCommand::Reset { .. }
            | WorkspaceCommand::SourceBegin { .. }
            | WorkspaceCommand::SourceChunk { .. }
            | WorkspaceCommand::StoreDraft { .. } => unreachable!(),
            WorkspaceCommand::Save {
                session,
                mut sources,
                refresh,
                ..
            } => {
                if !session.valid()
                    || !session.accepts_sources(&sources)
                    || !refresh.iter().all(|key| {
                        session.documents.iter().any(|document| {
                            pero_contracts::workspace_session::SourceKey::of(&document.header)
                                == *key
                                && matches!(
                                    key.origin,
                                    pero_contracts::content_origin::ContentOrigin::File { .. }
                                )
                        })
                    })
                {
                    return Err("Invalid workspace checkpoint".into());
                }
                for reference in session
                    .documents
                    .iter()
                    .filter_map(|document| document.draft_ref.as_ref())
                {
                    if !store
                        .drafts
                        .contains(reference)
                        .map_err(|error| error.to_string())?
                    {
                        return Err("A workspace draft was not persisted".into());
                    }
                }
                for document in &session.documents {
                    let key = pero_contracts::workspace_session::SourceKey::of(&document.header);
                    if (store.needs_source(&key) || refresh.contains(&key))
                        && matches!(
                            document.header.source.origin,
                            pero_contracts::content_origin::ContentOrigin::File { .. }
                        )
                    {
                        let source = files
                            .recovery_source(&document.header.source.id, document.header.revision)
                            .ok_or("The file buffer is unavailable")?;
                        sources.push(pero_contracts::workspace_session::WorkspaceSource {
                            header: source.header(),
                            text: source.source().into(),
                        });
                    }
                }
                store
                    .save(session, sources)
                    .map_err(|error| error.to_string())?;
                Ok(None)
            }
        }
    })();
    match result {
        Ok(Some(restored)) => {
            let mut event = HostEvent::new("workspace_restored", None, String::new());
            event.data = serde_json::to_value(restored).expect("workspace restore");
            event
        }
        Ok(None) => HostEvent::new("workspace_saved", request.clone(), String::new()),
        Err(error) => HostEvent::new("workspace_error", request, error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pero_contracts::{
        content_document::ContentFormat,
        file_document::FileDocument,
        reader_state::ReaderState,
        workspace_session::{
            SavedDocument, WorkspaceRoute, WorkspaceSession, WorkspaceSnapshot, WorkspaceSource,
        },
    };
    #[test]
    fn visible_sources_load_lazily_and_corrupt_recovery_can_be_reset() {
        let directory =
            std::env::temp_dir().join(format!("pero-lazy-workspace-{}", std::process::id()));
        std::fs::create_dir_all(&directory).unwrap();
        let settings = directory.join("settings.json");
        let mut store = WorkspaceStore::new(&settings);
        let mut files = FileDocuments::default();
        let documents = (0..3)
            .map(|index| {
                let path = directory.join(format!("{index}.json"));
                std::fs::write(&path, "producer baseline").unwrap();
                FileDocument::loaded(
                    path.to_string_lossy().into(),
                    format!("{index}.json"),
                    format!("[{{\"n\":{index}}}]"),
                    ContentFormat::Json,
                    1,
                )
                .snapshot()
                .clone()
            })
            .collect::<Vec<_>>();
        let saved = documents
            .iter()
            .map(|document| SavedDocument {
                header: document.header(),
                reading: ReaderState::default(),
                draft: Some("retained inactive draft 中文".into()),
                draft_ref: None,
                legacy_draft: false,
            })
            .collect::<Vec<_>>();
        let session = WorkspaceSession {
            version: 1,
            workspace: directory.to_string_lossy().into(),
            navigation: WorkspaceSnapshot {
                items: saved.iter().map(SavedDocument::item).collect(),
                route: WorkspaceRoute::Content(saved[0].item()),
                other: Some(WorkspaceRoute::Content(saved[1].item())),
                ..Default::default()
            },
            documents: saved,
            web: vec![],
        };
        store
            .save(
                session.clone(),
                documents
                    .iter()
                    .map(|document| WorkspaceSource {
                        header: document.header(),
                        text: document.source().into(),
                    })
                    .collect(),
            )
            .unwrap();
        let checkpoint: serde_json::Value = serde_json::from_slice(
            &std::fs::read(settings.with_extension("workspace").join("session.json")).unwrap(),
        )
        .unwrap();
        let blob = checkpoint["sources"]
            .as_array()
            .unwrap()
            .iter()
            .find(|entry| entry["key"]["source"] == documents[2].id)
            .unwrap()["blob"]
            .as_str()
            .unwrap();
        let missing = settings
            .with_extension("workspace")
            .join(format!("{blob}.txt"));
        std::fs::remove_file(&missing).unwrap();
        let restored = dispatch(
            Some(&mut store),
            &mut files,
            serde_json::json!({"method":"workspace","action":"get"}),
        );
        assert_eq!(restored.kind, "workspace_restored");
        let restored: WorkspaceRestore = serde_json::from_value(restored.data).unwrap();
        assert_eq!(restored.sources.len(), 2);
        assert!(restored.unavailable.is_empty());
        let restored_session = restored.session.unwrap();
        assert_eq!(
            restored_session.documents[0].draft,
            session.documents[0].draft
        );
        assert!(restored_session.documents[2].draft.is_none());
        assert!(restored_session.documents[2].legacy_draft);
        assert!(files.recovery_source(&documents[2].id, 1).is_none());
        let read = serde_json::json!({"method":"workspace","action":"read","request_id":"retry","key":pero_contracts::workspace_session::SourceKey::of(&documents[2].header())});
        assert_eq!(
            dispatch(Some(&mut store), &mut files, read.clone()).kind,
            "workspace_source_error"
        );
        std::fs::write(&missing, documents[2].source()).unwrap();
        let loaded = dispatch(Some(&mut store), &mut files, read);
        assert_eq!(loaded.kind, "workspace_source");
        assert_eq!(loaded.data["conflict"], true);
        assert_eq!(loaded.data["source"]["text"], documents[2].source());
        assert_eq!(
            std::fs::read_to_string(&documents[2].id).unwrap(),
            "producer baseline"
        );
        std::fs::write(
            settings.with_extension("workspace").join("session.json"),
            "corrupt checkpoint",
        )
        .unwrap();
        assert_eq!(
            dispatch(
                Some(&mut store),
                &mut files,
                serde_json::json!({"method":"workspace","action":"get"})
            )
            .kind,
            "workspace_error"
        );
        assert_eq!(
            dispatch(
                Some(&mut store),
                &mut files,
                serde_json::json!({"method":"workspace","action":"reset","request_id":"reset"})
            )
            .kind,
            "workspace_reset"
        );
        assert!(!settings.with_extension("workspace").exists());
        assert!(std::path::Path::new(&documents[0].id).exists());
        assert!(store.load().unwrap().session.is_none());
        std::fs::remove_dir_all(directory).unwrap();
    }
    #[test]
    fn large_sources_and_dirty_datasets_checkpoint_with_bounded_frames_and_reference_file_writes() {
        use pero_contracts::{
            content_document::{DocumentHeader, DocumentSource},
            content_origin::ContentOrigin,
            workspace_draft::{DraftEdit, DraftRef},
            workspace_session::SourceKey,
            workspace_source::SOURCE_CHUNK_BYTES,
        };
        let directory =
            std::env::temp_dir().join(format!("pero-workspace-budget-{}", std::process::id()));
        std::fs::create_dir_all(&directory).unwrap();
        let settings = directory.join("settings.json");
        let mut store = WorkspaceStore::new(&settings);
        let mut files = FileDocuments::default();
        let header = DocumentHeader {
            source: DocumentSource {
                id: "large-readonly".into(),
                title: "large.json".into(),
                origin: ContentOrigin::Conversation {
                    thread_id: "retained-source".into(),
                },
            },
            revision: 1,
            format: ContentFormat::Json,
        };
        let body = format!("{{\"value\":\"{}中\"}}", "x".repeat(32 * 1024 * 1024 - 15));
        assert_eq!(body.len(), 32 * 1024 * 1024);
        assert_eq!(dispatch(Some(&mut store),&mut files,serde_json::json!({"method":"workspace","action":"source_begin","request_id":"large","header":header,"total_bytes":body.len()})).kind,"workspace_source_stored");
        let mut offset = 0;
        while offset < body.len() {
            let mut end = (offset + SOURCE_CHUNK_BYTES).min(body.len());
            while !body.is_char_boundary(end) {
                end -= 1;
            }
            let command = serde_json::json!({"method":"workspace","action":"source_chunk","request_id":"large","chunk":{"offset":offset,"text":&body[offset..end],"done":end==body.len()}});
            assert!(serde_json::to_vec(&command).unwrap().len() < 600_000);
            assert_eq!(
                dispatch(Some(&mut store), &mut files, command).kind,
                "workspace_source_stored"
            );
            offset = end;
        }
        let dataset="[\n".to_owned()+(0..100_000).map(|i|format!("{{\"id\":{},\"label\":\"中文 row {i}\",\"amount\":1.0000000000000000001,\"data\":{{\"ok\":true,\"text\":\"{}\"}}}}",9007199254740993u64+i,"x".repeat(25))).collect::<Vec<_>>().join(",\n").as_str()+"\n]";
        assert!(dataset.len() > 13_000_000);
        let path = directory.join("100k.json");
        std::fs::write(&path, &dataset).unwrap();
        let source = files.open(&path).unwrap();
        let draft = DraftRef {
            source: SourceKey::of(&source.header()),
            version: 1,
        };
        let edit = DraftEdit {
            old: 0..0,
            inserted: " ".into(),
        };
        let command = serde_json::json!({"method":"workspace","action":"store_draft","request_id":"dirty","base":null,"draft":draft,"edits":[edit]});
        assert!(serde_json::to_vec(&command).unwrap().len() < 1000);
        assert_eq!(
            dispatch(Some(&mut store), &mut files, command).kind,
            "draft_stored"
        );
        let saved = SavedDocument {
            header: source.header(),
            reading: ReaderState::default(),
            draft: None,
            draft_ref: Some(draft.clone()),
            legacy_draft: false,
        };
        let readonly = SavedDocument {
            header: header.clone(),
            reading: ReaderState::default(),
            draft: None,
            draft_ref: None,
            legacy_draft: false,
        };
        let session = WorkspaceSession {
            version: 1,
            workspace: directory.to_string_lossy().into(),
            navigation: WorkspaceSnapshot {
                items: vec![saved.item(), readonly.item()],
                route: WorkspaceRoute::Content(saved.item()),
                ..Default::default()
            },
            documents: vec![saved, readonly],
            web: vec![],
        };
        let command = serde_json::json!({"method":"workspace","action":"save","request_id":"checkpoint","session":session,"refresh":[],"sources":[]});
        assert!(serde_json::to_vec(&command).unwrap().len() < 4096);
        assert_eq!(
            dispatch(Some(&mut store), &mut files, command).kind,
            "workspace_saved"
        );
        let mut paths = vec![settings.with_extension("workspace").join("drafts")];
        let mut journal_bytes = 0;
        while let Some(path) = paths.pop() {
            for entry in std::fs::read_dir(path).unwrap() {
                let entry = entry.unwrap();
                if entry.file_type().unwrap().is_dir() {
                    paths.push(entry.path());
                } else {
                    journal_bytes += entry.metadata().unwrap().len();
                }
            }
        }
        assert!(journal_bytes < 4096);
        let reopened = dispatch(
            Some(&mut store),
            &mut files,
            serde_json::json!({"method":"workspace","action":"get"}),
        );
        assert_eq!(reopened.kind, "workspace_restored");
        assert_eq!(reopened.data["sources"].as_array().unwrap().len(), 1);
        assert_eq!(
            reopened.data["session"]["documents"][0]["draft"],
            format!(" {dataset}")
        );
        // A closed/lazy tab can save its durable draft without first mounting a Reader.
        files = FileDocuments::default();
        store = WorkspaceStore::new(&settings);
        store.load().unwrap();
        let saved=crate::documents::dispatch(&mut files,Some(&mut store),serde_json::json!({"method":"documents","action":"save_draft","request_id":"save:dataset","draft":draft})).unwrap();
        assert_eq!(saved.kind, "document_file");
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            format!(" {dataset}")
        );
        let target = directory.join("readonly-copy.json");
        let command = serde_json::json!({"method":"documents","action":"save_as_reference","request_id":"copy","path":target,"source":SourceKey::of(&header),"draft":null,"protected_sources":[]});
        assert!(serde_json::to_vec(&command).unwrap().len() < 1000);
        let copied = crate::documents::dispatch(&mut files, Some(&mut store), command).unwrap();
        assert_eq!(copied.kind, "document_file");
        assert_eq!(std::fs::read_to_string(target).unwrap(), body);
        std::fs::remove_dir_all(directory).unwrap();
    }
}
