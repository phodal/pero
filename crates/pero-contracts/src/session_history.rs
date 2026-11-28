//! Complete conversation replay, compacting only adjacent plain text deltas.
use crate::HostEvent;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

#[derive(Clone, Copy, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SessionHistoryStatus {
    pub read_failed: bool,
    pub malformed_records: u32,
    pub save_failure: Option<SessionHistorySaveFailure>,
}

impl SessionHistoryStatus {
    pub fn incomplete(&self) -> bool {
        self.read_failed || self.malformed_records > 0
    }

    pub fn degraded(&self) -> bool {
        self.incomplete() || self.save_failure.is_some()
    }
}

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionHistorySaveFailure {
    Open,
    Write,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionReplayMode {
    Catalog,
}

#[derive(Deserialize, Serialize)]
pub struct SessionReplay {
    pub events: Vec<HostEvent>,
    pub active: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub catalog: Option<Vec<DeferredThread>>,
}

#[derive(Deserialize, Serialize)]
pub struct DeferredThread {
    pub thread_id: String,
    pub has_messages: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt_title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reported_title: Option<String>,
}

#[derive(Deserialize, Serialize)]
pub struct ThreadHistory {
    pub events: Vec<HostEvent>,
    pub active: bool,
    /// The owning Host, not the renderer, interprets the recorded workspace path.
    #[serde(default)]
    pub reconnectable: bool,
}

/// Identity saved by the Host when an ordinary conversation was created.
#[derive(Deserialize)]
pub struct OrdinarySessionOrigin {
    pub agent: String,
    pub workspace: std::path::PathBuf,
}

impl OrdinarySessionOrigin {
    pub fn read(data: &serde_json::Value) -> Option<Self> {
        if ["scope", "projectAgent", "appBinding", "appPlugin", "agentPlugins", "skillSelections", "automation"]
            .iter().any(|key| !data[*key].is_null())
        {
            return None;
        }
        let origin: Self = serde_json::from_value(data.clone()).ok()?;
        (origin.workspace.is_absolute() && !origin.agent.is_empty()).then_some(origin)
    }
}

/// Acknowledged, load-capable ACP identity. Older built-in sessions predate
/// the capability receipt; the built-in runtime still negotiates load on launch.
pub fn ordinary_reconnect_id<'a>(agent: &str, data: &'a serde_json::Value) -> Option<&'a str> {
    if !(data["peroQuietLoad"].as_bool() == Some(true)
        || (data.get("peroQuietLoad").is_none() && agent == "pero"))
    {
        return None;
    }
    data["sessionId"].as_str().filter(|id| !id.is_empty())
}

/// These events are folded into an in-memory replay, including live requests
/// that must never be written to disk.
pub fn recorded_kind(kind: &str) -> bool {
    matches!(
        kind,
        "app_agent_attempt" | "app_agent_cancel" | "session_created" | "user_message" | "acp_prompt_receipt"
            | "session_update" | "session_usage" | "session_ready" | "model_changed"
            | "configuration_changed" | "turn_started" | "turn_finished" | "workspace_changes"
            | "session_error" | "session_closed" | "session_deleted" | "permission"
            | "permission_resolved" | "user_questions" | "user_questions_resolved"
            | "user_questions_error" | "session_auth_required" | "session_auth_error"
            | "session_authenticated"
    )
}

pub fn prompt_title(text: &str) -> String {
    text.lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or_default()
        .split_whitespace()
        .flat_map(|word| std::iter::once(' ').chain(word.chars()))
        .skip(1)
        .take(24)
        .collect()
}

#[derive(Default)]
pub struct SessionHistory {
    events: Vec<HostEvent>,
    deleted: HashSet<String>,
    last_lane: Option<TextLane>,
}

