//! Insights shell. It reads the session journal, maps each event once into a
//! transcript, and asks `session-analysis` to fold it. The fold does not see
//! the clock, the files, or git.

use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use pero_contracts::HostEvent;
use serde_json::Value;
use session_analysis::{
    AgentId, Analysis, AnalysisId, Boundary, Budget, Checkpoint, Finish, Input, MessageClass,
    ModelId, Record, RecordKind, ResponseKind, Session, SessionId, Step, TimeMs, TokenUsage,
    ToolCallId, ToolName, Transcript, TurnStatus, analyze_concurrent, resume,
};

#[derive(Debug)]
pub struct InsightsError(String);

impl InsightsError {
    fn new(message: impl Into<String>) -> Self {
        Self(message.into())
    }
}

impl std::fmt::Display for InsightsError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl From<session_analysis::Error> for InsightsError {
    fn from(error: session_analysis::Error) -> Self {
        Self(error.code().to_string())
    }
}

pub struct Report {
    pub analysis: Analysis,
    pub resumed: bool,
}

impl Report {
    pub fn to_json(&self) -> Value {
        let metrics = &self.analysis.metrics;
        let latest = self.analysis.turns.last();
        let turns = self
            .analysis
            .turns
            .iter()
            .map(|turn| {
                serde_json::json!({
                    "status": status_name(turn.status),
                    "request": turn.request,
                    "response": turn.response,
                    "response_kind": response_kind_name(turn.response_kind),
                    "boundary": boundary_name(turn.boundary),
                    "seq_start": turn.seq_start,
                    "seq_end": turn.seq_end,
                    "truncated": turn.truncated,
                })
            })
            .collect::<Vec<_>>();
        serde_json::json!({
            "turn_count": metrics.turns,
            "completed": metrics.completed,
            "failed": metrics.failed,
            "stopped": metrics.stopped,
            "unfinished": metrics.unfinished,
            "unknown_turns": metrics.unknown,
            "tool_calls": metrics.tool_calls,
            "tool_errors": metrics.tool_errors,
            "user_messages": metrics.user_messages,
            "request": latest.map(|turn| turn.request.as_str()).unwrap_or(""),
            "response": latest.map(|turn| turn.response.as_str()).unwrap_or(""),
            "response_kind": latest.map(|turn| response_kind_name(turn.response_kind)).unwrap_or("unknown"),
            "status": latest.map(|turn| status_name(turn.status)).unwrap_or("unknown"),
            "model": self.analysis.session.model.as_str(),
            "git_branch": self.analysis.session.git_branch,
            "repository": self.analysis.session.repository,
            "resumed": self.resumed,
            "source": {
                "start_seq": self.analysis.source.start_seq,
                "end_seq": self.analysis.source.end_seq,
                "as_of_seq": self.analysis.source.as_of_seq,
                "digest": self.analysis.source.digest,
            },
            "turns": turns,
        })
    }
}

fn status_name(status: TurnStatus) -> &'static str {
    match status {
        TurnStatus::Completed => "completed",
        TurnStatus::Failed => "failed",
        TurnStatus::Stopped => "stopped",
        TurnStatus::Unfinished => "unfinished",
        TurnStatus::Unknown => "unknown",
    }
}

fn response_kind_name(kind: ResponseKind) -> &'static str {
    match kind {
        ResponseKind::Final => "final",
        ResponseKind::Intermediate => "intermediate",
        ResponseKind::Unknown => "unknown",
    }
}

fn boundary_name(boundary: Boundary) -> &'static str {
    match boundary {
        Boundary::Explicit => "explicit",
        Boundary::Inferred => "inferred",
        Boundary::Aside => "aside",
    }
}

pub fn now_ms() -> TimeMs {
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0);
    TimeMs::new(ms)
}

pub fn session_id_ok(session_id: &str) -> bool {
    !session_id.is_empty()
        && session_id.len() <= 128
        && !session_id.contains('/')
        && !session_id.contains('\\')
        && !session_id.contains("..")
}

