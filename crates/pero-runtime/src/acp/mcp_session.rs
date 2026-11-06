//! Replies from the existing ACP session. No separate MCP client is created here.
use pero_contracts::{
    HostEvent,
    mcp_session::{McpSessionError, McpSessionRequest},
};
use serde_json::{Value, json};
use std::sync::mpsc::Sender;

pub(super) const CAPABILITY: &str = "pero.mcpSession";
pub(super) const METHOD: &str = "_pero/mcp/session";
pub fn reply(
    tx: &Sender<HostEvent>,
    request: &McpSessionRequest,
    result: Result<Value, McpSessionError>,
) {
    let result = result.and_then(|value| {
        if serde_json::to_vec(&value).map_or(true, |v| v.len() > 1_048_576) {
            Err(McpSessionError::Invalid)
        } else {
            Ok(value)
        }
    });
    let mut event = HostEvent::new(
        if result.is_ok() {
            "mcp_session"
        } else {
            "mcp_session_error"
        },
        Some(request.request_id.clone()),
        String::new(),
    );
    event.thread_id = Some(request.thread_id.clone());
    event.data = match result {
        Ok(result) => {
            json!({"incarnation":request.incarnation,"revision":request.revision,"result":result})
        }
        Err(reason) => {
            json!({"incarnation":request.incarnation,"revision":request.revision,"reason":reason})
        }
    };
    let _ = tx.send(event);
}

pub(super) fn managed(config: &super::AgentConfig, server: &str) -> bool {
    config.managed_mcp.as_ref().is_some_and(|configuration| {
        configuration
            .servers
            .iter()
            .any(|item| item.enabled && item.name == server)
    })
}

/// Operator and internal connections are not user-managed settings entries.
pub(super) fn project(
    config: &super::AgentConfig,
    request: &McpSessionRequest,
    mut value: Value,
) -> Result<Value, McpSessionError> {
    if matches!(
        request.action,
        pero_contracts::mcp_session::McpSessionAction::List
    ) {
        let servers = value
            .get_mut("servers")
            .and_then(Value::as_array_mut)
            .ok_or(McpSessionError::Invalid)?;
        servers.retain(|server| {
            server["name"]
                .as_str()
                .is_some_and(|name| managed(config, name))
        });
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn directory_cannot_expose_operator_or_internal_connections() {
        let config: super::super::AgentConfig = serde_json::from_value(
            json!({"id":"test","name":"Test","command":std::env::current_exe().unwrap()}),
        )
        .unwrap();
        let configuration = serde_json::from_value(json!({"revision":1,"servers":[
            {"name":"My Docs","enabled":true,"transport":{"type":"http","url":"https://example.test/mcp"}},
            {"name":"disabled","enabled":false,"transport":{"type":"http","url":"https://example.test/mcp"}}
        ]})).unwrap();
        let config = config.with_managed_mcp(&configuration);
        let request: McpSessionRequest = serde_json::from_value(json!({"method":"mcp.session","request_id":"r","thread_id":"t","incarnation":1,"revision":1,"action":"list"})).unwrap();
        let value = project(&config, &request, json!({"servers":[{"name":"My Docs"},{"name":"My_Docs"},{"name":"disabled"},{"name":"operator"},{"name":"pero-app-use"}]})).unwrap();
        assert_eq!(value, json!({"servers":[{"name":"My Docs"}]}));
        assert!(!managed(&config, "My_Docs"));
        assert!(!managed(&config, "disabled"));
    }
    #[test]
    fn replies_are_correlated_and_bounded() {
        let request: McpSessionRequest = serde_json::from_value(json!({"method":"mcp.session","request_id":"r","thread_id":"t","incarnation":1,"revision":2,"action":"list"})).unwrap();
        let (tx, rx) = std::sync::mpsc::channel();
        reply(&tx, &request, Ok(json!({"payload":"x".repeat(1_048_577)})));
        let event = rx.recv().unwrap();
        assert_eq!(event.kind, "mcp_session_error");
        assert_eq!(event.request_id.as_deref(), Some("r"));
        assert_eq!(event.thread_id.as_deref(), Some("t"));
        assert_eq!(
            event.data,
            json!({"incarnation":1,"revision":2,"reason":"invalid"})
        );
    }
}

/// Serializes binding revocation with permission registration. Other bindings and
/// ordinary model permissions remain untouched by an App close.
#[derive(Default)]
pub(super) struct AppApprovals {
    revoked: std::collections::HashSet<String>,
    pending: std::collections::HashMap<String, std::collections::HashSet<String>>,
}
impl AppApprovals {
    pub fn register(
        &mut self,
        binding: Option<&str>,
        id: &str,
        answer: tokio::sync::oneshot::Sender<Option<String>>,
        permissions: &super::session::Permissions,
    ) {
        if let Some(binding) = binding {
            if self.revoked.contains(binding) {
                return;
            }
            self.pending
                .entry(binding.into())
                .or_default()
                .insert(id.into());
        }
        permissions.lock().unwrap().insert(id.into(), answer);
    }
    pub fn complete(&mut self, binding: Option<&str>, id: &str) {
        if let Some(binding) = binding {
            if let Some(ids) = self.pending.get_mut(binding) {
                ids.remove(id);
                if ids.is_empty() {
                    self.pending.remove(binding);
                }
            }
        }
    }
    pub fn revoke(&mut self, binding: &str, permissions: &super::session::Permissions) {
        self.revoked.insert(binding.into());
        if let Some(ids) = self.pending.remove(binding) {
            let mut permissions = permissions.lock().unwrap();
            for id in ids {
                permissions.remove(&id);
            }
        }
    }
}

#[cfg(test)]
mod approval_tests {
    use super::*;
    #[test]
    fn binding_revocation_is_atomic_with_late_registration_and_scoped() {
        let permissions = std::sync::Arc::default();
        let mut approvals = AppApprovals::default();
        let (a, mut a_reply) = tokio::sync::oneshot::channel();
        let (b, mut b_reply) = tokio::sync::oneshot::channel();
        let (model, mut model_reply) = tokio::sync::oneshot::channel();
        approvals.register(Some("a"), "a-id", a, &permissions);
        approvals.register(Some("b"), "b-id", b, &permissions);
        approvals.register(None, "model-id", model, &permissions);
        approvals.revoke("a", &permissions);
        assert!(matches!(
            a_reply.try_recv(),
            Err(tokio::sync::oneshot::error::TryRecvError::Closed)
        ));
        assert!(permissions.lock().unwrap().remove("a-id").is_none());
        let (late, mut late_reply) = tokio::sync::oneshot::channel();
        approvals.register(Some("a"), "late", late, &permissions);
        assert!(matches!(
            late_reply.try_recv(),
            Err(tokio::sync::oneshot::error::TryRecvError::Closed)
        ));
        for id in ["b-id", "model-id"] {
            permissions
                .lock()
                .unwrap()
                .remove(id)
                .unwrap()
                .send(Some("allow".into()))
                .unwrap();
        }
        assert_eq!(b_reply.try_recv().unwrap().as_deref(), Some("allow"));
        assert_eq!(model_reply.try_recv().unwrap().as_deref(), Some("allow"));
    }
}
