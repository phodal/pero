use crate::{
    AgentId, AnalysisId, Finish, Input, MessageClass, ModelId, Record, RecordKind, Session,
    SessionId, TimeMs, ToolCallId, ToolName,
};

pub fn at(ms: i64) -> TimeMs {
    TimeMs::new(ms)
}

pub fn sid(value: &str) -> SessionId {
    SessionId::new(value).unwrap()
}

pub fn tool_name(value: &str) -> ToolName {
    ToolName::new(value).unwrap()
}

pub fn session() -> Session {
    Session {
        id: sid("session-1"),
        title: "Restart recovery".to_string(),
        agent: AgentId::new("pero"),
        model: ModelId::new("session-model"),
        project_path: "/work/pero".to_string(),
        git_branch: "main".to_string(),
        repository: "github.com/org/pero".to_string(),
        project_id: "prj_a".to_string(),
        task_id: "task_a".to_string(),
        run_id: "run_a".to_string(),
        spawned: true,
        parent: Some(sid("parent")),
        reported_tokens: crate::TokenUsage::default(),
    }
}

pub fn input() -> Input {
    Input {
        id: AnalysisId::new("analysis-1").unwrap(),
        at: at(1_000),
        window: None,
    }
}

pub fn child_session() -> SessionId {
    sid("child-1")
}

pub fn user(seq: u64, ms: i64, text: &str) -> Record {
    Record::new(
        seq,
        Some(at(ms)),
        RecordKind::User {
            class: MessageClass::Text,
            text: text.to_string(),
        },
    )
}

pub fn assistant(seq: u64, ms: i64, text: &str) -> Record {
    Record::new(
        seq,
        Some(at(ms)),
        RecordKind::Assistant {
            class: MessageClass::Text,
            text: text.to_string(),
            finish: Finish::None,
            interrupted: false,
        },
    )
}

pub fn meta(seq: u64, ms: i64, text: &str) -> Record {
    Record::new(
        seq,
        Some(at(ms)),
        RecordKind::User {
            class: MessageClass::Meta,
            text: text.to_string(),
        },
    )
}

pub fn compact(seq: u64, ms: i64, text: &str) -> Record {
    Record::new(
        seq,
        Some(at(ms)),
        RecordKind::Assistant {
            class: MessageClass::Compact,
            text: text.to_string(),
            finish: Finish::None,
            interrupted: false,
        },
    )
}

pub fn system(seq: u64, ms: i64, text: &str) -> Record {
    Record::new(
        seq,
        Some(at(ms)),
        RecordKind::System {
            class: MessageClass::Text,
            text: text.to_string(),
        },
    )
}

pub fn tool_call(seq: u64, ms: i64, id: &str, name: &str, error: bool) -> Record {
    Record::new(
        seq,
        Some(at(ms)),
        RecordKind::ToolCall {
            id: ToolCallId::new(id),
            name: tool_name(name),
            error,
            child: None,
        },
    )
}

pub fn tool_call_child(seq: u64, ms: i64, id: &str, name: &str, child: SessionId) -> Record {
    Record::new(
        seq,
        Some(at(ms)),
        RecordKind::ToolCall {
            id: ToolCallId::new(id),
            name: tool_name(name),
            error: false,
            child: Some(child),
        },
    )
}

pub fn tool_result(seq: u64, ms: i64, id: &str, error: bool) -> Record {
    Record::new(
        seq,
        Some(at(ms)),
        RecordKind::ToolResult {
            id: ToolCallId::new(id),
            name: None,
            error,
        },
    )
}

pub fn turn_start(seq: u64, ms: i64, turn: u32) -> Record {
    Record::new(seq, Some(at(ms)), RecordKind::TurnStart { turn })
}

pub fn turn_end(seq: u64, ms: i64, turn: u32, finish: Finish) -> Record {
    Record::new(seq, Some(at(ms)), RecordKind::TurnEnd { turn, finish })
}