/// Fold one thread from the host journal. A checkpoint beside the journal lets
/// a later call continue after the last finished turn.
pub fn analyze_history(
    events: &[HostEvent],
    session_id: &str,
    history_file: &Path,
    at: TimeMs,
    chunk: u32,
) -> Result<Report, InsightsError> {
    if !session_id_ok(session_id) {
        return Err(InsightsError::new("invalid session id"));
    }
    let transcript = transcript_from(events, session_id)?;
    let input = Input {
        id: AnalysisId::new(format!("insights:{session_id}"))?,
        at,
        window: None,
    };
    let path = checkpoint_path(history_file, session_id)?;
    let saved = fs::read(&path)
        .ok()
        .and_then(|bytes| Checkpoint::decode(&bytes).ok())
        .filter(|checkpoint| checkpoint.session_id() == session_id);
    let resumed = saved
        .as_ref()
        .is_some_and(|checkpoint| checkpoint.cursor().is_some());
    let chunk = chunk.max(1);
    let analysis = futures_executor::block_on(async {
        let mut step = if let Some(checkpoint) = saved {
            let prepared = session_analysis::prepare(&transcript, &input)?;
            let usable = checkpoint
                .cursor()
                .is_none_or(|cursor| (cursor as usize) < prepared.turns.len());
            if usable {
                resume(
                    checkpoint.retarget(prepared.state.source, prepared.state.coverage),
                    &prepared.turns,
                    Budget::stop_after(chunk),
                )
                .await?
            } else {
                analyze_concurrent(&transcript, &input, Budget::stop_after(chunk)).await?
            }
        } else {
            analyze_concurrent(&transcript, &input, Budget::stop_after(chunk)).await?
        };
        loop {
            match step {
                Step::Partial(next) => {
                    store(&path, &next)?;
                    let prepared = session_analysis::prepare(&transcript, &input)?;
                    step = resume(next, &prepared.turns, Budget::stop_after(chunk)).await?;
                }
                Step::Done {
                    analysis,
                    checkpoint,
                } => {
                    store(&path, &checkpoint)?;
                    return Ok::<Analysis, InsightsError>(analysis);
                }
            }
        }
    })?;
    Ok(Report { analysis, resumed })
}

fn checkpoint_path(history_file: &Path, session_id: &str) -> Result<PathBuf, InsightsError> {
    let parent = history_file.parent().unwrap_or_else(|| Path::new("."));
    Ok(parent
        .join("insights")
        .join(format!("{session_id}.checkpoint.json")))
}

fn store(path: &Path, checkpoint: &Checkpoint) -> Result<(), InsightsError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| InsightsError::new(error.to_string()))?;
    }
    let bytes = checkpoint.encode()?;
    let temporary = path.with_extension("json.tmp");
    fs::write(&temporary, bytes).map_err(|error| InsightsError::new(error.to_string()))?;
    fs::rename(&temporary, path).map_err(|error| InsightsError::new(error.to_string()))?;
    Ok(())
}

fn transcript_from(events: &[HostEvent], session_id: &str) -> Result<Transcript, InsightsError> {
    let mut mapped = Mapped::new(session_id)?;
    for event in events {
        if event.thread_id.as_deref() != Some(session_id) {
            continue;
        }
        mapped.observe(event)?;
    }
    mapped.finish()
}

struct Mapped {
    session_id: String,
    agent: String,
    model: String,
    project_path: String,
    git_branch: String,
    repository: String,
    title: String,
    records: Vec<Record>,
    seq: u64,
    turn: u32,
    pending_user: Option<String>,
    assistant: String,
    current_model: String,
}

impl Mapped {
    fn new(session_id: &str) -> Result<Self, InsightsError> {
        SessionId::new(session_id)?;
        Ok(Self {
            session_id: session_id.to_string(),
            agent: String::new(),
            model: String::new(),
            project_path: String::new(),
            git_branch: String::new(),
            repository: String::new(),
            title: session_id.to_string(),
            records: Vec::new(),
            seq: 0,
            turn: 0,
            pending_user: None,
            assistant: String::new(),
            current_model: String::new(),
        })
    }

