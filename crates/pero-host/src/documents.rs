//! File transport: validate once, execute the runtime's file operation, emit a UI event.
use pero_contracts::{HostEvent, file_document::FileCommand};
use pero_runtime::file_documents::{FileDocuments, FileError};

pub fn dispatch(
    files: &mut FileDocuments,
    mut workspace: Option<&mut pero_runtime::workspace_store::WorkspaceStore>,
    value: serde_json::Value,
) -> Option<HostEvent> {
    let command = match serde_json::from_value::<FileCommand>(value) {
        Ok(command) => command,
        Err(_) => return Some(HostEvent::message("error", None, "error.invalid_request")),
    };
    let (request, source, result) = match command {
        FileCommand::Open {
            request_id, path, ..
        } => {
            let result = files.open(std::path::Path::new(&path));
            (request_id, path, result)
        }
        FileCommand::Follow {
            request_id,
            source,
            href,
            ..
        } => {
            let result = files.follow(&source, &href);
            (request_id, source, result)
        }
        FileCommand::Save {
            request_id,
            source,
            revision,
            text,
            ..
        } => {
            let result = files.save(&source, revision, text);
            (request_id, source, result)
        }
        FileCommand::SaveDraft {
            request_id, draft, ..
        } => {
            let source = draft.source.source.clone();
            let result = (|| {
                let store = workspace.as_mut().ok_or(FileError::Unavailable)?;
                if files
                    .recovery_source(&source, draft.source.revision)
                    .is_none()
                {
                    let baseline = store.read_source(&draft.source)?;
                    files.restore_if_closed(baseline.header.into_document(baseline.text));
                }
                let text = store.read_draft(&draft)?;
                files.save(&source, draft.source.revision, text)
            })();
            (request_id, source, result)
        }
        FileCommand::SaveAsReference {
            request_id,
            path,
            source,
            draft,
            protected_sources,
            ..
        } => {
            let result = (|| {
                let current = files.recovery_source(&source.source, source.revision);
                let text = if let Some(draft) = draft {
                    if draft.source != source {
                        return Err(FileError::Conflict);
                    }
                    let store = workspace.as_mut().ok_or(FileError::Unavailable)?;
                    store
                        .drafts
                        .read(&draft, current.as_ref().map(|source| source.source()))?
                } else if let Some(current) = current {
                    current.source().to_owned()
                } else {
                    workspace
                        .as_ref()
                        .ok_or(FileError::Unavailable)?
                        .read_source_text(&source)?
                };
                files.save_as(pero_contracts::file_document::FileCopy {
                    path: path.clone(),
                    text,
                    protected_sources,
                })
            })();
            (request_id, path, result)
        }
        FileCommand::SaveAs {
            request_id, copy, ..
        } => {
            let path = copy.path.clone();
            let result = files.save_as(copy);
            (request_id, path, result)
        }
        FileCommand::Release { source, .. } => {
            files.release(&source);
            return None;
        }
    };
    Some(match result {
        Ok(document) => {
            let mut event =
                HostEvent::new("document_file", Some(request), document.source().into());
            event.data = serde_json::to_value(document.header()).expect("document header");
            event
        }
        Err(error) => {
            let reason = match error {
                FileError::Conflict => "conflict",
                FileError::Unsupported => "unsupported",
                FileError::Unavailable => "unavailable",
                FileError::Io(_) => "read_write",
            };
            let mut event = HostEvent::new("document_error", Some(request), String::new());
            event.data = serde_json::json!({"source":source,"reason":reason});
            event
        }
    })
}
