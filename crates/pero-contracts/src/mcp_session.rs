//! Identity for operations on an existing Agent-owned MCP connection.
//! This never grants permission to open another connection or change configuration.
use crate::mcp_runtime::{McpRuntimeSession, McpRuntimeStatus};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct McpSessionTarget {
    pub thread_id: String,
    pub incarnation: u64,
    pub revision: u64,
    pub server: Option<String>,
    pub generation: Option<u64>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum McpSessionError {
    Invalid,
    Unavailable,
    Stale,
    Unsupported,
    Denied,
}

impl McpSessionTarget {
    /// Resolves the real ACP session only from the Host's current live snapshot.
    pub fn admit<'a>(
        &self,
        snapshot: &'a McpRuntimeSession,
        negotiated: bool,
    ) -> Result<&'a str, McpSessionError> {
        if !negotiated || !snapshot.observable {
            return Err(McpSessionError::Unsupported);
        }
        if snapshot.closed {
            return Err(McpSessionError::Unavailable);
        }
        if self.thread_id != snapshot.thread_id
            || self.incarnation != snapshot.incarnation
            || self.revision != snapshot.revision
        {
            return Err(McpSessionError::Stale);
        }
        let session = snapshot
            .session_id
            .as_deref()
            .ok_or(McpSessionError::Unavailable)?;
        if let Some(name) = &self.server {
            let server = snapshot
                .servers
                .iter()
                .find(|server| &server.server == name)
                .ok_or(McpSessionError::Denied)?;
            if Some(server.generation) != self.generation || self.generation == Some(0) {
                return Err(McpSessionError::Stale);
            }
            if server.status != McpRuntimeStatus::Connected {
                return Err(McpSessionError::Unavailable);
            }
        }
        Ok(session)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn requests_are_bound_to_the_current_live_connection() {
        let mut snapshot =
            McpRuntimeSession::new("agent".into(), "thread".into(), 3, 7, vec!["docs".into()]);
        snapshot.observable = true;
        snapshot.session_id = Some("actual-session".into());
        snapshot.servers[0].generation = 2;
        snapshot.servers[0].status = McpRuntimeStatus::Connected;
        let target = McpSessionTarget {
            thread_id: "thread".into(),
            incarnation: 3,
            revision: 7,
            server: Some("docs".into()),
            generation: Some(2),
        };
        assert_eq!(target.admit(&snapshot, true), Ok("actual-session"));
        assert_eq!(
            target.admit(&snapshot, false),
            Err(McpSessionError::Unsupported)
        );
        for changed in [
            McpSessionTarget {
                thread_id: "other".into(),
                ..target.clone()
            },
            McpSessionTarget {
                incarnation: 2,
                ..target.clone()
            },
            McpSessionTarget {
                revision: 6,
                ..target.clone()
            },
            McpSessionTarget {
                generation: Some(1),
                ..target.clone()
            },
        ] {
            assert_eq!(changed.admit(&snapshot, true), Err(McpSessionError::Stale));
        }
        assert_eq!(
            McpSessionTarget {
                server: Some("operator".into()),
                ..target.clone()
            }
            .admit(&snapshot, true),
            Err(McpSessionError::Denied)
        );
        snapshot.servers[0].status = McpRuntimeStatus::Disconnected;
        assert_eq!(
            target.admit(&snapshot, true),
            Err(McpSessionError::Unavailable)
        );
        snapshot.close();
        assert_eq!(
            target.admit(&snapshot, true),
            Err(McpSessionError::Unavailable)
        );
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum McpSessionAction {
    List,
    Resources,
    Templates,
    Read,
    Prepare,
    Adopt,
    Tool,
    Resource,
    Close,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct McpSessionRequest {
    pub method: String,
    pub request_id: String,
    pub thread_id: String,
    pub incarnation: u64,
    pub revision: u64,
    pub action: McpSessionAction,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub server: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub generation: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub uri: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cursor: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub arguments: Option<serde_json::Map<String, serde_json::Value>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub binding: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_call: Option<String>,
}

impl McpSessionRequest {
    pub fn validate(&self) -> Result<(), McpSessionError> {
        let bounded = |text: &str, max| {
            !text.is_empty() && text.len() <= max && !text.chars().any(char::is_control)
        };
        let connection = matches!(
            self.action,
            McpSessionAction::Resources
                | McpSessionAction::Templates
                | McpSessionAction::Read
                | McpSessionAction::Prepare
                | McpSessionAction::Adopt
        );
        let binding = matches!(
            self.action,
            McpSessionAction::Tool | McpSessionAction::Resource | McpSessionAction::Close
        );
        let tool = matches!(
            self.action,
            McpSessionAction::Tool | McpSessionAction::Prepare
        );
        let read = matches!(
            self.action,
            McpSessionAction::Read | McpSessionAction::Resource
        );
        let list = matches!(
            self.action,
            McpSessionAction::Resources | McpSessionAction::Templates
        );
        if self.method != "mcp.session"
            || !bounded(&self.request_id, 128)
            || !bounded(&self.thread_id, 128)
            || self.incarnation == 0
            || self.incarnation > 9_007_199_254_740_991
            || self.revision > 9_007_199_254_740_991
            || connection != self.server.is_some()
            || connection != self.generation.is_some()
            || self.server.as_ref().is_some_and(|s| !bounded(s, 128))
            || self
                .generation
                .is_some_and(|g| g == 0 || g > 9_007_199_254_740_991)
            || matches!(self.action, McpSessionAction::Adopt) != self.tool_call.is_some()
            || self.tool_call.as_ref().is_some_and(|s| !bounded(s, 256))
            || binding != self.binding.is_some()
            || self.binding.as_ref().is_some_and(|s| !bounded(s, 256))
            || tool != self.name.is_some()
            || self.name.as_ref().is_some_and(|s| !bounded(s, 128))
            || read != self.uri.is_some()
            || self.uri.as_ref().is_some_and(|s| !bounded(s, 4096))
            || (!matches!(self.action, McpSessionAction::Tool) && self.arguments.is_some())
            || (!list && self.cursor.is_some())
            || self.cursor.as_ref().is_some_and(|s| !bounded(s, 4096))
            || serde_json::to_vec(&self.arguments).map_or(true, |v| v.len() > 1_048_576)
        {
            return Err(McpSessionError::Invalid);
        }
        Ok(())
    }
    pub fn target(&self) -> McpSessionTarget {
        McpSessionTarget {
            thread_id: self.thread_id.clone(),
            incarnation: self.incarnation,
            revision: self.revision,
            server: self.server.clone(),
            generation: self.generation,
        }
    }
    pub fn acp_params(&self, session_id: &str) -> serde_json::Value {
        let mut value = serde_json::to_value(self).expect("typed session request");
        let object = value.as_object_mut().unwrap();
        for key in [
            "method",
            "request_id",
            "thread_id",
            "incarnation",
            "revision",
        ] {
            object.remove(key);
        }
        object.insert("sessionId".into(), session_id.into());
        value
    }
}

#[cfg(test)]
mod request_tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn operation_shapes_and_acp_identity_are_explicit() {
        let base = json!({"method":"mcp.session","request_id":"request","thread_id":"thread","incarnation":1,"revision":2,"action":"list"});
        for (action, extra) in [
            ("list", json!({})),
            ("resources", json!({"server":"docs","generation":3})),
            (
                "templates",
                json!({"server":"docs","generation":3,"cursor":"next"}),
            ),
            (
                "read",
                json!({"server":"docs","generation":3,"uri":"docs://one"}),
            ),
            (
                "prepare",
                json!({"server":"docs","generation":3,"name":"view"}),
            ),
            (
                "tool",
                json!({"binding":"opaque","name":"refresh","arguments":{}}),
            ),
            ("adopt", json!({"server":"docs","generation":3,"tool_call":"original-call"})),
            ("resource", json!({"binding":"opaque","uri":"ui://view"})),
            ("close", json!({"binding":"opaque"})),
        ] {
            let mut value = base.clone();
            value["action"] = action.into();
            value
                .as_object_mut()
                .unwrap()
                .extend(extra.as_object().unwrap().clone());
            let request: McpSessionRequest = serde_json::from_value(value).unwrap();
            assert!(request.validate().is_ok(), "{action}");
            let wire = request.acp_params("host-owned-session");
            assert_eq!(wire["sessionId"], "host-owned-session");
            for key in [
                "thread_id",
                "incarnation",
                "revision",
                "method",
                "request_id",
            ] {
                assert!(wire.get(key).is_none());
            }
        }
        for extra in [
            json!({"action":"prepare"}),
            json!({"action":"prepare","server":"docs","generation":3,"name":"view","arguments":{}}),
            json!({"action":"read","uri":"x"}),
            json!({"binding":"x"}),
            json!({"server":"docs","generation":1}),
            json!({"arguments":{}}),
            json!({"incarnation":0}),
            json!({"cursor":"x"}),
        ] {
            let mut value = base.clone();
            value
                .as_object_mut()
                .unwrap()
                .extend(extra.as_object().unwrap().clone());
            let request: McpSessionRequest = serde_json::from_value(value).unwrap();
            assert_eq!(request.validate(), Err(McpSessionError::Invalid));
        }
        let mut unsafe_open = base.clone();
        unsafe_open["action"] = "open".into();
        assert!(serde_json::from_value::<McpSessionRequest>(unsafe_open).is_err());
        let mut forged = base;
        forged["sessionId"] = "another-session".into();
        assert!(serde_json::from_value::<McpSessionRequest>(forged).is_err());
    }
}
/// A view message uses the ordinary Host prompt owner, after live session admission.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct McpMessageRequest {
    pub method: String,
    pub request_id: String,
    pub thread_id: String,
    pub incarnation: u64,
    pub revision: u64,
    pub text: String,
}
impl McpMessageRequest {
    pub fn validate(&self) -> Result<McpSessionTarget, McpSessionError> {
        if self.method != "mcp.message"
            || self.request_id.is_empty()
            || self.request_id.len() > 128
            || self.thread_id.is_empty()
            || self.thread_id.len() > 128
            || self.incarnation == 0
            || self.text.trim().is_empty()
            || self.text.len() > 64_000
            || crate::context::validate_prompt_text(&self.text).is_err()
        {
            return Err(McpSessionError::Invalid);
        }
        Ok(McpSessionTarget {
            thread_id: self.thread_id.clone(),
            incarnation: self.incarnation,
            revision: self.revision,
            server: None,
            generation: None,
        })
    }
}