    fn observe(&mut self, event: &HostEvent) -> Result<(), InsightsError> {
        match event.kind.as_str() {
            "session_created" => {
                if let Some(agent) = event.data["agent"].as_str() {
                    self.agent = agent.to_string();
                }
                if let Some(workspace) = event.data["workspace"].as_str() {
                    self.project_path = workspace.to_string();
                }
                if let Some(branch) = event.data["git_branch"].as_str() {
                    self.git_branch = branch.to_string();
                }
                if let Some(repository) = event.data["repository"].as_str() {
                    self.repository = repository.to_string();
                }
            }
            "model_changed" => {
                if let Some(model) = event.data["models"]["currentModelId"].as_str() {
                    self.current_model = model.to_string();
                    if self.model.is_empty() {
                        self.model = model.to_string();
                    }
                }
            }
            "user_message" => {
                self.flush_user()?;
                self.pending_user = Some(event.text.clone());
                if self.title == self.session_id && !event.text.trim().is_empty() {
                    self.title = event.text.chars().take(80).collect();
                }
            }
            "turn_started" => {
                self.flush_assistant()?;
                self.turn = self.turn.saturating_add(1);
                self.push(RecordKind::TurnStart { turn: self.turn })?;
                self.flush_user()?;
            }
            "turn_finished" => {
                self.flush_assistant()?;
                self.flush_user()?;
                self.push(RecordKind::TurnEnd {
                    turn: self.turn,
                    finish: finish_of(event),
                })?;
            }
            "session_update" => self.update(&event.data)?,
            "session_usage" => {
                self.flush_assistant()?;
                self.note_usage(&event.data)?;
            }
            _ => {}
        }
        Ok(())
    }

    fn update(&mut self, data: &Value) -> Result<(), InsightsError> {
        match data["sessionUpdate"].as_str().unwrap_or_default() {
            "agent_message_chunk" => {
                self.flush_user()?;
                if let Some(text) = data["content"]["text"].as_str() {
                    self.assistant.push_str(text);
                }
            }
            "agent_thought_chunk" => {}
            "tool_call" => {
                self.flush_user()?;
                self.flush_assistant()?;
                let name = tool_label(data);
                self.push(RecordKind::ToolCall {
                    id: ToolCallId::new(data["toolCallId"].as_str().unwrap_or_default()),
                    name: ToolName::new(name)?,
                    error: data["status"].as_str() == Some("failed"),
                    child: None,
                })?;
            }
            "tool_call_update" if data["status"].as_str() == Some("failed") => {
                self.push(RecordKind::ToolResult {
                    id: ToolCallId::new(data["toolCallId"].as_str().unwrap_or_default()),
                    name: None,
                    error: true,
                })?;
            }
            _ => {}
        }
        Ok(())
    }

    fn note_usage(&mut self, data: &Value) -> Result<(), InsightsError> {
        let usage = TokenUsage {
            input: non_negative(data["input_tokens"].as_i64())?,
            output: non_negative(data["output_tokens"].as_i64())?,
            reasoning: non_negative(data["reasoning_tokens"].as_i64())?,
            cache_read: non_negative(data["cache_read_tokens"].as_i64())?,
            cache_write: non_negative(data["cache_write_tokens"].as_i64())?,
            reported: 0,
        };
        if usage.is_empty() {
            return Ok(());
        }
        if self.records.is_empty() {
            self.push(RecordKind::System {
                class: MessageClass::Meta,
                text: String::new(),
            })?;
        }
        if let Some(record) = self.records.last_mut() {
            record.tokens.input += usage.input;
            record.tokens.output += usage.output;
            record.tokens.reasoning += usage.reasoning;
            record.tokens.cache_read += usage.cache_read;
            record.tokens.cache_write += usage.cache_write;
        }
        Ok(())
    }

