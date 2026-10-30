//! File transport: validate once, execute the runtime's file operation, emit a UI event.
use pero_contracts::{HostEvent, file_document::FileCommand};
use pero_runtime::file_documents::{FileDocuments, FileError};

pub fn dispatch(files: &mut FileDocuments, value: serde_json::Value) -> Option<HostEvent> {
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
