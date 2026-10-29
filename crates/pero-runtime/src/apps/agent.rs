//! App research requests reference the Host's existing sessions and journal.
use super::AppName;
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
#[serde(
    tag = "operation",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum AgentRequest {
    Info,
    Start {
        request_id: String,
        prompt: String,
        agent_id: String,
    },
    Events {
        session_id: String,
        after: usize,
    },
    Cancel {
        session_id: String,
    },
}

/// Frozen request identity, persisted with session_created. It owns no lifecycle.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AppSessionBinding {
    pub app: AppName,
    pub request_id: String,
    pub agent_id: String,
    pub prompt: String,
}

impl AppSessionBinding {
    pub fn new(
        app: AppName,
        request_id: String,
        agent_id: String,
        prompt: String,
    ) -> Result<Self, String> {
        if request_id.is_empty()
            || request_id.len() > 48
            || !request_id
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_'))
        {
            return Err(
                "Research requestId must contain 1–48 letters, digits, hyphens or underscores"
                    .into(),
            );
        }
        if agent_id.is_empty()
            || agent_id.len() > 100
            || prompt.trim().is_empty()
            || prompt.len() > 128_000
            || prompt.contains('\0')
        {
            return Err("Research input is empty or exceeds the Host's 128 KB context budget; select fewer papers".into());
        }
        Ok(Self {
            app,
            request_id,
            agent_id,
            prompt,
        })
    }

    pub fn session_id(&self) -> String {
        format!("app:{}:{}", self.app.as_str(), self.request_id)
    }
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AppEventKind {
    Running,
    Text,
    NeedsInput,
    Completed,
    Cancelled,
    Failed,
}

#[derive(Serialize)]
pub struct AppEvent {
    pub kind: AppEventKind,
    pub text: String,
}

#[derive(Serialize)]
pub struct AppTranscript {
    pub events: Vec<AppEvent>,
    pub cursor: usize,
    pub status: AppEventKind,
    pub text: String,
}

impl AppTranscript {
    pub fn project(events: Vec<AppEvent>, after: usize, active: bool) -> Self {
        let mut status = AppEventKind::Running;
        let mut text = String::new();
        for event in &events {
            if matches!(event.kind, AppEventKind::Text) {
                text.push_str(&event.text);
            }
            status = match event.kind {
                AppEventKind::Text => AppEventKind::Running,
                kind => kind,
            };
        }
        if !active && matches!(status, AppEventKind::Running | AppEventKind::NeedsInput) {
            status = AppEventKind::Failed;
            if text.is_empty() {
                text = "This Host session stopped. Review its history before starting a new research request.".into();
            }
        }
        if text.is_empty() && matches!(status, AppEventKind::Failed) {
            text = events
                .last()
                .map(|event| event.text.clone())
                .unwrap_or_default();
        }
        Self {
            cursor: events.len(),
            events: events.into_iter().skip(after).collect(),
            status,
            text,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn research_transcript_projects_execution_without_restarting_it() {
        for (kinds, active, expected) in [
            (
                vec![AppEventKind::Text, AppEventKind::Completed],
                false,
                "completed",
            ),
            (vec![AppEventKind::NeedsInput], true, "needs_input"),
            (vec![AppEventKind::Cancelled], false, "cancelled"),
            (vec![AppEventKind::Text], false, "failed"),
            (vec![AppEventKind::Failed], true, "failed"),
        ] {
            let events = kinds
                .into_iter()
                .map(|kind| AppEvent {
                    kind,
                    text: "source".into(),
                })
                .collect();
            let transcript = AppTranscript::project(events, 1, active);
            assert_eq!(serde_json::to_value(transcript.status).unwrap(), expected);
        }
    }
}
