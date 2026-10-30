//! Insights summaries returned by the host. The fold itself stays in
//! `session-analysis`.

use serde_json::Value;

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct Summary {
    pub turns: u64,
    pub failed: u64,
    pub stopped: u64,
    pub tool_calls: u64,
    pub tool_errors: u64,
    pub request: String,
    pub response: String,
    pub model: String,
    pub git_branch: String,
    pub repository: String,
    pub resumed: bool,
}

impl Summary {
    pub(crate) fn from_event(data: &Value) -> Self {
        Self {
            turns: data["turns"].as_u64().unwrap_or(0),
            failed: data["failed"].as_u64().unwrap_or(0),
            stopped: data["stopped"].as_u64().unwrap_or(0),
            tool_calls: data["tool_calls"].as_u64().unwrap_or(0),
            tool_errors: data["tool_errors"].as_u64().unwrap_or(0),
            request: data["request"].as_str().unwrap_or("").to_string(),
            response: data["response"].as_str().unwrap_or("").to_string(),
            model: data["model"].as_str().unwrap_or("").to_string(),
            git_branch: data["git_branch"].as_str().unwrap_or("").to_string(),
            repository: data["repository"].as_str().unwrap_or("").to_string(),
            resumed: data["resumed"].as_bool().unwrap_or(false),
        }
    }

    pub(crate) fn journal_empty(&self) -> bool {
        self.turns == 0
            && self.tool_calls == 0
            && self.request.is_empty()
            && self.response.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn summary_reads_the_host_payload() {
        let summary = Summary::from_event(&json!({
            "turns": 2, "failed": 1, "stopped": 1, "tool_calls": 1, "tool_errors": 1,
            "request": "Stop here", "response": "", "model": "deepseek-v4",
            "git_branch": "main", "repository": "github.com/org/pero", "resumed": false
        }));
        assert_eq!(summary.turns, 2);
        assert_eq!(summary.failed, 1);
        assert_eq!(summary.stopped, 1);
        assert_eq!(summary.tool_calls, 1);
        assert!(!summary.journal_empty());
        assert!(Summary::from_event(&json!({})).journal_empty());
    }
}