#[derive(Clone, Copy, PartialEq, Eq, Deserialize)]
enum TextLane {
    #[serde(rename = "agent_message_chunk")]
    Message,
    #[serde(rename = "agent_thought_chunk")]
    Thought,
}
#[derive(Deserialize)]
enum TextKind { #[serde(rename = "text")] Text }
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct TextContent {
    #[serde(rename = "type")]
    _kind: TextKind,
    text: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct TextChunk {
    #[serde(rename = "sessionUpdate")]
    lane: TextLane,
    content: TextContent,
}

impl SessionHistory {
    pub fn record(&mut self, event: HostEvent) {
        if event.kind == "session_deleted" {
            if let Some(id) = event.thread_id {
                self.events.retain(|event| event.thread_id.as_ref() != Some(&id));
                self.deleted.insert(id);
            }
            self.last_lane = None;
            return;
        }
        if event.thread_id.as_ref().is_some_and(|id| self.deleted.contains(id)) { return; }
        let chunk = if event.kind == "session_update" {
            serde_json::from_value::<TextChunk>(event.data.clone()).ok()
        } else { None };
        if let (Some(chunk), Some(previous)) = (&chunk, self.events.last_mut()) {
            if self.last_lane == Some(chunk.lane) && event.thread_id.is_some()
                && previous.thread_id == event.thread_id && previous.version == event.version
                && previous.request_id == event.request_id && previous.text == event.text
                && previous.message_key == event.message_key {
                let serde_json::Value::String(text) = &mut previous.data["content"]["text"] else { unreachable!("validated replay text") };
                text.push_str(&chunk.content.text);
                return;
            }
        }
        self.last_lane = chunk.map(|chunk| chunk.lane);
        self.events.push(event);
    }

    pub fn events(&self) -> &[HostEvent] { &self.events }

    pub fn replay(&self, active: Vec<String>, mode: Option<SessionReplayMode>) -> SessionReplay {
        if mode.is_none() {
            return SessionReplay { events: self.events.clone(), active, catalog: None };
        }
        let live: HashSet<_> = active.iter().map(String::as_str).collect();
        let mut events = Vec::new();
        let mut catalog = Vec::<DeferredThread>::new();
        let mut deferred = HashMap::new();
        let mut errors = HashMap::new();
        for event in &self.events {
            let Some(thread) = event.thread_id.as_deref() else { continue; };
            if live.contains(thread) {
                events.push(event.clone());
                continue;
            }
            if event.kind == "session_created" {
                deferred.entry(thread).or_insert_with(|| {
                    let index = catalog.len();
                    catalog.push(DeferredThread {
                        thread_id: thread.into(),
                        has_messages: false,
                        prompt_title: None,
                        reported_title: None,
                    });
                    index
                });
                events.push(event.clone());
            }
            let Some(summary) = deferred.get(thread).map(|index| &mut catalog[*index]) else { continue; };
            match (event.kind.as_str(), event.data["sessionUpdate"].as_str()) {
                ("user_message", _) => {
                    if !summary.has_messages {
                        summary.prompt_title = Some(prompt_title(&event.text));
                    }
                    summary.has_messages = true;
                }
                ("session_update", Some("agent_message_chunk" | "agent_thought_chunk"))
                    if event.data["content"]["text"].as_str().is_some_and(|text| !text.is_empty()) =>
                {
                    summary.has_messages = true;
                }
                ("session_update", Some("session_info_update")) if event.data.get("title").is_some() => {
                    summary.reported_title = event.data["title"].as_str().map(str::to_owned);
                }
                ("session_error" | "session_auth_required" | "session_auth_error", _) => {
                    errors.insert(thread, event);
                }
                ("session_authenticated", _) => {
                    errors.remove(thread);
                }
                _ => {}
            }
        }
        events.extend(catalog.iter().filter_map(|entry| errors.get(entry.thread_id.as_str()).copied().cloned()));
        SessionReplay { events, active, catalog: Some(catalog) }
    }

    pub fn reconnect_target(&self, thread: &str) -> Option<(OrdinarySessionOrigin, String)> {
        let mut entries = self.events.iter().rev().filter(|event| event.thread_id.as_deref() == Some(thread));
        // Only readiness following the most recent creation belongs to that origin.
        let ready = entries.by_ref().find(|event| matches!(event.kind.as_str(), "session_ready" | "session_created"))?;
        if ready.kind != "session_ready" { return None; }
        let created = entries.find(|event| event.kind == "session_created")?;
        let origin = OrdinarySessionOrigin::read(&created.data)?;
        let remote = ordinary_reconnect_id(&origin.agent, &ready.data)?.to_owned();
        Some((origin, remote))
    }

    pub fn thread(&self, thread: &str, active: bool) -> ThreadHistory {
        let events = self.events.iter()
            .filter(|event| event.thread_id.as_deref() == Some(thread))
            .cloned()
            .collect();
        ThreadHistory { events, active, reconnectable: !active && self.reconnect_target(thread).is_some() }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn event(kind: &str, thread: &str, data: serde_json::Value) -> HostEvent {
        let mut event = HostEvent::new(kind, None, String::new());
        event.thread_id = Some(thread.into());
        event.data = data;
        event
    }

    #[test]
    fn reconnect_reads_only_the_latest_acknowledged_ordinary_origin() {
        let workspace = if cfg!(windows) {r"C:\original"} else {"/original"};
        let created = json!({"agent":"fixture","workspace":workspace});
        let ready = json!({"sessionId":"acp-original","peroQuietLoad":true});
        let mut journal = SessionHistory::default();
        journal.record(event("session_ready", "other", ready.clone()));
        journal.record(event("session_created", "thread", created.clone()));
        assert!(!journal.thread("thread", false).reconnectable);
        assert!(journal.reconnect_target("thread").is_none());
        journal.record(event("session_ready", "thread", ready.clone()));
        journal.record(event("session_closed", "thread", json!({})));
        assert!(journal.thread("thread", false).reconnectable);
        assert!(!journal.thread("thread", true).reconnectable);
        assert!(!journal.thread("missing", false).reconnectable);
        let (origin, id) = journal.reconnect_target("thread").expect("ordinary reconnect");
        assert_eq!((origin.agent.as_str(), origin.workspace.to_str(), id.as_str()), ("fixture", Some(workspace), "acp-original"));

        journal.record(event("session_created", "thread", created.clone()));
        assert!(journal.reconnect_target("thread").is_none(), "older ACP identity crossed a new origin");
        journal.record(event("session_ready", "thread", ready.clone()));
        journal.record(event("session_deleted", "thread", json!({})));
        assert!(journal.reconnect_target("thread").is_none());
        for key in ["scope", "projectAgent", "appBinding", "appPlugin", "agentPlugins", "skillSelections", "automation"] {
            let mut origin = created.clone();
            origin[key] = json!(true);
            let mut history = SessionHistory::default();
            history.record(event("session_created", "scoped", origin));
            history.record(event("session_ready", "scoped", ready.clone()));
            assert!(history.reconnect_target("scoped").is_none(), "{key} is not ordinary chat");
            assert!(!history.thread("scoped", false).reconnectable);
        }
        assert!(ordinary_reconnect_id("fixture", &json!({"sessionId":"id"})).is_none());
        assert_eq!(ordinary_reconnect_id("pero", &json!({"sessionId":"legacy"})), Some("legacy"));
        assert!(ordinary_reconnect_id("pero", &json!({"sessionId":"legacy","peroQuietLoad":false})).is_none());
        assert!(serde_json::from_value::<crate::HostCommand>(json!({
            "action":"reconnect_session","thread_id":"thread","workspace":"/other","agent_id":"foreign"
        })).is_err());
    }

    fn chunk(thread: &str, lane: &str, text: &str) -> HostEvent {
        event("session_update", thread, json!({"sessionUpdate":lane,"content":{"type":"text","text":text}}))
    }

    #[test]
    fn replay_preserves_conversations_and_stream_boundaries() {
        let text = || chunk("a", "agent_message_chunk", "中文🙂");
        for (boundary, merge) in [
            (text(), true),
            (chunk("a", "agent_thought_chunk", "reason"), false),
            (chunk("b", "agent_message_chunk", "other"), false),
            (event("turn_finished", "a", json!({})), false),
            (event("session_update", "a", json!({"sessionUpdate":"tool_call","toolCallId":"read","status":"completed"})), false),
            (event("session_update", "a", json!({"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"annotated","_meta":{"source":"evidence"}}})), false),
        ] {
            let mut history = SessionHistory::default();
            history.record(event("session_created", "a", json!({"agent":"pero","scope":{"app":"paper-agent","panel":"main"}})));
            history.record(event("user_message", "a", json!({"contexts":[{"id":"frozen-reference"}]})));
            for _ in 0..6000 { history.record(text()); }
            history.record(boundary);
            history.record(text());
            assert_eq!(history.events.len(), if merge { 3 } else { 5 });
            assert_eq!(history.events[0].data["scope"]["app"], "paper-agent");
            assert_eq!(history.events[1].data["contexts"][0]["id"], "frozen-reference");
            assert_eq!(history.events[2].data["content"]["text"].as_str().unwrap(), "中文🙂".repeat(if merge { 6002 } else { 6000 }));
        }
    }

    #[test]
    fn deletion_excludes_prior_and_late_events_without_removing_other_threads() {
        let mut history = SessionHistory::default();
        for e in [event("session_created", "keep", json!({})), event("user_message", "gone", json!({})),
            event("session_deleted", "gone", json!({})), event("session_closed", "gone", json!({})),
            HostEvent::new("workspace", None, "/tmp".into())] { history.record(e); }
        assert_eq!(history.events.len(), 2);
        assert_eq!(history.events[0].thread_id.as_deref(), Some("keep"));
        assert_eq!(history.events[1].kind, "workspace");
    }

    #[test]
    fn catalog_preserves_origins_titles_and_live_history_and_defers_closed_bodies() {
        let mut history = SessionHistory::default();
        let archived = "已完成的对话";
        let scope = json!({"app":"paper-agent","panel":"main"});
        history.record(event("session_created", archived, json!({"agent":"pero","scope":scope})));
        history.record(event("session_created", "active", json!({"agent":"pero"})));
        let mut user = event("user_message", archived, json!({"contexts":[{"id":"original-reference"}]}));
        user.text = "\n  a    preview of the original user request\nnot a title".into();
        history.record(user);
        history.record(chunk("active", "agent_message_chunk", "live"));
        history.record(chunk(archived, "agent_message_chunk", "original "));
        history.record(chunk(archived, "agent_message_chunk", "result"));
        history.record(event("session_update", archived, json!({"sessionUpdate":"session_info_update","title":"Agent title"})));
        history.record(event("session_error", archived, json!({})));
        history.record(event("session_closed", archived, json!({})));
        let active = vec!["active".into()];
        let eager = history.replay(active.clone(), None);
        let catalog = history.replay(active, Some(SessionReplayMode::Catalog));
        let deferred = catalog.catalog.unwrap();
        assert_eq!(deferred.len(), 1);
        assert_eq!(deferred[0].thread_id, archived);
        assert!(deferred[0].has_messages);
        assert_eq!(deferred[0].prompt_title.as_deref(), Some("a preview of the origina"));
        assert_eq!(deferred[0].reported_title.as_deref(), Some("Agent title"));
        assert_eq!(catalog.events[0].data["scope"], scope);
        assert_eq!(catalog.events[2].data["content"]["text"], "live");
        assert_eq!(catalog.events[3].kind, "session_error");
        assert_eq!(catalog.events.len(), 4);
        let body = history.thread(archived, false);
        assert!(!body.active);
        assert_eq!(body.events[1].data["contexts"][0]["id"], "original-reference");
        assert_eq!(body.events[2].data["content"]["text"], "original result");
        let eager_body = eager.events.iter().filter(|entry| entry.thread_id.as_deref() == Some(archived))
            .map(|entry| serde_json::to_value(entry).unwrap()).collect::<Vec<_>>();
        assert_eq!(serde_json::to_value(body.events).unwrap(), json!(eager_body));
    }

    #[test]
    fn on_demand_history_keeps_an_archived_mcp_app_snapshot() {
        let mut history = SessionHistory::default();
        let thread = "archived-mcp";
        history.record(event("session_created", thread, json!({"agent":"pero"})));
        history.record(event("user_message", thread, json!({})));
        history.record(event("session_update", thread, json!({"sessionUpdate":"tool_call","toolCallId":"call-1","title":"inspect","status":"in_progress","rawInput":{"label":"original"}})));
        history.record(event("session_update", thread, json!({"sessionUpdate":"tool_call_update","toolCallId":"call-1","status":"completed","locations":[{"path":"notes/source.md","line":4}],"content":[{"type":"content","content":{"type":"text","text":"ordinary saved result"}}],"_meta":{"pero.mcpApp":{"server":"Docs","generation":1,"resource_uri":"ui://docs/view","tool_call":"call-1"}}})));
        history.record(chunk(thread, "agent_message_chunk", "after"));
        history.record(event("session_closed", thread, json!({})));
        let catalog = history.replay(vec![], Some(SessionReplayMode::Catalog));
        assert!(catalog.events.iter().all(|entry| entry.data["sessionUpdate"] != "tool_call_update"));
        let body = history.thread(thread, false);
        assert!(!body.active);
        let snapshot = body.events.iter().find(|entry| entry.data["sessionUpdate"] == "tool_call_update").unwrap();
        assert_eq!(snapshot.data["content"][0]["content"]["text"], "ordinary saved result");
        assert_eq!(snapshot.data["locations"][0]["path"], "notes/source.md");
        assert_eq!(snapshot.data["_meta"]["pero.mcpApp"]["server"], "Docs");
        assert_eq!(snapshot.data["_meta"]["pero.mcpApp"]["resource_uri"], "ui://docs/view");
        assert_eq!(snapshot.data["_meta"]["pero.mcpApp"]["tool_call"], "call-1");
    }
}
