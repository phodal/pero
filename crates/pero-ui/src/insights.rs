//! Insights summaries returned by the host. The fold itself stays in
//! `session-analysis`.

use serde_json::Value;

#[derive(Clone, Debug, Default)]
pub(crate) struct Summary {
    pub turns: u64,
    pub failed: u64,
    pub tool_calls: u64,
    pub tool_errors: u64,
    pub request: String,
}

impl Summary {
    pub(crate) fn from_event(data: &Value) -> Self {
        Self {
            turns: data["turns"].as_u64().unwrap_or(0),
            failed: data["failed"].as_u64().unwrap_or(0),
            tool_calls: data["tool_calls"].as_u64().unwrap_or(0),
            tool_errors: data["tool_errors"].as_u64().unwrap_or(0),
            request: data["request"].as_str().unwrap_or("").to_string(),
        }
    }
}
