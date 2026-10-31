//! Durable Automation decisions. The caller commits the entire transition before
//! delivering effects. This module performs no I/O and never replays a reservation.
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
mod calendar;
mod manual;
pub use calendar::CalendarSchedule;

const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Limits {
    pub max_events: usize,
    pub max_requests: usize,
    pub max_snapshots: usize,
    pub max_definitions: usize,
    pub max_fanout: usize,
    pub max_event_bytes: usize,
    pub max_active: usize,
    pub max_dispatches: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SourceBinding {
    pub id: String,
    pub owner: String,
    pub authority: String,
    pub event_kinds: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Trigger {
    Manual,
    Event { binding_id: String, event_kind: String },
    Time { subject: String, exact: Option<ExactRef>, anchor: u64, interval_seconds: u64, max_lateness_seconds: u64 },
    Calendar { schedule: CalendarSchedule, subject: String, exact: Option<ExactRef> },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InputContract { ProcessExact, RecheckLatest }

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Method {
    Agent { agent_id: String, workspace: String, prompt: String },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Target { LocalHost { owner: String }, Shared, Worker }

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Definition {
    pub id: String,
    pub revision: u64,
    pub owner: String,
    pub trigger: Trigger,
    pub input: InputContract,
    pub input_binding_id: String,
    pub method: Method,
    pub target: Target,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Control { pub paused: bool, pub revoked: bool }

/// A producer assertion is not a trusted snapshot or an execution grant.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExactRef { pub revision: String, pub digest: String }

/// Published only after Host validates immutable source storage and authority.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CandidateRef {
    pub binding_id: String,
    pub subject: String,
    pub revision: String,
    pub digest: String,
    pub content_ref: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EventInput {
    pub binding_id: String,
    pub producer_id: String,
    pub event_kind: String,
    pub subject: String,
    pub exact: Option<ExactRef>,
    pub digest: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AcceptedEvent {
    pub id: String,
    pub input: EventInput,
    pub position: u64,
    pub accepted_at: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Decision {
    pub acceptance_id: String,
    pub definition_id: String,
    pub revision: u64,
    pub request_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Intent {
    Event,
    Manual { id: String },
    Time { slot: u64 },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum RequestStatus {
    Pending,
    InputUnavailable,
    DefinitionChanged,
    Reserved,
    Running,
    CancelRequested,
    Reconcile,
    Reconciled,
    NotStarted,
    Completed,
    Failed,
    Cancelled,
    Covered { request_id: String },
    Expired,
}
impl RequestStatus {
    fn waiting(&self) -> bool {
        matches!(self, Self::Pending | Self::InputUnavailable | Self::DefinitionChanged)
    }
    pub fn active(&self) -> bool {
        matches!(self, Self::Reserved | Self::Running | Self::CancelRequested | Self::Reconcile)
    }
    fn covers_event(&self) -> bool {
        matches!(self, Self::Completed | Self::Failed | Self::Cancelled | Self::Reconciled)
    }
    fn known_terminal(&self) -> bool { self.covers_event() || *self == Self::NotStarted }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReconciliationDisposition { NotStarted, Completed, Failed, Cancelled }
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReconciliationAuthority { LocalOperator }
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OperatorReconciliation {
    pub execution_id: String,
    pub disposition: ReconciliationDisposition,
    pub evidence: String,
    pub recorded_at: u64,
    pub previous_status: RequestStatus,
    pub authority: ReconciliationAuthority,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RunRequest {
    pub id: String,
    pub definition: Definition,
    pub intent: Intent,
    pub subject: String,
    pub exact: Option<ExactRef>,
    pub created_at: u64,
    pub through_position: u64,
    pub snapshot: Option<CandidateRef>,
    pub execution_id: Option<String>,
    pub status: RequestStatus,
    pub continued_revision: bool,
    pub cancel_requested: bool,
    #[serde(default)]
    pub reprocess_of: Option<String>,
    #[serde(default)]
    pub operator_reconciliation: Option<OperatorReconciliation>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CapacityCount { pub used: u64, pub limit: u64 }
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CapacityKind { Requests, Events, Snapshots, Definitions, Dispatches }
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CapacityStatus {
    pub requests: CapacityCount,
    pub events: CapacityCount,
    pub snapshots: CapacityCount,
    pub definitions: CapacityCount,
    pub dispatches: CapacityCount,
    pub exhausted: Vec<CapacityKind>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct State {
    pub owner: String,
    pub limits: Limits,
    pub bindings: Vec<SourceBinding>,
    pub definitions: Vec<Definition>,
    pub controls: BTreeMap<String, Control>,
    pub revoked_bindings: Vec<String>,
    pub snapshots: Vec<CandidateRef>,
    pub latest: Vec<CandidateRef>,
    pub events: Vec<AcceptedEvent>,
    pub decisions: Vec<Decision>,
    pub requests: Vec<RunRequest>,
    pub dispatch_count: u64,
    #[serde(default)]
    pub calendar_slots: BTreeMap<String, u64>,
}
impl State {
    /// Observation only: counts retain completed identities and reserved budgets.
    pub fn capacity(&self) -> CapacityStatus {
        let mut exhausted = Vec::new();
        let mut count = |kind, used, limit| {
            if used >= limit { exhausted.push(kind); }
            CapacityCount { used, limit }
        };
        let requests = count(CapacityKind::Requests, self.requests.len() as u64, self.limits.max_requests as u64);
        let events = count(CapacityKind::Events, self.events.len() as u64, self.limits.max_events as u64);
        let snapshots = count(CapacityKind::Snapshots, self.snapshots.len() as u64, self.limits.max_snapshots as u64);
        let definitions = count(CapacityKind::Definitions, self.definitions.len() as u64, self.limits.max_definitions as u64);
        let dispatches = count(CapacityKind::Dispatches, self.dispatch_count, self.limits.max_dispatches);
        CapacityStatus { requests, events, snapshots, definitions, dispatches, exhausted }
    }
    pub fn new(owner: String, limits: Limits) -> Result<Self, Error> {
        if !identifier(&owner) || limits.max_events == 0 || limits.max_requests == 0
            || limits.max_snapshots == 0 || limits.max_definitions == 0
            || limits.max_fanout == 0 || limits.max_event_bytes == 0
            || limits.max_active == 0 || limits.max_dispatches == 0
            || limits.max_dispatches > MAX_SAFE_INTEGER
            || [limits.max_events, limits.max_requests, limits.max_snapshots, limits.max_definitions,
                limits.max_fanout, limits.max_event_bytes, limits.max_active].iter().any(|v| *v as u128 > MAX_SAFE_INTEGER as u128) {
            return Err(Error::Invalid);
        }
        Ok(Self { owner, limits, bindings: vec![], definitions: vec![], controls: BTreeMap::new(),
            revoked_bindings: vec![], snapshots: vec![], latest: vec![], events: vec![], decisions: vec![],
            requests: vec![], dispatch_count: 0, calendar_slots: BTreeMap::new() })
    }
    /// Validate once when opening persisted state. Parsing JSON is not proof of
    /// domain validity; malformed records must fail closed before scheduling.
    pub fn validate_restored(&self) -> Result<(), Error> {
        let mut validated = Self::new(self.owner.clone(), self.limits.clone())?;
        for binding in &self.bindings {
            validated = apply(&validated, Command::PutBinding { binding: binding.clone() }, 0, Ids::default())?.state;
        }
        for definition in &self.definitions {
            validated = apply(&validated, Command::PutDefinition { definition: definition.clone() }, 0, Ids::default())?.state;
        }
        self.validate_calendar_cursors()?;
        for candidate in &self.snapshots {
            validated = apply(&validated, Command::PublishSnapshot { candidate: candidate.clone(), latest: false }, 0, Ids::default())?.state;
        }
        if validated.bindings != self.bindings || validated.definitions != self.definitions
            || validated.snapshots != self.snapshots || self.events.len() > self.limits.max_events
            || self.requests.len() > self.limits.max_requests { return Err(Error::Invalid); }
        let mut latest_keys = BTreeSet::new();
        for candidate in &self.latest {
            if !self.snapshots.contains(candidate) || !latest_keys.insert((&candidate.binding_id, &candidate.subject)) { return Err(Error::Invalid); }
        }
        for id in self.controls.keys() {
            if self.latest_definition(id).is_none() { return Err(Error::Invalid); }
        }
        let mut revoked = BTreeSet::new();
        for id in &self.revoked_bindings {
            source(self, id)?;
            if !revoked.insert(id) { return Err(Error::Invalid); }
        }
        let mut event_ids = BTreeSet::new();
        let mut event_keys = BTreeSet::new();
        for (index, event) in self.events.iter().enumerate() {
            validate_event(self, &event.input)?;
            if !identifier(&event.id) || !event_ids.insert(&event.id)
                || !event_keys.insert((&event.input.binding_id, &event.input.producer_id))
                || event.position != index as u64 + 1 || event.accepted_at > MAX_SAFE_INTEGER { return Err(Error::Invalid); }
        }
        let mut request_ids = BTreeSet::new();
        let mut execution_ids = BTreeSet::new();
        for request in &self.requests {
            if !identifier(&request.id) || !request_ids.insert(&request.id)
                || !self.definitions.contains(&request.definition) || !identifier(&request.subject)
                || !exact_valid(&request.exact) || request.created_at > MAX_SAFE_INTEGER
                || request.through_position > self.events.len() as u64
                || (request.definition.input == InputContract::ProcessExact && request.exact.is_none()) { return Err(Error::Invalid); }
            match (&request.intent, &request.definition.trigger) {
                (Intent::Event, Trigger::Event { .. }) if request.through_position > 0 => (),
                (Intent::Manual { id }, trigger) if identifier(id) && request.through_position == 0
                    && manual::accepts(trigger, &request.subject, &request.exact) => (),
                (Intent::Time { slot }, Trigger::Time { subject, exact, anchor, interval_seconds, .. })
                    if request.through_position == 0 && request.subject == *subject && request.exact == *exact
                        && *slot >= *anchor && *slot <= MAX_SAFE_INTEGER && (slot - anchor) % interval_seconds == 0 => (),
                (Intent::Time { .. }, Trigger::Calendar { .. }) if calendar::valid_restored_intent(request) => (),
                _ => return Err(Error::Invalid),
            }
            if let Some(candidate) = &request.snapshot {
                if !self.snapshots.contains(candidate) || candidate.binding_id != request.definition.input_binding_id
                    || candidate.subject != request.subject || (request.definition.input == InputContract::ProcessExact
                        && request.exact.as_ref().is_none_or(|e| e.revision != candidate.revision || e.digest != candidate.digest)) { return Err(Error::Invalid); }
            }
            if let Some(execution) = &request.execution_id {
                if !identifier(execution) || !execution_ids.insert(execution) || request.snapshot.is_none() { return Err(Error::Invalid); }
            }
            if request.status.active() || matches!(request.status, RequestStatus::Completed | RequestStatus::Failed | RequestStatus::Reconciled | RequestStatus::NotStarted) {
                if request.execution_id.is_none() || request.snapshot.is_none() { return Err(Error::Invalid); }
            }
            if request.status.waiting() && (request.execution_id.is_some() || request.snapshot.is_some()) { return Err(Error::Invalid); }
            if request.status == RequestStatus::CancelRequested && !request.cancel_requested { return Err(Error::Invalid); }
            if request.status == RequestStatus::Expired && (!matches!(request.intent, Intent::Time { .. }) || request.execution_id.is_some()) { return Err(Error::Invalid); }
            if let Some(record) = &request.operator_reconciliation {
                if request.status != RequestStatus::Reconciled || request.execution_id.as_ref() != Some(&record.execution_id)
                    || !matches!(record.previous_status, RequestStatus::Reconcile | RequestStatus::CancelRequested)
                    || (record.previous_status == RequestStatus::CancelRequested && !request.cancel_requested)
                    || record.recorded_at > MAX_SAFE_INTEGER || record.evidence.is_empty() || record.evidence.len() > 4096
                    || record.evidence.trim() != record.evidence { return Err(Error::Invalid); }
            } else if request.status == RequestStatus::Reconciled { return Err(Error::Invalid); }
            if let Some(previous_id) = &request.reprocess_of {
                let previous = self.requests.iter().find(|r| &r.id == previous_id).ok_or(Error::Invalid)?;
                if previous.id == request.id || request.intent == Intent::Event || request.execution_id.is_none() || request.snapshot.is_none()
                    || previous.definition.id != request.definition.id || previous.subject != request.subject
                    || previous.snapshot != request.snapshot || previous.execution_id.is_none()
                    || !previous.status.known_terminal() { return Err(Error::Invalid); }
                let mut visited = BTreeSet::from([&request.id]);
                let mut ancestor = previous;
                loop {
                    if !visited.insert(&ancestor.id) { return Err(Error::Invalid); }
                    let Some(id) = &ancestor.reprocess_of else { break; };
                    ancestor = self.requests.iter().find(|r| &r.id == id).ok_or(Error::Invalid)?;
                }
            }
            if let RequestStatus::Covered { request_id } = &request.status {
                let covering = self.requests.iter().find(|r| &r.id == request_id).ok_or(Error::Invalid)?;
                if covering.id == request.id || covering.definition.id != request.definition.id
                    || covering.definition.method != request.definition.method || covering.subject != request.subject
                    || covering.snapshot != request.snapshot || request.snapshot.is_none() || request.execution_id.is_some()
                    || !covering.status.covers_event() { return Err(Error::Invalid); }
            }
        }
        if self.dispatch_count != execution_ids.len() as u64 || self.dispatch_count > self.limits.max_dispatches
            || self.requests.iter().filter(|r| r.status.active()).count() > self.limits.max_active { return Err(Error::Invalid); }
        let mut consumer_keys = BTreeSet::new();
        for decision in &self.decisions {
            let event = self.events.iter().find(|e| e.id == decision.acceptance_id).ok_or(Error::Invalid)?;
            let request = self.requests.iter().find(|r| r.id == decision.request_id).ok_or(Error::Invalid)?;
            if !consumer_keys.insert((&decision.acceptance_id, &decision.definition_id))
                || request.definition.id != decision.definition_id || request.definition.revision != decision.revision
                || request.subject != event.input.subject || request.through_position < event.position
                || !matches!(&request.definition.trigger, Trigger::Event { binding_id, event_kind }
                    if binding_id == &event.input.binding_id && event_kind == &event.input.event_kind)
                || (request.definition.input == InputContract::ProcessExact && request.exact != event.input.exact) { return Err(Error::Invalid); }
        }
        for event in &self.events {
            if self.decisions.iter().filter(|d| d.acceptance_id == event.id).count() > self.limits.max_fanout { return Err(Error::Invalid); }
        }
        for request in &self.requests {
            if request.intent == Intent::Event && !self.decisions.iter().any(|d| d.request_id == request.id) { return Err(Error::Invalid); }
        }
        Ok(())
    }
    pub fn latest_definition(&self, id: &str) -> Option<&Definition> {
        self.definitions.iter().rev().find(|d| d.id == id)
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Ids { pub acceptance_id: String, pub request_ids: Vec<String> }

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Outcome { Running, NotStarted, Completed, Failed, Cancelled, Unknown }

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
pub enum Command {
    PutBinding { binding: SourceBinding },
    PutDefinition { definition: Definition },
    PublishSnapshot { candidate: CandidateRef, latest: bool },
    Accept { event: EventInput },
    Manual { definition_id: String, intent_id: String, subject: String, exact: Option<ExactRef> },
    ManualInput { definition_id: String, intent_id: String, candidate: CandidateRef },
    Time { definition_id: String, revision: u64, slot: u64, subject: String, exact: Option<ExactRef> },
    CalendarTime { definition_id: String, revision: u64, slot: u64, next_slot: Option<u64> },
    Reserve { request_id: String, execution_id: String },
    Observe { request_id: String, execution_id: String, outcome: Outcome },
    Reconcile { request_id: String, execution_id: String, disposition: ReconciliationDisposition, evidence: String, execution_stopped: bool, effects_checked: bool },
    Cancel { request_id: String },
    Control { definition_id: String, paused: bool, revoked: bool },
    RevokeBinding { binding_id: String },
    ContinueOld { request_id: String },
    Pump { execution_id: String, #[serde(default)] skip_request_ids: Vec<String> },
    Recover,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Effect {
    Dispatch { request_id: String, execution_id: String, method: Method, snapshot: CandidateRef },
    Cancel { request_id: String, execution_id: String },
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Receipt {
    Updated,
    Acceptance { id: String, duplicate: bool, matched: usize },
    Request { id: String, duplicate: bool },
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Transition { pub state: State, pub effects: Vec<Effect>, pub receipt: Receipt }

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Error { Invalid, NotFound, Conflict, Capacity, Unauthorized, UnsupportedTarget, Paused, DefinitionChanged, Busy, Budget, InvalidTransition }
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result { write!(f, "{self:?}") }
}
impl std::error::Error for Error {}

fn identifier(s: &str) -> bool { !s.is_empty() && s.len() <= 256 && !s.chars().any(char::is_control) }
fn digest(s: &str) -> bool { s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase()) }
fn exact_valid(exact: &Option<ExactRef>) -> bool {
    exact.as_ref().is_none_or(|v| identifier(&v.revision) && digest(&v.digest))
}
fn source<'a>(state: &'a State, id: &str) -> Result<&'a SourceBinding, Error> {
    state.bindings.iter().find(|b| b.id == id).ok_or(Error::NotFound)
}
fn authorized(state: &State, definition: &Definition) -> Result<(), Error> {
    if state.revoked_bindings.contains(&definition.input_binding_id)
        || state.controls.get(&definition.id).is_some_and(|c| c.revoked) {
        return Err(Error::Unauthorized);
    }
    if state.controls.get(&definition.id).is_some_and(|c| c.paused) { return Err(Error::Paused); }
    Ok(())
}
fn validate_candidate(state: &State, candidate: &CandidateRef) -> Result<(), Error> {
    source(state, &candidate.binding_id)?;
    if !identifier(&candidate.subject) || !identifier(&candidate.revision)
        || !digest(&candidate.digest) || candidate.content_ref.is_empty()
        || candidate.content_ref.len() > 4096 || candidate.content_ref.chars().any(char::is_control) { return Err(Error::Invalid); }
    if state.snapshots.iter().any(|old| old.binding_id == candidate.binding_id && old.subject == candidate.subject
        && old.revision == candidate.revision && old != candidate) { return Err(Error::Conflict); }
    Ok(())
}
fn validate_event(state: &State, event: &EventInput) -> Result<(), Error> {
    let binding = source(state, &event.binding_id)?;
    if !identifier(&event.producer_id) || !identifier(&event.subject) || !digest(&event.digest)
        || !exact_valid(&event.exact) || !binding.event_kinds.contains(&event.event_kind)
        || serde_json::to_vec(event).map_err(|_| Error::Invalid)?.len() > state.limits.max_event_bytes { return Err(Error::Invalid); }
    Ok(())
}
fn new_request(state: &State, id: &str, definition: Definition, intent: Intent,
    subject: String, exact: Option<ExactRef>, now: u64, position: u64) -> Result<RunRequest, Error> {
    if !identifier(id) || state.requests.iter().any(|r| r.id == id) { return Err(Error::Conflict); }
    if !identifier(&subject) || !exact_valid(&exact)
        || (definition.input == InputContract::ProcessExact && exact.is_none()) { return Err(Error::Invalid); }
    if state.requests.len() >= state.limits.max_requests { return Err(Error::Capacity); }
    Ok(RunRequest { id: id.into(), definition, intent, subject, exact, created_at: now,
        through_position: position, snapshot: None, execution_id: None,
        status: RequestStatus::Pending, continued_revision: false, cancel_requested: false, reprocess_of: None, operator_reconciliation: None })
}
fn cancel(request: &mut RunRequest, effects: &mut Vec<Effect>) {
    if request.status.waiting() || request.status.active() { request.cancel_requested = true; }
    if request.status.waiting() { request.status = RequestStatus::Cancelled; }
    else if request.status.active() {
        request.status = RequestStatus::CancelRequested;
        if let Some(execution_id) = &request.execution_id {
            effects.push(Effect::Cancel { request_id: request.id.clone(), execution_id: execution_id.clone() });
        }
    }
}

/// Atomic fold. On error the original state is unchanged. Effects are delivered
/// only AFTER the returned state is committed; Recover never returns Dispatch.
pub fn apply(state: &State, command: Command, now: u64, ids: Ids) -> Result<Transition, Error> {
    if now > MAX_SAFE_INTEGER { return Err(Error::Invalid); }
    let mut next = state.clone();
    let mut effects = vec![];
    let mut receipt = Receipt::Updated;
    match command {
        Command::PutBinding { binding } => {
            if binding.owner != state.owner { return Err(Error::Unauthorized); }
            if !identifier(&binding.id) || !identifier(&binding.authority)
                || binding.event_kinds.is_empty() || binding.event_kinds.len() > 32
                || binding.event_kinds.iter().any(|v| !identifier(v)) { return Err(Error::Invalid); }
            if let Some(old) = state.bindings.iter().find(|b| b.id == binding.id) {
                if old != &binding { return Err(Error::Conflict); }
            } else {
                if state.bindings.len() >= state.limits.max_definitions { return Err(Error::Capacity); }
                next.bindings.push(binding);
            }
        }
        Command::PutDefinition { definition } => {
            if definition.owner != state.owner { return Err(Error::Unauthorized); }
            match &definition.target {
                Target::LocalHost { owner } if owner == &state.owner => (),
                Target::LocalHost { .. } => return Err(Error::Unauthorized),
                _ => return Err(Error::UnsupportedTarget),
            }
            if !identifier(&definition.id) || definition.revision == 0 || definition.revision > MAX_SAFE_INTEGER { return Err(Error::Invalid); }
            let binding = source(state, &definition.input_binding_id)?;
            match &definition.trigger {
                Trigger::Event { binding_id, event_kind } if binding_id != &binding.id
                    || !binding.event_kinds.contains(event_kind) => return Err(Error::Invalid),
                Trigger::Time { subject, exact, anchor, interval_seconds, max_lateness_seconds } if *interval_seconds == 0 || !identifier(subject)
                    || [anchor, interval_seconds, max_lateness_seconds].iter().any(|v| **v > MAX_SAFE_INTEGER)
                    || !exact_valid(exact) || (definition.input == InputContract::ProcessExact && exact.is_none()) => return Err(Error::Invalid),
                Trigger::Calendar { schedule, subject, exact } => calendar::validate_trigger(schedule, subject, exact, definition.input)?,
                _ => (),
            }
            let Method::Agent { agent_id, workspace, prompt } = &definition.method;
            if !identifier(agent_id) || workspace.is_empty() || workspace.len() > 4096
                || workspace.chars().any(char::is_control) || prompt.is_empty() || prompt.len() > 16384 { return Err(Error::Invalid); }
            if let Some(old) = state.definitions.iter().find(|d| d.id == definition.id && d.revision == definition.revision) {
                if old != &definition { return Err(Error::Conflict); }
            } else {
                if state.definitions.len() >= state.limits.max_definitions { return Err(Error::Capacity); }
                if state.latest_definition(&definition.id).is_some_and(|d| d.revision >= definition.revision) { return Err(Error::Conflict); }
                for request in &mut next.requests {
                    if request.definition.id == definition.id && request.status.waiting() {
                        request.status = RequestStatus::DefinitionChanged;
                        request.continued_revision = false;
                    }
                }
                next.reset_calendar_cursor(&definition);
                next.definitions.push(definition);
            }
        }
        Command::PublishSnapshot { candidate, latest } => {
            validate_candidate(state, &candidate)?;
            if state.revoked_bindings.contains(&candidate.binding_id) { return Err(Error::Unauthorized); }
            if !state.snapshots.contains(&candidate) {
                if state.snapshots.len() >= state.limits.max_snapshots { return Err(Error::Capacity); }
                next.snapshots.push(candidate.clone());
            }
            if latest {
                next.latest.retain(|s| s.binding_id != candidate.binding_id || s.subject != candidate.subject);
                next.latest.push(candidate);
            }
        }
        Command::Accept { event } => {
            validate_event(state, &event)?;
            if let Some(old) = state.events.iter().find(|e| e.input.binding_id == event.binding_id && e.input.producer_id == event.producer_id) {
                if old.input != event { return Err(Error::Conflict); }
                receipt = Receipt::Acceptance { id: old.id.clone(), duplicate: true,
                    matched: state.decisions.iter().filter(|d| d.acceptance_id == old.id).count() };
            } else {
                if state.revoked_bindings.contains(&event.binding_id) { return Err(Error::Unauthorized); }
                if !identifier(&ids.acceptance_id) || state.events.iter().any(|e| e.id == ids.acceptance_id) { return Err(Error::Conflict); }
                if state.events.len() >= state.limits.max_events { return Err(Error::Capacity); }
                let definitions: Vec<_> = state.definitions.iter().filter(|d| state.latest_definition(&d.id) == Some(*d))
                    .filter(|d| matches!(&d.trigger, Trigger::Event { binding_id, event_kind } if binding_id == &event.binding_id && event_kind == &event.event_kind)).collect();
                if definitions.len() > state.limits.max_fanout { return Err(Error::Capacity); }
                let position = state.events.last().map_or(1, |e| e.position + 1);
                let mut id_iter = ids.request_ids.iter();
                for definition in &definitions {
                    let existing = next.requests.iter_mut().find(|r| definition.input == InputContract::RecheckLatest
                        && r.definition == **definition && r.subject == event.subject && r.status.waiting());
                    let request_id = if let Some(request) = existing {
                        request.through_position = position;
                        request.id.clone()
                    } else {
                        let id = id_iter.next().ok_or(Error::Invalid)?;
                        let request = new_request(&next, id, (*definition).clone(), Intent::Event,
                            event.subject.clone(), event.exact.clone(), now, position)?;
                        next.requests.push(request);
                        id.clone()
                    };
                    next.decisions.push(Decision { acceptance_id: ids.acceptance_id.clone(),
                        definition_id: definition.id.clone(), revision: definition.revision, request_id });
                }
                next.events.push(AcceptedEvent { id: ids.acceptance_id.clone(), input: event, position, accepted_at: now });
                receipt = Receipt::Acceptance { id: ids.acceptance_id, duplicate: false, matched: definitions.len() };
            }
        }
        Command::ManualInput { definition_id, intent_id, candidate } => {
            let definition = state.latest_definition(&definition_id).ok_or(Error::NotFound)?;
            if definition.input_binding_id != candidate.binding_id { return Err(Error::Unauthorized); }
            validate_candidate(state, &candidate)?;
            // Identity admission owns publication too: a retry must not rewind
            // the authoritative latest pointer or publish unrelated input.
            let mut accepted = apply(state, Command::Manual { definition_id: definition_id.clone(), intent_id,
                subject: candidate.subject.clone(), exact: Some(ExactRef { revision: candidate.revision.clone(), digest: candidate.digest.clone() }) }, now, ids)?;
            if matches!(accepted.receipt, Receipt::Request { duplicate: true, .. }) { return Ok(accepted); }
            let published = apply(&accepted.state, Command::PublishSnapshot { candidate, latest: true }, now, Ids::default())?;
            accepted.state = published.state;
            accepted.effects.extend(published.effects);
            return Ok(accepted);
        }
        Command::Manual { definition_id, intent_id, subject, exact } => {
            let definition = state.latest_definition(&definition_id).ok_or(Error::NotFound)?;
            if !identifier(&intent_id) || (!manual::accepts(&definition.trigger, &subject, &exact)
                && !state.requests.iter().any(|r| r.definition.id == definition_id && r.intent == (Intent::Manual { id: intent_id.clone() }))) { return Err(Error::Invalid); }
            let intent = Intent::Manual { id: intent_id };
            receipt = create_intent(&mut next, definition, intent, subject, exact, now, &ids, false)?;
        }
        Command::Time { definition_id, revision, slot, subject, exact } => {
            let definition = state.definitions.iter().find(|d| d.id == definition_id && d.revision == revision).ok_or(Error::NotFound)?;
            let Trigger::Time { subject: fixed_subject, exact: fixed_exact, anchor, interval_seconds, max_lateness_seconds } = &definition.trigger else { return Err(Error::Invalid); };
            if &subject != fixed_subject || &exact != fixed_exact || slot < *anchor || slot > now || (slot - anchor) % interval_seconds != 0 { return Err(Error::Invalid); }
            receipt = create_intent(&mut next, definition, Intent::Time { slot }, subject, exact, now, &ids, now - slot > *max_lateness_seconds)?;
        }
        Command::CalendarTime { definition_id, revision, slot, next_slot } => {
            receipt = next.calendar_time(&definition_id, revision, slot, next_slot, now, &ids)?;
        }
        Command::Reserve { request_id, execution_id } => {
            let index = state.requests.iter().position(|r| r.id == request_id).ok_or(Error::NotFound)?;
            let request = &state.requests[index];
            if !request.status.waiting() { return Err(Error::InvalidTransition); }
            authorized(state, &request.definition)?;
            if !request.continued_revision && state.latest_definition(&request.definition.id) != Some(&request.definition) { return Err(Error::DefinitionChanged); }
            let candidates = if request.definition.input == InputContract::RecheckLatest { &state.latest } else { &state.snapshots };
            let candidate = candidates.iter().rev().find(|s| s.binding_id == request.definition.input_binding_id
                && s.subject == request.subject && (request.definition.input == InputContract::RecheckLatest
                    || request.exact.as_ref().is_some_and(|e| e.revision == s.revision && e.digest == s.digest)));
            if let Some(candidate) = candidate {
                // Check every unresolved execution before considering any terminal
                // coverage. An older completion must not hide a later unknown effect.
                let same_candidate = |r: &&RunRequest| r.id != request.id && r.definition.id == request.definition.id
                    && r.subject == request.subject && r.snapshot.as_ref() == Some(candidate);
                if state.requests.iter().filter(same_candidate).any(|r| r.status.active()) { return Err(Error::Busy); }
                let previous = state.requests.iter().rev().filter(same_candidate).find(|r| r.status.known_terminal());
                let covering = if request.intent == Intent::Event {
                    state.requests.iter().rev().filter(same_candidate).filter(|r| r.status.covers_event())
                        .find(|r| r.definition.method == request.definition.method)
                } else { None };
                if let Some(covering) = covering {
                    next.requests[index].snapshot = Some(candidate.clone());
                    next.requests[index].status = RequestStatus::Covered { request_id: covering.id.clone() };
                } else {
                    if state.requests.iter().filter(|r| r.status.active()).count() >= state.limits.max_active { return Err(Error::Busy); }
                    if state.dispatch_count >= state.limits.max_dispatches { return Err(Error::Budget); }
                    if !identifier(&execution_id) || state.requests.iter().any(|r| r.execution_id.as_ref() == Some(&execution_id)) { return Err(Error::Conflict); }
                    let request = &mut next.requests[index];
                    request.snapshot = Some(candidate.clone());
                    request.execution_id = Some(execution_id.clone());
                    request.status = RequestStatus::Reserved;
                    request.reprocess_of = if request.intent == Intent::Event { None } else { previous.map(|r| r.id.clone()) };
                    next.dispatch_count += 1;
                    effects.push(Effect::Dispatch { request_id, execution_id, method: request.definition.method.clone(), snapshot: candidate.clone() });
                }
            } else { next.requests[index].status = RequestStatus::InputUnavailable; }
        }
        Command::Reconcile { request_id, execution_id, disposition, evidence, execution_stopped, effects_checked } => {
            if !execution_stopped || !effects_checked || evidence.trim().is_empty() || evidence.len() > 4096 { return Err(Error::Invalid); }
            let evidence = evidence.trim().to_string();
            let request = next.requests.iter_mut().find(|r| r.id == request_id).ok_or(Error::NotFound)?;
            if request.execution_id.as_ref() != Some(&execution_id) { return Err(Error::Conflict); }
            if let Some(record) = &request.operator_reconciliation {
                if record.execution_id != execution_id || record.disposition != disposition || record.evidence != evidence { return Err(Error::Conflict); }
            } else {
                if !matches!(request.status, RequestStatus::Reconcile | RequestStatus::CancelRequested) { return Err(Error::InvalidTransition); }
                request.operator_reconciliation = Some(OperatorReconciliation { execution_id, disposition, evidence, recorded_at: now,
                    previous_status: request.status.clone(), authority: ReconciliationAuthority::LocalOperator });
                request.status = RequestStatus::Reconciled;
                next.controls.entry(request.definition.id.clone()).or_default().paused = true;
            }
        }
        Command::Observe { request_id, execution_id, outcome } => {
            let request = next.requests.iter_mut().find(|r| r.id == request_id).ok_or(Error::NotFound)?;
            if request.execution_id.as_ref() != Some(&execution_id) { return Err(Error::Conflict); }
            if outcome == Outcome::NotStarted && !matches!(request.status, RequestStatus::Reserved | RequestStatus::CancelRequested | RequestStatus::NotStarted) { return Err(Error::InvalidTransition); }
            let status = match outcome { Outcome::Running => RequestStatus::Running, Outcome::NotStarted => RequestStatus::NotStarted, Outcome::Completed => RequestStatus::Completed,
                Outcome::Failed => RequestStatus::Failed, Outcome::Cancelled => RequestStatus::Cancelled, Outcome::Unknown => RequestStatus::Reconcile };
            if !request.status.active() && request.status != status { return Err(Error::InvalidTransition); }
            request.status = if request.cancel_requested && status == RequestStatus::Running { RequestStatus::CancelRequested } else { status };
        }
        Command::Cancel { request_id } => {
            let request = next.requests.iter_mut().find(|r| r.id == request_id).ok_or(Error::NotFound)?;
            cancel(request, &mut effects);
        }
        Command::Control { definition_id, paused, revoked } => {
            state.latest_definition(&definition_id).ok_or(Error::NotFound)?;
            if state.controls.get(&definition_id).is_some_and(|c| c.revoked) && !revoked { return Err(Error::Unauthorized); }
            next.controls.insert(definition_id.clone(), Control { paused, revoked });
            if revoked { for request in &mut next.requests { if request.definition.id == definition_id { cancel(request, &mut effects); } } }
        }
        Command::RevokeBinding { binding_id } => {
            source(state, &binding_id)?;
            if !next.revoked_bindings.contains(&binding_id) { next.revoked_bindings.push(binding_id.clone()); }
            for request in &mut next.requests { if request.definition.input_binding_id == binding_id { cancel(request, &mut effects); } }
        }
        Command::ContinueOld { request_id } => {
            let request = next.requests.iter_mut().find(|r| r.id == request_id).ok_or(Error::NotFound)?;
            if request.status != RequestStatus::DefinitionChanged { return Err(Error::InvalidTransition); }
            authorized(state, &request.definition)?;
            request.continued_revision = true;
            request.status = RequestStatus::Pending;
        }
        Command::Pump { execution_id, skip_request_ids } => {
            if skip_request_ids.len() > state.limits.max_requests { return Err(Error::Invalid); }
            for request in &state.requests {
                if !request.status.waiting() || skip_request_ids.contains(&request.id) { continue; }
                let attempt = apply(state, Command::Reserve { request_id: request.id.clone(), execution_id: execution_id.clone() }, now, Ids::default());
                match attempt {
                    Ok(transition) if transition.state != *state => return Ok(transition),
                    Ok(_) | Err(Error::Busy | Error::Budget | Error::Paused | Error::Unauthorized | Error::DefinitionChanged) => (),
                    Err(error) => return Err(error),
                }
            }
        }
        Command::Recover => {
            for request in &mut next.requests {
                if request.status.active() {
                    request.status = RequestStatus::Reconcile;
                    if request.cancel_requested {
                        if let Some(execution_id) = &request.execution_id {
                            effects.push(Effect::Cancel { request_id: request.id.clone(), execution_id: execution_id.clone() });
                        }
                    }
                }
            }
        }
    }
    Ok(Transition { state: next, effects, receipt })
}

fn create_intent(state: &mut State, definition: &Definition, intent: Intent, subject: String,
    exact: Option<ExactRef>, now: u64, ids: &Ids, expired: bool) -> Result<Receipt, Error> {
    if let Some(old) = state.requests.iter().find(|r| r.definition.id == definition.id
        && (matches!(intent, Intent::Manual { .. }) || r.definition.revision == definition.revision) && r.intent == intent) {
        if old.subject != subject || old.exact != exact { return Err(Error::Conflict); }
        return Ok(Receipt::Request { id: old.id.clone(), duplicate: true });
    }
    if state.controls.get(&definition.id).is_some_and(|c| c.revoked)
        || state.revoked_bindings.contains(&definition.input_binding_id) { return Err(Error::Unauthorized); }
    let id = ids.request_ids.first().ok_or(Error::Invalid)?;
    let mut request = new_request(state, id, definition.clone(), intent, subject, exact, now, 0)?;
    if expired { request.status = RequestStatus::Expired; }
    else if state.latest_definition(&definition.id) != Some(definition) { request.status = RequestStatus::DefinitionChanged; }
    state.requests.push(request);
    Ok(Receipt::Request { id: id.clone(), duplicate: false })
}

/// Catch up only within each definition's explicit lateness window. Older slots
/// are not recreated. Returns at most max_fanout slots; caller commits each Time
/// command and calls again. A clock tick is never an intent identity.
pub fn due_slots(state: &State, now: u64) -> Vec<Command> {
    if now > MAX_SAFE_INTEGER { return vec![]; }
    let capacity = state.limits.max_requests.saturating_sub(state.requests.len()).min(state.limits.max_fanout);
    if capacity == 0 { return vec![]; }
    let mut due = vec![];
    for definition in &state.definitions {
        if state.latest_definition(&definition.id) != Some(definition) || authorized(state, definition).is_err() { continue; }
        let Trigger::Time { subject, exact, anchor, interval_seconds, max_lateness_seconds } = &definition.trigger else { continue; };
        if now < *anchor { continue; }
        let lower = now.saturating_sub(*max_lateness_seconds).max(*anchor);
        let offset = (lower - anchor).div_ceil(*interval_seconds);
        let Some(mut slot) = offset.checked_mul(*interval_seconds).and_then(|v| anchor.checked_add(v)) else { continue; };
        while slot <= now && due.len() < capacity {
            if !state.requests.iter().any(|r| r.definition.id == definition.id && r.definition.revision == definition.revision
                && r.intent == (Intent::Time { slot })) {
                due.push(Command::Time { definition_id: definition.id.clone(), revision: definition.revision, slot, subject: subject.clone(), exact: exact.clone() });
            }
            let Some(next) = slot.checked_add(*interval_seconds) else { break; };
            slot = next;
        }
        if due.len() == capacity { break; }
    }
    due
}

#[cfg(test)]
mod tests;

pub mod catalog;
