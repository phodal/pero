//! UI reads never start an Agent and never enter its conversation history.
use pero_contracts::{
    HostEvent,
    workspace_files::{FilesAction, WorkspaceFilesRequest},
};
use pero_runtime::workspace_files::WorkspaceFiles;

pub fn dispatch(value: serde_json::Value, agents: &crate::agents::Manager) {
    let request: WorkspaceFilesRequest = match serde_json::from_value(value) {
        Ok(request) => request,
        Err(_) => {
            let _ = crate::emit(HostEvent::message("error", None, "error.invalid_request"));
            return;
        }
    };
    let root = agents.artifact_workspace(&request.thread_id);
    // Directory I/O must not block cancellation or live ACP updates on Host's input loop.
    std::thread::spawn(move || {
        let mut event = HostEvent::new(
            "workspace_files_error",
            Some(request.request_id),
            String::new(),
        );
        event.thread_id = Some(request.thread_id);
        let result = (|| {
            let files = WorkspaceFiles::new(&root.ok_or("Conversation workspace is unavailable")?)?;
            match request.action {
                FilesAction::List => {
                    let listing = files.list(&request.path)?;
                    event.kind = "workspace_files_list".into();
                    event.data = serde_json::to_value(listing).expect("directory listing");
                }
                FilesAction::Read => {
                    let document = files.preview(&request.path)?;
                    event.kind = "workspace_files_document".into();
                    event.text = document.source().into();
                    event.data = serde_json::to_value(document.header()).expect("document header");
                }
            }
            Ok::<_, String>(())
        })();
        if let Err(error) = result {
            event.text = error;
        }
        let _ = crate::emit(event);
    });
}
