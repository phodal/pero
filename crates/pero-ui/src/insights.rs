//! Insights summaries returned by the host. The fold itself stays in
//! `session-analysis`.

use serde_json::Value;

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct TurnView {
    pub status: String,
    pub request: String,
    pub response: String,
    pub response_kind: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct Summary {
    pub turns: u64,
    pub completed: u64,
    pub failed: u64,
    pub stopped: u64,
    pub tool_calls: u64,
    pub tool_errors: u64,
    pub request: String,
    pub response: String,
    pub response_kind: String,
    pub status: String,
    pub model: String,
    pub git_branch: String,
    pub repository: String,
    pub resumed: bool,
    pub digest: String,
    pub turn_views: Vec<TurnView>,
}

impl Summary {
    pub(crate) fn from_event(data: &Value) -> Self {
        let turn_views: Vec<TurnView> = data["turns"]
            .as_array()
            .map(|turns| {
                turns
                    .iter()
                    .map(|turn| TurnView {
                        status: turn["status"].as_str().unwrap_or("unknown").to_string(),
                        request: turn["request"].as_str().unwrap_or("").to_string(),
                        response: turn["response"].as_str().unwrap_or("").to_string(),
                        response_kind: turn["response_kind"].as_str().unwrap_or("unknown").to_string(),
                    })
                    .collect()
            })
            .unwrap_or_default();
        Self {
            turns: data["turn_count"]
                .as_u64()
                .or_else(|| data["turns"].as_u64())
                .unwrap_or(turn_views.len() as u64),
            completed: data["completed"].as_u64().unwrap_or(0),
            failed: data["failed"].as_u64().unwrap_or(0),
            stopped: data["stopped"].as_u64().unwrap_or(0),
            tool_calls: data["tool_calls"].as_u64().unwrap_or(0),
            tool_errors: data["tool_errors"].as_u64().unwrap_or(0),
            request: data["request"].as_str().unwrap_or("").to_string(),
            response: data["response"].as_str().unwrap_or("").to_string(),
            response_kind: data["response_kind"].as_str().unwrap_or("unknown").to_string(),
            status: data["status"].as_str().unwrap_or("unknown").to_string(),
            model: data["model"].as_str().unwrap_or("").to_string(),
            git_branch: data["git_branch"].as_str().unwrap_or("").to_string(),
            repository: data["repository"].as_str().unwrap_or("").to_string(),
            resumed: data["resumed"].as_bool().unwrap_or(false),
            digest: data["source"]["digest"].as_str().unwrap_or("").to_string(),
            turn_views,
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
            "turn_count": 2, "failed": 1, "stopped": 1, "tool_calls": 1, "tool_errors": 1,
            "request": "Stop here", "response": "", "response_kind": "unknown", "status": "stopped",
            "model": "deepseek-v4", "git_branch": "main", "repository": "github.com/org/pero",
            "resumed": false,
            "source": {"digest": "sha256:abc"},
            "turns": [
                {"status": "failed", "request": "Fix the parser", "response": "Parser updated", "response_kind": "final"},
                {"status": "stopped", "request": "Stop here", "response": "", "response_kind": "unknown"}
            ]
        }));
        assert_eq!(summary.turns, 2);
        assert_eq!(summary.turn_views.len(), 2);
        assert_eq!(summary.turn_views[0].request, "Fix the parser");
        assert_eq!(summary.digest, "sha256:abc");
        assert!(!summary.journal_empty());
        assert!(Summary::from_event(&json!({})).journal_empty());
    }
}
