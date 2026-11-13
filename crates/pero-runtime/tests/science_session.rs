//! This fixture proves the existing ACP carrier remains duplex during a turn.
//! Real Python/R kernel behavior is exercised in harness scienceenv tests.
use pero_contracts::HostEvent;
use pero_runtime::acp::{self, ScienceRequest, SessionCommand};
use serde_json::json;
use std::{
    sync::mpsc,
    time::{Duration, Instant},
};

fn until(events: &mpsc::Receiver<HostEvent>, kind: &str) -> HostEvent {
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let event = events
            .recv_timeout(deadline.saturating_duration_since(Instant::now()))
            .unwrap();
        if event.kind == kind {
            return event;
        }
        assert_ne!(event.kind, "session_error", "{}", event.text);
    }
}

#[test]
fn science_requests_target_the_bound_agent_and_remain_available_during_a_turn() {
    let directory =
        std::env::temp_dir().join(format!("pero-science-carrier-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&directory).unwrap();
    let fixture = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/runtime/lifecycle-agent.mjs");
    for supported in [true, false] {
        let config=serde_json::from_value(json!({"id":"fixture","name":"Science transport","command":"node","args":[fixture],"env":{"PERO_FIXTURE_SCENARIO":if supported {"science"} else {""}}})).unwrap();
        let (events, rx) = mpsc::channel();
        let session = acp::start(config, directory.clone(), "app-thread".into(), events);
        until(&rx, "session_ready");
        session
            .tx
            .send(SessionCommand::Prompt("wait".into()))
            .unwrap();
        until(&rx, "turn_started");
        let (reply, replies) = mpsc::channel();
        session
            .tx
            .send(SessionCommand::Science(ScienceRequest {
                request_id: "kernel-read".into(),
                thread_id: "app-thread".into(),
                command: json!({"action":"status","language":"python","code":""}),
                reply,
            }))
            .unwrap();
        let result = replies.recv_timeout(Duration::from_secs(10)).unwrap();
        assert_eq!(result.kind, "apps_result");
        assert_eq!(result.request_id.as_deref(), Some("kernel-read"));
        assert_eq!(result.thread_id.as_deref(), Some("app-thread"));
        assert_eq!(result.data["ok"], supported);
        if supported {
            assert_eq!(
                result.data["value"],
                json!({"session":"fixture-session","command":{"action":"status","language":"python","code":""},"duringTurn":true})
            );
        } else {
            assert!(
                result.data["error"]
                    .as_str()
                    .unwrap()
                    .contains("does not expose")
            );
        }
        session.tx.send(SessionCommand::Cancel).unwrap();
        until(&rx, "turn_finished");
        session.tx.send(SessionCommand::Close).unwrap();
        until(&rx, "session_closed");
    }
    std::fs::remove_dir_all(directory).unwrap();
}
