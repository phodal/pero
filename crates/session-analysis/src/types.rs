//! Named transcript and analysis values. Constructors reject empty ids.
//! Sequence order and token signs are checked once, when a transcript is prepared.

use serde::{Deserialize, Serialize};

pub const EXCERPT_LIMIT: usize = 800;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Error {
    code: &'static str,
}

impl Error {
    pub const fn new(code: &'static str) -> Self {
        Self { code }
    }

    pub const fn code(&self) -> &'static str {
        self.code
    }

    pub const SESSION_ID: Self = Self::new("session id is required");
    pub const ANALYSIS_ID: Self = Self::new("analysis id is required");
    pub const WINDOW: Self = Self::new("window end must be after start");
    pub const SEQUENCE: Self = Self::new("record sequence must be positive and increasing");
    pub const TOOL_NAME: Self = Self::new("tool call name is required");
    pub const TOKENS: Self = Self::new("token counts must be non-negative");
    pub const TURN_GAP: Self = Self::new("turn index skips ahead");
    pub const CHECKPOINT: Self = Self::new("checkpoint is invalid");
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.code)
    }
}

impl std::error::Error for Error {}

macro_rules! string_id {
    ($name:ident, $err:expr, $empty_ok:expr) => {
        #[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
        #[serde(transparent)]
        pub struct $name(String);

        impl $name {
            pub fn new(value: impl Into<String>) -> Result<Self, Error> {
                let value = value.into();
                if !$empty_ok && value.trim().is_empty() {
                    return Err($err);
                }
                Ok(Self(value))
            }

            pub fn as_str(&self) -> &str {
                &self.0
            }
        }
    };
}

string_id!(SessionId, Error::SESSION_ID, false);
string_id!(AnalysisId, Error::ANALYSIS_ID, false);
string_id!(TurnId, Error::new("turn id is required"), false);
string_id!(ToolName, Error::TOOL_NAME, false);

#[derive(Clone, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ToolCallId(String);

impl ToolCallId {
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ModelId(String);

impl ModelId {
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct AgentId(String);

impl AgentId {
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// Caller-supplied unix milliseconds. The core never reads a clock.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct TimeMs(i64);

impl TimeMs {
    pub const fn new(ms: i64) -> Self {
        Self(ms)
    }

