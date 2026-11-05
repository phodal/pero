use super::*;
use crate::acp::{self, AgentConfig, SessionCommand, SessionHandle};
use pero_contracts::user_questions::{QuestionAnswer, QuestionReply};
use std::{
    collections::BTreeMap,
    path::PathBuf,
    sync::mpsc,
    time::{Duration, Instant},
};

struct Fixture {
    handle: SessionHandle,
    events: mpsc::Receiver<HostEvent>,
    workspace: PathBuf,
}

impl Fixture {
    fn new(interactive: bool, scenario: &str) -> Self {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
        let workspace =
            std::env::temp_dir().join(format!("pero-questions-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&workspace).unwrap();
        let config = AgentConfig {
            managed_mcp: None,
            required_mcp_servers: Default::default(),
            id: "questions-fixture".into(),
            name: "Question fixture".into(),
            command: "node".into(),
            args: vec![
                root.join("tests/runtime/questions-agent.mjs")
                    .to_string_lossy()
                    .into(),
            ],
            env: BTreeMap::from([("PERO_QUESTIONS_SCENARIO".into(), scenario.into())]),
            model: None,
            session_instructions: String::new(),
            mcp_servers: vec![],
        };
        let (tx, events) = mpsc::channel();
        let handle = if interactive {
            acp::start_interactive(
                config,
                workspace.clone(),
                "questions-thread".into(),
                tx,
                None,
                None,
            )
        } else {
            acp::start(config, workspace.clone(), "questions-thread".into(), tx)
        };
        let fixture = Self {
            handle,
            events,
            workspace,
        };
        assert!(
            fixture
                .collect_until("session_ready")
                .iter()
                .all(|event| event.kind != "user_questions")
        );
        fixture
    }

    fn until(&self, kind: &str) -> HostEvent {
        self.collect_until(kind).pop().unwrap()
    }

    fn collect_until(&self, kind: &str) -> Vec<HostEvent> {
        let deadline = Instant::now() + Duration::from_secs(6);
        let mut result = vec![];
        loop {
            let event = self
                .events
                .recv_timeout(deadline.saturating_duration_since(Instant::now()))
                .expect("question ACP event deadline");
            let done = event.kind == kind;
            if kind != "session_closed" {
                assert_ne!(event.kind, "session_error", "{}", event.text);
            }
            result.push(event);
            if done {
                return result;
            }
        }
    }

    fn prompt(&self, text: &str) {
        self.handle
            .tx
            .send(SessionCommand::Prompt(text.into()))
            .unwrap();
    }
    fn close(&self) {
        let _ = self.handle.tx.send(SessionCommand::Close);
        self.until("session_closed");
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = self.handle.tx.send(SessionCommand::Close);
        let _ = std::fs::remove_dir_all(&self.workspace);
    }
}

fn answer() -> QuestionReply {
    QuestionReply::Answered {
        answers: vec![
            QuestionAnswer {
                question_index: 0,
                selected_options: vec![1],
                text: String::new(),
            },
            QuestionAnswer {
                question_index: 1,
                selected_options: vec![0, 1],
                text: "Build".into(),
            },
        ],
    }
}

fn wire_update(event: &HostEvent) -> Value {
    serde_json::from_str(event.data["content"]["text"].as_str().unwrap()).unwrap()
}

#[test]
fn interactive_answers_are_validated_retryable_and_returned_over_the_real_rpc() {
    let fixture = Fixture::new(true, "");
    fixture.prompt("ask");
    let event = fixture.until("user_questions");
    let pending: PendingQuestions = serde_json::from_value(event.data).unwrap();
    assert_eq!(pending.request.session_id, "question-session");
    assert_eq!(pending.request.tool_call_id, "question-call");
    assert_eq!(pending.request.questions.len(), 2);
    assert!(
        fixture
            .handle
            .user_questions
            .finish(
                &pending.request_id,
                QuestionReply::Answered { answers: vec![] }
            )
            .is_err()
    );
    fixture
        .handle
        .user_questions
        .finish(&pending.request_id, answer())
        .unwrap();
    let resolved = fixture.until("user_questions_resolved");
    assert_eq!(
        resolved.data,
        json!({"request_id":pending.request_id,"toolCallId":"question-call"})
    );
    let wire = wire_update(&fixture.until("session_update"));
    assert_eq!(wire["result"], serde_json::to_value(answer()).unwrap());
    assert_eq!(wire["advertised"], true);
    fixture.until("turn_finished");
    assert!(
        fixture
            .handle
            .user_questions
            .finish(&pending.request_id, answer())
            .is_err()
    );
    fixture.close();
}

#[test]
fn capabilities_and_session_identity_gate_questions() {
    for (interactive, scenario, prompt, code) in [
        (false, "", "ask", -32601),
        (true, "unnegotiated", "ask", -32601),
        (true, "wrong-revision", "ask", -32601),
        (true, "", "wrong-session", -32602),
    ] {
        let fixture = Fixture::new(interactive, scenario);
        fixture.prompt(prompt);
        let events = fixture.collect_until("turn_finished");
        assert!(
            events
                .iter()
                .all(|event| event.kind != "user_questions" && event.kind != "permission")
        );
        let wire = wire_update(
            events
                .iter()
                .find(|event| event.kind == "session_update")
                .unwrap(),
        );
        assert_eq!(wire["error"]["code"], code, "{interactive} {scenario}");
        assert_eq!(wire["advertised"], interactive);
        fixture.close();
    }
    let fixture = Fixture::new(true, "before-bind");
    fixture.prompt("plain");
    let events = fixture.collect_until("turn_finished");
    assert!(events.iter().all(|event| event.kind != "user_questions"));
    fixture.close();
}

#[test]
fn independent_batches_retain_their_own_answer_correlation() {
    let fixture = Fixture::new(true, "");
    fixture.prompt("fifo");
    let first: PendingQuestions =
        serde_json::from_value(fixture.until("user_questions").data).unwrap();
    let second: PendingQuestions =
        serde_json::from_value(fixture.until("user_questions").data).unwrap();
    assert_ne!(first.request_id, second.request_id);
    fixture
        .handle
        .user_questions
        .finish(&second.request_id, QuestionReply::Cancelled {})
        .unwrap();
    assert_eq!(
        fixture.until("user_questions_resolved").data["toolCallId"],
        "second-call"
    );
    assert_eq!(
        wire_update(&fixture.until("session_update"))["tool"],
        "second-call"
    );
    fixture
        .handle
        .user_questions
        .finish(&first.request_id, answer())
        .unwrap();
    assert_eq!(
        fixture.until("user_questions_resolved").data["toolCallId"],
        "first-call"
    );
    assert_eq!(
        wire_update(&fixture.until("session_update"))["result"],
        serde_json::to_value(answer()).unwrap()
    );
    fixture.until("turn_finished");
    fixture.close();
}

#[test]
fn duplicate_requests_and_rpc_cancellation_do_not_duplicate_cards_or_block_dispatch() {
    let fixture = Fixture::new(true, "");
    fixture.prompt("duplicate");
    let pending: PendingQuestions =
        serde_json::from_value(fixture.until("user_questions").data).unwrap();
    let error = wire_update(&fixture.until("session_update"));
    assert_eq!(error["error"]["code"], -32602);
    fixture
        .handle
        .user_questions
        .finish(&pending.request_id, answer())
        .unwrap();
    fixture.until("turn_finished");
    fixture.close();
    for prompt in ["cancel-notification", "standard-cancel"] {
        let fixture = Fixture::new(true, "");
        fixture.prompt(prompt);
        let events = fixture.collect_until("turn_finished");
        assert_eq!(
            events
                .iter()
                .filter(|event| event.kind == "user_questions")
                .count(),
            1
        );
        assert_eq!(
            events
                .iter()
                .filter(|event| event.kind == "user_questions_resolved")
                .count(),
            1
        );
        let wire = wire_update(
            events
                .iter()
                .find(|event| event.kind == "session_update")
                .unwrap(),
        );
        assert_eq!(wire["result"], json!({"outcome":"cancelled"}));
        fixture.close();
    }
}

#[test]
fn turn_cancel_close_and_peer_failure_clear_pending_questions() {
    for prompt in ["cancel", "close", "peer-exit"] {
        let fixture = Fixture::new(true, "");
        fixture.prompt(prompt);
        let pending: PendingQuestions =
            serde_json::from_value(fixture.until("user_questions").data).unwrap();
        if prompt == "cancel" {
            fixture.handle.tx.send(SessionCommand::Cancel).unwrap();
        }
        if prompt == "close" {
            fixture.handle.tx.send(SessionCommand::Close).unwrap();
        }
        let events = fixture.collect_until(if prompt == "cancel" {
            "turn_finished"
        } else {
            "session_closed"
        });
        assert_eq!(
            events
                .iter()
                .filter(|event| event.kind == "user_questions_resolved")
                .count(),
            1,
            "{prompt}"
        );
        assert!(
            fixture
                .handle
                .user_questions
                .finish(&pending.request_id, answer())
                .is_err()
        );
        if prompt == "cancel" {
            fixture.close();
        }
    }
}