    fn flush_user(&mut self) -> Result<(), InsightsError> {
        let Some(text) = self.pending_user.take() else {
            return Ok(());
        };
        self.push(RecordKind::User {
            class: MessageClass::Text,
            text,
        })
    }

    fn flush_assistant(&mut self) -> Result<(), InsightsError> {
        let text = std::mem::take(&mut self.assistant);
        if text.is_empty() {
            return Ok(());
        }
        self.push(RecordKind::Assistant {
            class: MessageClass::Text,
            text,
            finish: Finish::None,
            interrupted: false,
        })
    }

    fn push(&mut self, kind: RecordKind) -> Result<(), InsightsError> {
        self.seq = self.seq.saturating_add(1);
        let mut record = Record::new(self.seq, None, kind);
        if !self.current_model.is_empty() {
            record = record.with_model(ModelId::new(self.current_model.clone()));
        }
        self.records.push(record);
        Ok(())
    }

    fn finish(mut self) -> Result<Transcript, InsightsError> {
        self.flush_assistant()?;
        self.flush_user()?;
        Ok(Transcript {
            session: Session {
                id: SessionId::new(self.session_id)?,
                title: self.title,
                agent: AgentId::new(self.agent),
                model: ModelId::new(self.model),
                project_path: self.project_path,
                git_branch: self.git_branch,
                repository: self.repository,
                project_id: String::new(),
                task_id: String::new(),
                run_id: String::new(),
                spawned: false,
                parent: None,
                reported_tokens: TokenUsage::default(),
            },
            records: self.records,
        })
    }
}

fn finish_of(event: &HostEvent) -> Finish {
    let reason = event.data["stopReason"]
        .as_str()
        .unwrap_or(event.text.as_str());
    match reason {
        "end_turn" | "stop" => Finish::Stop,
        "cancelled" | "canceled" | "aborted" => Finish::Aborted,
        "max_tokens" | "max_token" => Finish::MaxTokens,
        "refusal" => Finish::Refusal,
        "error" | "failed" => Finish::Error,
        _ => Finish::Other,
    }
}

fn tool_label(data: &Value) -> String {
    let title = data["title"].as_str().unwrap_or("").trim();
    if !title.is_empty() {
        return title.to_string();
    }
    let kind = data["kind"].as_str().unwrap_or("").trim();
    if !kind.is_empty() {
        return kind.to_string();
    }
    "tool".to_string()
}

