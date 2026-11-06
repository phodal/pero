//! Host transport into recorded workspace comparisons.
use crate::agents::Manager;
use pero_contracts::{HostEvent, workspace_changes::ChangesRequest};
use pero_runtime::workspace_changes::ChangesStore;
use serde_json::{Value, json};
use std::path::Path;
pub struct Changes {
    store: Option<ChangesStore>,
}
impl Changes {
    pub fn new(settings: Option<&Path>) -> Self {
        Self {
            store: settings.map(ChangesStore::new),
        }
    }
    pub fn dispatch(&self, value: Value, agents: &Manager) -> HostEvent {
        let mut event = HostEvent::new(
            "workspace_changes_error",
            value["request_id"].as_str().map(str::to_owned),
            String::new(),
        );
        event.thread_id = value["thread_id"].as_str().map(str::to_owned);
        let result = (|| -> Result<(), String> {
            let request: ChangesRequest =
                serde_json::from_value(value).map_err(|e| e.to_string())?;
            if !request.valid() {
                return Err("Invalid workspace comparison request".into());
            }
            let (_, thread) = request.scope();
            let store = self
                .store
                .as_ref()
                .ok_or("Workspace comparisons require a persistent profile")?;
            let workspace = agents
                .artifact_workspace(thread)
                .ok_or("Conversation workspace is unavailable")?;
            match &request {
                ChangesRequest::List { .. } => {
                    event.kind = "workspace_changes_catalog".into();
                    event.data = json!({"changes":store.list(thread)?});
                }
                ChangesRequest::Current { .. } => {
                    let now = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .map(|time| time.as_millis() as u64)
                        .unwrap_or(0);
                    let changes = store.current(thread, &workspace, now)?;
                    event.kind = "workspace_changes".into();
                    event.data = json!({"changes":changes});
                }
                ChangesRequest::Read { id, index, .. } => {
                    let comparison = store.read(thread, id, *index)?;
                    event.kind = "workspace_change_diff".into();
                    event.data = json!({"id":id,"index":index,"comparison":comparison});
                }
            }
            Ok(())
        })();
        if let Err(error) = result {
            event.kind = "workspace_changes_error".into();
            event.text = error;
            event.data = Value::Null;
        }
        event
    }
}