    pub const fn get(self) -> i64 {
        self.0
    }
}

/// Inclusive start, exclusive end. Both instants come from the caller.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Window {
    pub start: TimeMs,
    pub end: TimeMs,
}

impl Window {
    pub fn contains(self, at: TimeMs) -> bool {
        at.get() >= self.start.get() && at.get() < self.end.get()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MessageClass {
    Text,
    Meta,
    Compact,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Finish {
    None,
    Stop,
    Completed,
    MaxTokens,
    Refusal,
    ToolCalls,
    Error,
    Aborted,
    Other,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Boundary {
    Explicit,
    Inferred,
    Aside,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TurnStatus {
    Unfinished,
    Completed,
    Failed,
    Stopped,
    Unknown,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Outcome {
    Ended,
    Failed,
    Stopped,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResponseKind {
    Unknown,
    Intermediate,
    Final,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TokenSource {
    None,
    Records,
    Reported,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TokenUsage {
    pub input: i64,
    pub output: i64,
    pub reasoning: i64,
    pub cache_read: i64,
    pub cache_write: i64,
    /// A source total that was not split into components.
    pub reported: i64,
}

impl TokenUsage {
    pub fn has_components(self) -> bool {
        self.input | self.output | self.reasoning | self.cache_read | self.cache_write != 0
    }

    pub fn is_empty(self) -> bool {
        !self.has_components() && self.reported == 0
    }

    pub fn component_total(self) -> i64 {
        self.input + self.output + self.reasoning + self.cache_read + self.cache_write
    }

    pub fn is_valid(self) -> bool {
        self.input >= 0
            && self.output >= 0
            && self.reasoning >= 0
            && self.cache_read >= 0
            && self.cache_write >= 0
            && self.reported >= 0
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TokenAccount {
    pub input: i64,
    pub output: i64,
    pub reasoning: i64,
    pub cache_read: i64,
    pub cache_write: i64,
    pub total: i64,
    pub source: TokenSource,
}

impl TokenAccount {
    pub fn none() -> Self {
        Self {
            input: 0,
            output: 0,
            reasoning: 0,
            cache_read: 0,
            cache_write: 0,
            total: 0,
            source: TokenSource::None,
        }
    }
}

impl Default for TokenAccount {
    fn default() -> Self {
        Self::none()
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RecordKind {
    User {
        class: MessageClass,
        text: String,
    },
    Assistant {
        class: MessageClass,
        text: String,
        finish: Finish,
        interrupted: bool,
    },
    System {
        class: MessageClass,
        text: String,
    },
    ToolCall {
        id: ToolCallId,
        name: ToolName,
        error: bool,
        child: Option<SessionId>,
    },
    ToolResult {
        id: ToolCallId,
        name: Option<ToolName>,
        error: bool,
    },
    TurnStart {
        turn: u32,
    },
    TurnEnd {
        turn: u32,
        finish: Finish,
    },
    Unknown,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Record {
    pub seq: u64,
    pub at: Option<TimeMs>,
    pub kind: RecordKind,
    pub tokens: TokenUsage,
    pub model: ModelId,
}

impl Record {
    pub fn new(seq: u64, at: Option<TimeMs>, kind: RecordKind) -> Self {
        Self {
            seq,
            at,
            kind,
            tokens: TokenUsage::default(),
            model: ModelId::new(""),
        }
    }

    pub fn with_tokens(mut self, tokens: TokenUsage) -> Self {
        self.tokens = tokens;
        self
    }

    pub fn with_model(mut self, model: ModelId) -> Self {
        self.model = model;
        self
    }
}

/// Facts the caller already resolved. `git_branch` and `repository` are not
/// computed by walking commits.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Session {
    pub id: SessionId,
    pub title: String,
    pub agent: AgentId,
    pub model: ModelId,
    pub project_path: String,
    pub git_branch: String,
    pub repository: String,
    pub project_id: String,
    pub task_id: String,
    pub run_id: String,
    pub spawned: bool,
    pub parent: Option<SessionId>,
    pub reported_tokens: TokenUsage,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Transcript {
    pub session: Session,
    pub records: Vec<Record>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Input {
    pub id: AnalysisId,
    pub at: TimeMs,
    pub window: Option<Window>,
}

/// One unit the classifier can read without looking at any other unit.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Turn {
    pub index: u32,
    pub id: TurnId,
    pub boundary: Boundary,
    pub number: u32,
    pub started_before_window: bool,
    pub prior_request: bool,
    pub end: Option<Finish>,
    pub origin_seq: u64,
    pub records: Vec<Record>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ToolUse {
    pub name: ToolName,
    pub calls: u32,
    pub errors: u32,
    pub children: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ModelUse {
    pub model: ModelId,
    pub messages: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TurnFacts {
    pub index: u32,
    pub id: TurnId,
    pub counts_as_turn: bool,
    pub boundary: Boundary,
    pub number: u32,
    pub status: TurnStatus,
    pub outcome: Option<Outcome>,
    pub started_before_window: bool,
    pub request: String,
    pub response: String,
    pub request_seq: u64,
    pub response_seq: u64,
    pub response_kind: ResponseKind,
    pub seq_start: u64,
    pub seq_end: u64,
    pub start: Option<TimeMs>,
    pub end: Option<TimeMs>,
    pub tool_calls: u32,
    pub tool_errors: u32,
    pub tools: Vec<ToolUse>,
    pub user_messages: u32,
    pub assistant_messages: u32,
    pub system_messages: u32,
    pub meta_messages: u32,
    pub compact_summaries: u32,
    pub children: Vec<SessionId>,
    pub models: Vec<ModelUse>,
    pub model_end: ModelId,
    pub tokens: TokenUsage,
    pub saw_tokens: bool,
    pub truncated: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Identity {
    pub id: SessionId,
    pub title: String,
    pub agent: AgentId,
    pub model: ModelId,
    pub models: Vec<ModelUse>,
    pub project_path: String,
    pub git_branch: String,
    pub repository: String,
    pub project_id: String,
    pub task_id: String,
    pub run_id: String,
    pub spawned: bool,
    pub parent: Option<SessionId>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Source {
    pub start_seq: u64,
    pub end_seq: u64,
    pub as_of_seq: u64,
    pub records: u32,
    pub digest: String,
}

impl Default for Source {
    fn default() -> Self {
        Self {
            start_seq: 0,
            end_seq: 0,
            as_of_seq: 0,
            records: 0,
            digest: "sha256:".to_string(),
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Coverage {
    pub in_window: u32,
    pub before_window: u32,
    pub after_window: u32,
    pub unknown: u32,
    pub complete: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Metrics {
    pub turns: u32,
    pub completed: u32,
    pub failed: u32,
    pub stopped: u32,
    pub unfinished: u32,
    pub unknown: u32,
    pub user_messages: u32,
    pub assistant_messages: u32,
    pub system_messages: u32,
    pub meta_messages: u32,
    pub compact_summaries: u32,
    pub tool_calls: u32,
    pub tool_errors: u32,
    pub tools: Vec<ToolUse>,
    pub children: Vec<SessionId>,
    pub tokens: TokenAccount,
}

impl Default for Metrics {
    fn default() -> Self {
        Self {
            turns: 0,
            completed: 0,
            failed: 0,
            stopped: 0,
            unfinished: 0,
            unknown: 0,
            user_messages: 0,
            assistant_messages: 0,
            system_messages: 0,
            meta_messages: 0,
            compact_summaries: 0,
            tool_calls: 0,
            tool_errors: 0,
            tools: Vec::new(),
            children: Vec::new(),
            tokens: TokenAccount::none(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Analysis {
    pub id: AnalysisId,
    pub at: TimeMs,
    pub window: Option<Window>,
    pub session: Identity,
    pub source: Source,
    pub turns: Vec<TurnFacts>,
    pub metrics: Metrics,
    pub coverage: Coverage,
}

pub(crate) fn clip_excerpt(text: &str) -> (String, bool) {
    let text = text.trim();
    if text.len() <= EXCERPT_LIMIT {
        return (text.to_string(), false);
    }
    let bytes = text.as_bytes();
    let mut cut = EXCERPT_LIMIT;
    while cut > 0 && (bytes[cut] & 0xC0) == 0x80 {
        cut -= 1;
    }
    let mut out = text[..cut].to_string();
    out.push('…');
    (out, true)
}

pub(crate) fn add_tool(
    tools: &mut Vec<ToolUse>,
    name: ToolName,
    calls: u32,
    errors: u32,
    children: u32,
) {
    match tools.binary_search_by(|tool| tool.name.cmp(&name)) {
        Ok(index) => {
            tools[index].calls += calls;
            tools[index].errors += errors;
            tools[index].children += children;
        }
        Err(index) => tools.insert(
            index,
            ToolUse {
                name,
                calls,
                errors,
                children,
            },
        ),
    }
}

pub(crate) fn add_tokens(total: &mut TokenUsage, extra: TokenUsage) {
    total.input += extra.input;
    total.output += extra.output;
    total.reasoning += extra.reasoning;
    total.cache_read += extra.cache_read;
    total.cache_write += extra.cache_write;
    total.reported += extra.reported;
}

pub(crate) fn account_from_usage(usage: TokenUsage, source: TokenSource) -> TokenAccount {
    if usage.has_components() {
        TokenAccount {
            input: usage.input,
            output: usage.output,
            reasoning: usage.reasoning,
            cache_read: usage.cache_read,
            cache_write: usage.cache_write,
            total: usage.component_total() + usage.reported,
            source,
        }
    } else if usage.reported != 0 {
        TokenAccount {
            total: usage.reported,
            source,
            ..TokenAccount::none()
        }
    } else {
        TokenAccount::none()
    }
}
