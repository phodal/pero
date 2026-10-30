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
        | WorkspaceCommand::Reset { request_id, .. } => Some(request_id.clone()),
        _ => None,
    };
    let mut store = store;
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
                let mut event = HostEvent::new("workspace_source", request, String::new());
                event.data =
                    serde_json::to_value(pero_contracts::workspace_session::RecoveredSource {
                        source,
                        conflict,
                    })
                    .expect("recovered source");
                event
            }
            Err(error) => {
                let mut event = HostEvent::new("workspace_source_error", request, error);
                event.data = serde_json::json!({"key":key});
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
                for source in &restored.sources {
                    if matches!(
                        source.header.source.origin,
                        pero_contracts::content_origin::ContentOrigin::File { .. }
                    ) && files.restore(source.header.clone().into_document(source.text.clone()))
                    {
                        restored.conflicts.push(source.header.source.id.clone());
                    }
                }
                Ok(Some(restored))
            }
            WorkspaceCommand::Read { .. } | WorkspaceCommand::Reset { .. } => unreachable!(),
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
        assert_eq!(restored.session.unwrap(), session);
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
}
