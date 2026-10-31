//! Point's App Agent protocol projected from the existing Pero Session journal.
use super::AppName;
use pero_contracts::HostEvent;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Scope { pub workspace_id: String }

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Binding {
    pub scope: Scope,
    pub request_id: String,
    pub harness_id: String,
    pub panel: String,
    pub runtime_digest: String,
    pub created_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context: Option<serde_json::Value>,
}
#[derive(Debug, Deserialize)]
#[serde(tag = "operation", rename_all = "snake_case", rename_all_fields = "camelCase", deny_unknown_fields)]
pub enum Request {
    Start { scope: Scope, request_id: String, text: String, #[serde(default)] harness_id: Option<String>, #[serde(default)] context: Option<serde_json::Value> },
    Lookup { scope: Scope, request_id: String },
    Status { scope: Scope, run_id: String },
    Events { scope: Scope, run_id: String, #[serde(default)] after: u64 },
    Cancel { scope: Scope, run_id: String },
    Retry { scope: Scope, run_id: String, request_id: String, #[serde(default)] text: Option<String> },
    Open { session_id: String },
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Attempt { pub request_id: String, pub text: String, pub attempt: u32, pub updated_at: String }
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Run {
    pub id: String, pub session_id: String, pub scope: Scope, pub status: String,
    pub attempt: u32, pub request_id: String, pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")] pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub stop_reason: Option<String>,
}
#[derive(Serialize)]
pub struct Event { pub seq: u64, #[serde(rename = "type")] pub kind: String, pub data: serde_json::Value }
#[derive(Serialize)]
pub struct Transcript { pub run: Run, pub events: Vec<Event>, pub cursor: u64 }

pub fn timestamp(seconds: u64) -> String {
    chrono::DateTime::from_timestamp(seconds as i64, 0).expect("Host time within RFC3339 range")
        .to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}
pub fn request_key(value: &str) -> Result<(), String> {
    if value.is_empty() || value.len() > 128 || !value.as_bytes()[0].is_ascii_alphanumeric()
        || !value.bytes().all(|byte| byte.is_ascii_alphanumeric() || b"._:-".contains(&byte)) {
        return Err("Point requestId must contain 1–128 letters, digits or ._:-".into());
    }
    Ok(())
}
pub fn internal_key(app: &AppName, scope: &Scope, request: &str) -> String {
    format!("{:x}", Sha256::digest(format!("{}\0{}\0{request}",app.as_str(),scope.workspace_id)))[..32].to_owned()
}
pub fn workspace_id(path: &std::path::Path) -> String {
    format!("ws_{:x}", Sha256::digest(path.as_os_str().as_encoded_bytes()))[..35].to_owned()
}
impl Run {
    pub fn active(&self) -> bool { matches!(self.status.as_str(), "running" | "cancelling" | "needs_input") }
}
impl Transcript {
    /// Cursors count the original Session journal, including events not exposed
    /// by this App API. Each source event owns two stable projection positions.
    pub fn project(id: &str, binding: &Binding, history: &[HostEvent], active: bool, after: u64) -> Self {
        let mut run = Run { id:id.into(),session_id:id.into(),scope:binding.scope.clone(),status:"running".into(),attempt:1,
            request_id:binding.request_id.clone(),updated_at:binding.created_at.clone(),error:None,stop_reason:None };
        let mut events = Vec::new();
        let mut text = String::new();
        let mut cursor = 0;
        for (index, event) in history.iter().filter(|event| event.thread_id.as_deref() == Some(id)).enumerate() {
            let seq = (index as u64 + 1) * 2;
            cursor = seq;
            if let Some(time) = event.data["pointTime"].as_str() { run.updated_at = time.into(); }
            let kind = match event.kind.as_str() {
                "session_created" => Some("agent/created"),
                "app_agent_attempt" => {
                    if let Ok(attempt) = serde_json::from_value::<Attempt>(event.data["attempt"].clone()) {
                        run.request_id=attempt.request_id; run.attempt=attempt.attempt; run.updated_at=attempt.updated_at;
                        run.status="running".into();run.error=None;run.stop_reason=None;text.clear();
                    }
                    Some("app-agent/state")
                }
                "turn_started" => { run.status="running".into();text.clear();Some("app-agent/state") }
                "app_agent_cancel" => { if run.active() { run.status="cancelling".into(); } Some("app-agent/state") }
                "session_update" if event.data["sessionUpdate"] == "agent_message_chunk" => {
                    if run.status!="cancelling" {run.status="running".into();}
                    text.push_str(event.data["content"]["text"].as_str().unwrap_or_default());None
                }
                "permission" | "session_auth_required" | "session_auth_error" => {run.status="needs_input".into();Some("app-agent/state")}
                "session_error" => {run.status="failed".into();run.error=Some(event.text.clone());Some("agent/finished")}
                "session_closed" => {if run.active(){run.status="interrupted".into();}Some("app-agent/state")}
                "turn_finished" => {
                    let reason=event.data["stopReason"].as_str().unwrap_or(&event.text).to_owned();
                    run.status=if reason.eq_ignore_ascii_case("cancelled") {"cancelled"} else if reason=="error"||run.status=="failed" {"failed"} else {"completed"}.into();
                    run.stop_reason=Some(reason);
                    if !text.is_empty() { events.push(Event{seq:seq-1,kind:"assistant/message".into(),data:serde_json::json!({"content":[{"type":"text","text":text}]})}); }
                    Some("app-agent/state")
                }
                _ => None,
            };
            if let Some(kind)=kind {events.push(Event{seq,kind:kind.into(),data:serde_json::to_value(&run).expect("Point run")});}
        }
        if !active && run.active() { run.status="interrupted".into();run.error=Some("This Pero Host Session stopped; inspect its history before explicitly retrying".into()); }
        let mut size=0;
        let events:Vec<_>=events.into_iter().filter(|event|event.seq>after).take(64).take_while(|event|{
            let bytes=serde_json::to_vec(&event).expect("Point event").len();
            let admit=size==0||size+bytes<=128*1024; if admit {size+=bytes;} admit
        }).collect();
        // Do not jump beyond a bounded response, or the next page would lose events.
        let next=events.last().map_or(cursor,|event|event.seq);
        Self{run,events,cursor:next.max(after)}
    }
}
#[cfg(test)]
#[path = "point_agent_test.rs"]
mod tests;
