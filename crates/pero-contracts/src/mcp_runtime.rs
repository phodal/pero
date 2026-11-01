//! Transient observations of an existing Agent-owned MCP connection, never configuration.
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum McpRuntimeStatus { Connecting, Connected, Disconnected, Error, Closed }

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct McpRuntimeServer {
    pub server: String,
    pub generation: u64,
    pub status: McpRuntimeStatus,
    pub tools: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct McpRuntimeSession {
    /// Host-process-local order of session handles, distinct from connection generation.
    pub incarnation: u64,
    pub agent_id: String,
    pub thread_id: String,
    pub session_id: Option<String>,
    pub revision: u64,
    pub observable: bool,
    pub servers: Vec<McpRuntimeServer>,
}

/// Admission is at the ACP boundary; no raw descriptions, schemas, transport or errors escape.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct McpRuntimeObservation {
    pub session_id: String,
    pub revision: u64,
    pub server: String,
    pub generation: u64,
    pub status: McpRuntimeStatus,
    pub tools: Vec<String>,
}

impl McpRuntimeSession {
    pub fn new(agent_id: String, thread_id: String, incarnation: u64, revision: u64, servers: Vec<String>) -> Self {
        Self { agent_id, thread_id, incarnation, session_id: None, revision, observable: false,
            servers: servers.into_iter().map(|server| McpRuntimeServer {
                server, generation: 0, status: McpRuntimeStatus::Connecting, tools: vec![],
            }).collect() }
    }

    /// An old handle may finish cleanup after a new session reuses its thread.
    pub fn can_replace(&self, current: &Self) -> bool {
        self.thread_id == current.thread_id && self.incarnation >= current.incarnation
    }

    /// Only the frozen session/revision and an admitted server can change this projection.
    pub fn observe(&mut self, observation: McpRuntimeObservation) -> bool {
        if !self.observable || self.session_id.as_deref() != Some(&observation.session_id)
            || self.revision != observation.revision || observation.generation == 0
            || observation.generation > 9_007_199_254_740_991
            || observation.tools.len() > 256
            || observation.tools.iter().any(|name| name.is_empty() || name.len() > 128 || name.chars().any(char::is_control)) {
            return false;
        }
        let Some(server) = self.servers.iter_mut().find(|s| s.server == observation.server) else { return false; };
        if server.status == McpRuntimeStatus::Closed || observation.generation < server.generation { return false; }
        // A late refresh cannot revive a disconnected generation.
        if observation.generation == server.generation
            && server.status == McpRuntimeStatus::Disconnected
            && matches!(observation.status, McpRuntimeStatus::Connected | McpRuntimeStatus::Connecting) { return false; }
        server.generation = observation.generation;
        server.status = observation.status;
        server.tools = if observation.status == McpRuntimeStatus::Connected { observation.tools } else { vec![] };
        true
    }

    pub fn close(&mut self) {
        for server in &mut self.servers { server.status = McpRuntimeStatus::Closed; server.tools.clear(); }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn replaced_session_handle_cannot_publish_over_its_successor() {
        let mut old = McpRuntimeSession::new("agent".into(), "thread".into(), 1, 7, vec![]);
        let current = McpRuntimeSession::new("agent".into(), "thread".into(), 2, 7, vec![]);
        old.close();
        assert!(!old.can_replace(&current));
        assert!(current.can_replace(&old));
    }

    #[test]
    fn observations_are_bound_to_capability_session_revision_and_generation() {
        let mut state = McpRuntimeSession::new("agent".into(), "thread".into(), 1, 7, vec!["docs".into()]);
        state.session_id = Some("session".into());
        let observation = |session: &str, revision, generation, status| McpRuntimeObservation {
            session_id: session.into(), revision, server: "docs".into(), generation, status, tools: vec!["lookup".into()],
        };
        assert!(!state.observe(observation("session", 7, 1, McpRuntimeStatus::Connected)));
        state.observable = true;
        assert!(!state.observe(observation("old", 7, 1, McpRuntimeStatus::Connected)));
        assert!(!state.observe(observation("session", 8, 1, McpRuntimeStatus::Connected)));
        assert!(state.observe(observation("session", 7, 2, McpRuntimeStatus::Connected)));
        assert!(!state.observe(observation("session", 7, 1, McpRuntimeStatus::Disconnected)));
        assert_eq!(state.servers[0].tools, ["lookup"]);
        assert!(state.observe(observation("session", 7, 2, McpRuntimeStatus::Disconnected)));
        assert!(!state.observe(observation("session", 7, 2, McpRuntimeStatus::Connected)));
        assert!(state.observe(observation("session", 7, 3, McpRuntimeStatus::Connected)));
        state.close();
        assert!(!state.observe(observation("session", 7, 4, McpRuntimeStatus::Connected)));
        assert!(state.servers[0].tools.is_empty());
    }
}
