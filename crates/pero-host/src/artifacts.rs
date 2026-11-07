//! Trusted Workbench/Agent-tool transport into the Host-owned conversation delivery store.
use crate::agents::Manager;
use pero_contracts::{HostEvent, session_artifact::ArtifactRequest};
use pero_runtime::session_artifacts::{ArtifactStoreError, SessionArtifacts};
use serde_json::{Value, json};
use std::{
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

pub struct Artifacts {
    store: Option<SessionArtifacts>,
}
impl Artifacts {
    pub fn new(settings: Option<&Path>) -> Self {
        Self {
            store: settings.map(SessionArtifacts::new),
        }
    }
    pub fn dispatch(&self, value: Value, agents: &Manager) -> HostEvent {
        let private_snapshot =
            value.get("action").and_then(Value::as_str) == Some("resolve_snapshot");
        let request_id = value
            .get("request_id")
            .and_then(Value::as_str)
            .map(str::to_owned);
        let thread_id = value
            .get("thread_id")
            .and_then(Value::as_str)
            .map(str::to_owned);
        let artifact_id = value
            .get("artifact_id")
            .and_then(Value::as_str)
            .map(str::to_owned);
        let error = |reason: &str, text: String| {
            if private_snapshot {
                let mut event = HostEvent::new(
                    "artifact_snapshot_result",
                    request_id.clone(),
                    String::new(),
                );
                event.thread_id = thread_id.clone();
                event.data = json!({"ok":false,"error":text});
                return event;
            }
            let mut event = HostEvent::new("artifact_error", request_id.clone(), text);
            event.thread_id = thread_id.clone();
            event.data = json!({"thread_id":thread_id,"artifact_id":artifact_id,"reason":reason});
            event
        };
        let request: ArtifactRequest = match serde_json::from_value(value) {
            Ok(request) => request,
            Err(_) => return error("invalid", "Invalid artifact request".into()),
        };
        if let Err(reason) = request.validate_identity() {
            return error("invalid", reason.to_string());
        }
        let Some(store) = &self.store else {
            return error(
                "unavailable",
                "Artifacts require a persistent Host profile".into(),
            );
        };
        let result = (|| -> Result<HostEvent, ArtifactStoreError> {
            let (_, thread, _) = request.scope();
            let mut event = match &request {
                ArtifactRequest::List { .. } => {
                    let mut event =
                        HostEvent::new("artifact_catalog", request_id.clone(), String::new());
                    event.data = json!({"artifacts":store.list(thread)?});
                    event
                }
                ArtifactRequest::Read {
                    artifact_id,
                    version,
                    ..
                } => {
                    let document = store.read(thread, artifact_id, *version)?;
                    let mut event = HostEvent::new(
                        "artifact_document",
                        request_id.clone(),
                        document.source().into(),
                    );
                    event.data =
                        serde_json::to_value(document.header()).expect("artifact document header");
                    event
                }
                ArtifactRequest::ResolveSnapshot {
                    artifact_id,
                    version,
                    ..
                } => {
                    let snapshot = store.resolve_snapshot(thread, artifact_id, *version)?;
                    let mut event = HostEvent::new(
                        "artifact_snapshot_result",
                        request_id.clone(),
                        String::new(),
                    );
                    event.data = json!({"ok":true,"value":snapshot});
                    event
                }
                ArtifactRequest::Context {
                    artifact_id,
                    version,
                    ..
                } => {
                    let mut event =
                        HostEvent::new("artifact_context", request_id.clone(), String::new());
                    event.data =
                        serde_json::to_value(store.context(thread, artifact_id, *version)?)
                            .expect("artifact context");
                    event
                }
                ArtifactRequest::RegisterText { .. } | ArtifactRequest::RegisterFile { .. } => {
                    // History records the workspace bound at session creation. UI navigation cannot change it.
                    let workspace = agents
                        .artifact_workspace(thread)
                        .ok_or(ArtifactStoreError::Unavailable)?;
                    let now = SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .map(|time| time.as_secs())
                        .unwrap_or(0);
                    let artifact = store.register(request.clone(), Some(&workspace), now)?;
                    let mut event =
                        HostEvent::new("artifact_registered", request_id.clone(), String::new());
                    event.data = json!({"artifact":artifact});
                    if let ArtifactRequest::RegisterFile { presentation: Some(presentation), .. } = &request {
                        event.data["presentation"] = json!(presentation);
                    }
                    event
                }
            };
            event.thread_id = Some(thread.to_owned());
            Ok(event)
        })();
        result.unwrap_or_else(|failure| error(failure.reason(), failure.to_string()))
    }
}
