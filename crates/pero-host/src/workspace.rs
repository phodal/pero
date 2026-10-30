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
        WorkspaceCommand::Save { request_id, .. } => Some(request_id.clone()),
        _ => None,
    };
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
