//! Complete conversation replay, compacting only adjacent plain text deltas.
use crate::HostEvent;
use serde::Deserialize;
use std::collections::HashSet;

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
}
