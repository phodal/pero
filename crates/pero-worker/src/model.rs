use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Run {
    pub id: String,
    pub generation: u64,
    pub instance_id: String,
    pub status: String,
    pub lease_expires_at: String,
    pub spec: Spec,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remote_execution: Option<RemoteExecution>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct RemoteExecution {
    pub session_id: String,
    pub working_directory: String,
}

// A scoped one-Run grant, never a Worker credential. Do not derive Debug.
#[derive(Clone, Deserialize, Serialize)]
pub struct RemoteGrant {
    pub session_id: String,
    pub secret: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Spec {
    pub title: String,
    pub prompt: String,
    pub workspace_key: String,
    pub agent_id: String,
    #[serde(default)]
    pub acceptance: Value,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct Event {
    pub seq: u64,
    pub kind: String,
    pub text: String,
    #[serde(default, skip_serializing_if = "Value::is_null")]
    pub data: Value,
}

impl Event {
    pub fn validate(&self) -> Result<(), String> {
        if self.kind.trim().is_empty()
            || self.kind.len() > 128
            || self.text.len() > 64000
            || serde_json::to_vec(&self.data)
                .map_err(|e| e.to_string())?
                .len()
                > 64000
            || serde_json::to_vec(self).map_err(|e| e.to_string())?.len() > 65536
        {
            return Err("Worker event exceeds protocol field or output limits".into());
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Outcome {
    pub outcome: String,
    pub summary: String,
    #[serde(default)]
    pub needs_attention: bool,
}

impl Outcome {
    pub fn new(outcome: &str, summary: impl Into<String>) -> Self {
        Self {
            outcome: outcome.into(),
            summary: summary.into(),
            needs_attention: outcome == "reconcile",
        }
    }
    pub fn blocked(summary: impl Into<String>) -> Self {
        Self {
            outcome: "failed".into(),
            summary: summary.into(),
            needs_attention: true,
        }
    }
}

/// Network recovery keeps the original operation identity; only the delay changes.
#[derive(Default)]
pub struct ReconnectBackoff {
    attempt: u32,
}
impl ReconnectBackoff {
    pub fn failed(&mut self) -> std::time::Duration {
        self.attempt = (self.attempt + 1).min(5);
        std::time::Duration::from_secs(1u64 << self.attempt)
    }
}
#[cfg(test)]
mod reconnect_tests {
    use super::*;
    #[test]
    fn outages_back_off_to_a_bounded_delay() {
        let mut backoff = ReconnectBackoff::default();
        let delays = (0..7)
            .map(|_| backoff.failed().as_secs())
            .collect::<Vec<_>>();
        assert_eq!(delays, vec![2, 4, 8, 16, 32, 32, 32]);
    }
}