fn non_negative(value: Option<i64>) -> Result<i64, InsightsError> {
    match value.unwrap_or(0) {
        count if count >= 0 => Ok(count),
        _ => Err(InsightsError::new("token counts must be non-negative")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use session_analysis::Boundary;

    fn event(kind: &str, text: &str, data: Value) -> HostEvent {
        let mut event = HostEvent::new(kind, None, text.into());
        event.thread_id = Some("thread-1".into());
        event.data = data;
        event
    }

    fn sample() -> Vec<HostEvent> {
        vec![
            event(
                "session_created",
                "",
                serde_json::json!({"agent":"pero","workspace":"/work/pero","git_branch":"main","repository":"github.com/org/pero"}),
            ),
            event("user_message", "Review restart recovery", Value::Null),
            event("turn_started", "", Value::Null),
            event(
                "session_update",
                "",
                serde_json::json!({"sessionUpdate":"tool_call","toolCallId":"read-1","title":"Read journal","kind":"read","status":"completed"}),
            ),
            event(
                "session_update",
                "",
                serde_json::json!({"sessionUpdate":"tool_call_update","toolCallId":"read-1","status":"failed"}),
            ),
            event(
                "session_update",
                "",
                serde_json::json!({"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"Historical claim"}}),
            ),
            event(
                "session_usage",
                "",
                serde_json::json!({"input_tokens":4,"output_tokens":2,"cache_read_tokens":1}),
            ),
            event(
                "turn_finished",
                "",
                serde_json::json!({"stopReason":"end_turn"}),
            ),
            event("user_message", "other session", Value::Null),
        ]
    }

    #[test]
    fn a_journal_resumes_from_the_checkpoint_beside_it() {
        let dir = std::env::temp_dir().join(format!("pero-insights-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let history = dir.join("sessions.jsonl");
        fs::write(&history, b"").unwrap();
        let events = sample();
        let events = &events[..events.len() - 1];
        let first = analyze_history(events, "thread-1", &history, TimeMs::new(10), 1).unwrap();
        assert!(!first.resumed);
        assert_eq!(first.analysis.metrics.turns, 1);
        assert_eq!(first.analysis.metrics.completed, 1);
        assert_eq!(first.analysis.metrics.tool_calls, 1);
        assert_eq!(first.analysis.metrics.tool_errors, 1);
        assert_eq!(first.analysis.metrics.user_messages, 1);
        assert_eq!(first.analysis.metrics.tokens.input, 4);
        assert_eq!(first.analysis.metrics.tokens.output, 2);
        assert_eq!(first.analysis.session.git_branch, "main");
        assert_eq!(first.analysis.session.repository, "github.com/org/pero");
        assert_eq!(first.analysis.turns[0].request, "Review restart recovery");
        assert_eq!(first.analysis.turns[0].response, "Historical claim");
        assert!(first.analysis.turns[0].boundary == Boundary::Explicit);
        let path = dir.join("insights").join("thread-1.checkpoint.json");
        assert!(path.is_file());

        let again = analyze_history(events, "thread-1", &history, TimeMs::new(11), 1).unwrap();
        assert!(again.resumed);
        assert_eq!(again.analysis.metrics.turns, first.analysis.metrics.turns);
        assert_eq!(again.analysis.metrics.tool_errors, 1);

        let mut grown = events.to_vec();
        grown.push(event("user_message", "Continue", Value::Null));
        grown.push(event("turn_started", "", Value::Null));
        grown.push(event(
            "turn_finished",
            "",
            serde_json::json!({"stopReason":"cancelled"}),
        ));
        let continued = analyze_history(&grown, "thread-1", &history, TimeMs::new(12), 1).unwrap();
        assert!(continued.resumed);
        assert_eq!(continued.analysis.metrics.turns, 2);
        assert_eq!(continued.analysis.metrics.stopped, 1);
        assert_eq!(continued.analysis.metrics.completed, 1);
        let _ = fs::remove_dir_all(&dir);
    }

    /// Same hand count as the core fixture, expressed as host journal events.
    /// Expected: turns 2, failed 1, stopped 1, tools 1, tool errors 1,
    /// input 10, output 4. Thinking text and tool arguments stay out.
    #[test]
    fn hand_counted_journal_matches_the_mapping() {
        let events = vec![
            event(
                "session_created",
                "",
                serde_json::json!({"agent":"pero","workspace":"/work/pero","git_branch":"main","repository":"github.com/org/pero"}),
            ),
            event(
                "model_changed",
                "",
                serde_json::json!({"models":{"currentModelId":"deepseek-v4"}}),
            ),
            event("user_message", "Fix the parser", Value::Null),
            event("turn_started", "", Value::Null),
            event(
                "session_update",
                "",
                serde_json::json!({"sessionUpdate":"tool_call","toolCallId":"t1","title":"Read","status":"completed","rawInput":{"path":"SECRET_ARG"}}),
            ),
            event(
                "session_update",
                "",
                serde_json::json!({"sessionUpdate":"agent_thought_chunk","content":{"type":"text","text":"HIDDEN_THOUGHT"}}),
            ),
            event(
                "session_update",
                "",
                serde_json::json!({"sessionUpdate":"tool_call_update","toolCallId":"t1","status":"failed"}),
            ),
            event(
                "session_update",
                "",
                serde_json::json!({"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"Parser updated"}}),
            ),
            event(
                "session_usage",
                "",
                serde_json::json!({"input_tokens":10,"output_tokens":4,"cache_read_tokens":2}),
            ),
            event(
                "turn_finished",
                "",
                serde_json::json!({"stopReason":"error"}),
            ),
            event("user_message", "Stop here", Value::Null),
            event("turn_started", "", Value::Null),
            event(
                "turn_finished",
                "",
                serde_json::json!({"stopReason":"cancelled"}),
            ),
        ];
        let dir =
            std::env::temp_dir().join(format!("pero-insights-fixture-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let history = dir.join("sessions.jsonl");
        let report = analyze_history(&events, "thread-1", &history, TimeMs::new(20), 8).unwrap();
        let metrics = &report.analysis.metrics;
        assert_eq!(
            (
                metrics.turns,
                metrics.failed,
                metrics.stopped,
                metrics.tool_calls,
                metrics.tool_errors
            ),
            (2, 1, 1, 1, 1)
        );
        assert_eq!(
            (
                metrics.tokens.input,
                metrics.tokens.output,
                metrics.tokens.cache_read
            ),
            (10, 4, 2)
        );
        assert_eq!(report.analysis.session.model.as_str(), "deepseek-v4");
        assert_eq!(report.analysis.session.git_branch, "main");
        assert_eq!(report.analysis.session.repository, "github.com/org/pero");
        let body = serde_json::to_string(&report.to_json()).unwrap();
        assert!(body.contains("Stop here"));
        assert!(!body.contains("SECRET_ARG"));
        assert!(!body.contains("HIDDEN_THOUGHT"));
        let _ = fs::remove_dir_all(&dir);
    }

    /// Optional check against a real journal. Set PERO_HISTORY_PATH and
    /// PERO_INSIGHTS_SESSION. Expected counts are the manual reading of
    /// chat-1793283309757-2 in ~/.pero/native-preview/sessions.jsonl:
    /// 3 turns, 0 failed, 1 stopped, 5 tool calls, 0 failed tools.
    #[test]
    fn real_journal_matches_the_manual_count() {
        let Some(path) = std::env::var_os("PERO_HISTORY_PATH") else {
            return;
        };
        let Ok(session) = std::env::var("PERO_INSIGHTS_SESSION") else {
            return;
        };
        let text = fs::read_to_string(&path).unwrap();
        let events = text
            .lines()
            .filter_map(|line| serde_json::from_str::<HostEvent>(line).ok())
            .collect::<Vec<_>>();
        let dir = std::env::temp_dir().join(format!("pero-insights-real-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let report = analyze_history(
            &events,
            &session,
            &dir.join("sessions.jsonl"),
            TimeMs::new(1),
            32,
        )
        .unwrap();
        if session == "chat-1793283309757-2" {
            assert_eq!(report.analysis.metrics.turns, 3, "turns");
            assert_eq!(report.analysis.metrics.failed, 0, "failed turns");
            assert_eq!(report.analysis.metrics.stopped, 1, "stopped turns");
            assert_eq!(report.analysis.metrics.tool_calls, 5, "tools");
            assert_eq!(report.analysis.metrics.tool_errors, 0, "failed tools");
            let requests: Vec<_> = report.analysis.turns.iter().map(|turn| turn.request.as_str()).collect();
            assert_eq!(requests, vec!["hi", "今天 天气怎么样呢？", "杭州"]);
            assert_eq!(report.analysis.turns[0].response, "Hi! I'm ready to help with the Pero codebase. What would you like to work on?");
            assert!(report.analysis.turns[1].response.contains("我没法获取你的位置"));
            assert_eq!(report.analysis.turns[2].response, "我来搜一下杭州今天的天气。");
            assert!(!report.analysis.turns.iter().any(|turn| turn.response.contains("°") || turn.request.contains("SECRET")));
        }
        let _ = fs::remove_dir_all(&dir);
    }
}
