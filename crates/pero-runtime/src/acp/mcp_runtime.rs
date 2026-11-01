//! Existing ACP channel observation bridge. Never starts a connection or persists a catalog.
use pero_contracts::{mcp_runtime::{McpRuntimeObservation, McpRuntimeSession}, HostEvent};
use serde_json::{json, Value};
use std::sync::{mpsc::Sender, Arc, Mutex};

pub(super) const CAPABILITY: &str = "pero.mcpRuntime";

pub(super) struct Observations {
    pub snapshot: Arc<Mutex<McpRuntimeSession>>,
    pending: Vec<McpRuntimeObservation>,
}

impl Observations {
    pub fn new(snapshot: Arc<Mutex<McpRuntimeSession>>) -> Self { Self { snapshot, pending: vec![] } }

    pub fn receive(&mut self, value: Value, tx: &Sender<HostEvent>) {
        let Ok(observation) = serde_json::from_value::<McpRuntimeObservation>(value) else { return; };
        let mut snapshot = self.snapshot.lock().unwrap();
        if !snapshot.observable { return; }
        if snapshot.session_id.is_none() {
            // Discovery runs before session/new returns. Keep a bounded sequence
            // for admitted servers; identity is checked after the response arrives.
            if snapshot.revision != observation.revision || !snapshot.servers.iter().any(|s| s.server == observation.server) { return; }
            if self.pending.len() < 256 && observation.tools.len() <= 256 && observation.tools.iter().all(|name| name.len() <= 128) {
                self.pending.push(observation);
            }
        } else if snapshot.observe(observation) { publish(&snapshot, tx); }
    }

    pub fn bind(&mut self, session_id: String, tx: &Sender<HostEvent>) {
        let mut snapshot = self.snapshot.lock().unwrap();
        snapshot.session_id = Some(session_id);
        for observation in self.pending.drain(..) { snapshot.observe(observation); }
        publish(&snapshot, tx);
    }
}

pub(super) fn publish(snapshot: &McpRuntimeSession, tx: &Sender<HostEvent>) {
    let mut event = HostEvent::new("mcp_runtime", None, String::new());
    event.thread_id = Some(snapshot.thread_id.clone());
    event.data = json!(snapshot);
    let _ = tx.send(event);
}
