//! A projection of an existing Run or Session. This module does not advance
//! a Run, a campaign, or an ACP session. It only says what a client may observe.
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum IdentityKind {
    AppAgentRun,
    ControlPlaneRun,
    AcpSession,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RunOperation {
    Status,
    Lookup,
    Events,
    Cancel,
    Approve,
    Start,
    Retry,
    Replay,
    Reconnect,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RunOutcome {
    Observed,
    Applied,
    TransportAbort,
    ExecutionCancel,
    Timeout,
    ExecutionFailure,
    Interrupted,
    Unknown,
    Gap,
    ExpiredCursor,
    GenerationChanged,
    Duplicate,
    Conflict,
    StaleBinding,
    Revoked,
    WrongProject,
    Traversal,
    Unsupported,
    Approved,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RunEffect {
    None,
    ApplyOnce,
    CancelOwner,
    ApproveOwner,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RunBinding {
    pub kind: IdentityKind,
    pub owner_host: String,
    pub project: String,
    pub id: String,
    pub generation: u64,
    pub scope: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RunRequest {
    pub operation: RunOperation,
    pub request_id: String,
    pub input_hash: String,
    pub cursor: Option<u64>,
    pub generation: u64,
    pub consumer_closed: bool,
    pub timed_out: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StoredReceipt {
    pub request_id: String,
    pub operation: RunOperation,
    pub input_hash: String,
    pub outcome: RunOutcome,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OwnerView {
    pub project: String,
    pub owner_host: String,
    pub live: bool,
    pub known: bool,
    pub restarted: bool,
    pub status: String,
    pub events: Vec<u64>,
    pub retained_from: u64,
    pub generation: u64,
    pub supports_cancel: bool,
    pub supports_approve: bool,
    pub approval_recorded: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Observation {
    pub status: String,
    pub outcome: RunOutcome,
    pub effect: RunEffect,
    pub cursor: u64,
    pub events: Vec<u64>,
    pub continuation: &'static str,
}

pub fn observe(
    member: bool,
    project: &str,
    binding: &RunBinding,
    request: &RunRequest,
    owner: &OwnerView,
    ledger: &[StoredReceipt],
) -> Observation {
    let continuation = if binding.kind == IdentityKind::AcpSession {
        "unsupported"
    } else {
        "not_applicable"
    };
    for value in [
        &binding.owner_host,
        &binding.id,
        &binding.scope,
        &binding.project,
        &request.request_id,
        &request.input_hash,
    ] {
        if traversed(value) {
            return quiet(RunOutcome::Traversal, continuation);
        }
    }
    if !member {
        return quiet(RunOutcome::Revoked, continuation);
    }
    if owner.project != project || binding.project != owner.project {
        return quiet(RunOutcome::WrongProject, continuation);
    }
    if binding.owner_host != owner.owner_host {
        return quiet(RunOutcome::StaleBinding, continuation);
    }
    if binding.generation == 0
        || binding.generation != owner.generation
        || (request.generation != 0 && request.generation != binding.generation)
    {
        return quiet(RunOutcome::GenerationChanged, continuation);
    }
    let status = owner.status.clone();
    if request.consumer_closed {
        return done(
            status,
            RunOutcome::TransportAbort,
            RunEffect::None,
            owner,
            continuation,
        );
    }
    if request.timed_out {
        return done(
            status,
            RunOutcome::Timeout,
            RunEffect::None,
            owner,
            continuation,
        );
    }
    if binding.kind == IdentityKind::AcpSession
        && matches!(
            request.operation,
            RunOperation::Start
                | RunOperation::Retry
                | RunOperation::Cancel
                | RunOperation::Approve
        )
    {
        return done(
            status,
            RunOutcome::Unsupported,
            RunEffect::None,
            owner,
            continuation,
        );
    }
    if let Some(stored) = ledger
        .iter()
        .find(|item| item.request_id == request.request_id)
    {
        if stored.input_hash == request.input_hash && stored.operation == request.operation {
            return done(
                status,
                RunOutcome::Duplicate,
                RunEffect::None,
                owner,
                continuation,
            );
        }
        return quiet(RunOutcome::Conflict, continuation);
    }
    if !owner.live && (owner.restarted || !owner.known) {
        let outcome = if owner.restarted {
            RunOutcome::Interrupted
        } else {
            RunOutcome::Unknown
        };
        return done(
            "interrupted".into(),
            outcome,
            RunEffect::None,
            owner,
            continuation,
        );
    }
    if matches!(request.operation, RunOperation::Start | RunOperation::Retry)
        && owner.known
        && request.operation == RunOperation::Start
    {
        return done(
            status,
            RunOutcome::Observed,
            RunEffect::None,
            owner,
            continuation,
        );
    }
    match request.operation {
        RunOperation::Status | RunOperation::Lookup | RunOperation::Reconnect => {
            let outcome = if owner.status == "failed" {
                RunOutcome::ExecutionFailure
            } else {
                RunOutcome::Observed
            };
            done(status, outcome, RunEffect::None, owner, continuation)
        }
        RunOperation::Events | RunOperation::Replay => events(status, request, owner, continuation),
        RunOperation::Start => done(
            status,
            RunOutcome::Applied,
            RunEffect::ApplyOnce,
            owner,
            continuation,
        ),
        RunOperation::Retry => {
            if owner.known {
                done(
                    status,
                    RunOutcome::Applied,
                    RunEffect::ApplyOnce,
                    owner,
                    continuation,
                )
            } else {
                done(
                    status,
                    RunOutcome::Unknown,
                    RunEffect::None,
                    owner,
                    continuation,
                )
            }
        }
        RunOperation::Cancel => {
            if owner.supports_cancel {
                done(
                    status,
                    RunOutcome::ExecutionCancel,
                    RunEffect::CancelOwner,
                    owner,
                    continuation,
                )
            } else {
                done(
                    status,
                    RunOutcome::Unsupported,
                    RunEffect::None,
                    owner,
                    continuation,
                )
            }
        }
        RunOperation::Approve => {
            if !owner.supports_approve {
                done(
                    status,
                    RunOutcome::Unsupported,
                    RunEffect::None,
                    owner,
                    continuation,
                )
            } else if owner.approval_recorded {
                done(
                    status,
                    RunOutcome::Duplicate,
                    RunEffect::None,
                    owner,
                    continuation,
                )
            } else {
                done(
                    status,
                    RunOutcome::Approved,
                    RunEffect::ApproveOwner,
                    owner,
                    continuation,
                )
            }
        }
    }
}

fn events(
    status: String,
    request: &RunRequest,
    owner: &OwnerView,
    continuation: &'static str,
) -> Observation {
    let cursor = request.cursor.unwrap_or(0);
    if owner.retained_from > 1 && cursor + 1 < owner.retained_from {
        return done(
            status,
            RunOutcome::ExpiredCursor,
            RunEffect::None,
            owner,
            continuation,
        );
    }
    let mut seqs = Vec::new();
    let mut previous = cursor;
    let mut gap = false;
    for seq in &owner.events {
        if *seq <= cursor {
            continue;
        }
        if *seq > previous + 1 {
            gap = true;
            break;
        }
        if seqs.last() == Some(seq) {
            continue;
        }
        seqs.push(*seq);
        previous = *seq;
    }
    let mut observation = done(
        status,
        if gap {
            RunOutcome::Gap
        } else {
            RunOutcome::Observed
        },
        RunEffect::None,
        owner,
        continuation,
    );
    observation.cursor = seqs.last().copied().unwrap_or(cursor);
    observation.events = seqs;
    observation
}

fn quiet(outcome: RunOutcome, continuation: &'static str) -> Observation {
    Observation {
        status: String::new(),
        outcome,
        effect: RunEffect::None,
        cursor: 0,
        events: Vec::new(),
        continuation,
    }
}

fn done(
    status: String,
    outcome: RunOutcome,
    effect: RunEffect,
    owner: &OwnerView,
    continuation: &'static str,
) -> Observation {
    Observation {
        status,
        outcome,
        effect,
        cursor: owner.events.last().copied().unwrap_or(0),
        events: Vec::new(),
        continuation,
    }
}

fn traversed(value: &str) -> bool {
    value.contains("..") || value.contains('/') || value.contains('\\') || value.contains('\0')
}

#[cfg(test)]
mod tests {
    use super::*;

    fn binding(kind: IdentityKind) -> RunBinding {
        RunBinding {
            kind,
            owner_host: "host-a".into(),
            project: "lab".into(),
            id: "run-1".into(),
            generation: 2,
            scope: "lab".into(),
        }
    }

    fn request(operation: RunOperation) -> RunRequest {
        RunRequest {
            operation,
            request_id: "req-1".into(),
            input_hash: "hash-a".into(),
            cursor: None,
            generation: 2,
            consumer_closed: false,
            timed_out: false,
        }
    }

    fn owner() -> OwnerView {
        OwnerView {
            project: "lab".into(),
            owner_host: "host-a".into(),
            live: true,
            known: false,
            restarted: false,
            status: "running".into(),
            events: vec![1, 2, 3],
            retained_from: 1,
            generation: 2,
            supports_cancel: true,
            supports_approve: true,
            approval_recorded: false,
        }
    }

    fn see(operation: RunOperation, owner: OwnerView) -> Observation {
        observe(
            true,
            "lab",
            &binding(IdentityKind::ControlPlaneRun),
            &request(operation),
            &owner,
            &[],
        )
    }

    #[test]
    fn the_same_run_is_observed_without_changing_it() {
        let left = see(RunOperation::Status, owner());
        let right = see(RunOperation::Lookup, owner());
        assert_eq!(left.status, right.status);
        assert_eq!(left.effect, RunEffect::None);
        assert_eq!(binding(IdentityKind::ControlPlaneRun).id, "run-1");
    }

    #[test]
    fn reconnect_retry_and_replay_stay_distinct() {
        let mut closed = request(RunOperation::Cancel);
        closed.consumer_closed = true;
        let abort = observe(
            true,
            "lab",
            &binding(IdentityKind::ControlPlaneRun),
            &closed,
            &owner(),
            &[],
        );
        assert_eq!(
            (abort.outcome, abort.effect),
            (RunOutcome::TransportAbort, RunEffect::None)
        );
        assert_eq!(abort.status, "running");

        let mut timed = request(RunOperation::Status);
        timed.timed_out = true;
        assert_eq!(
            observe(
                true,
                "lab",
                &binding(IdentityKind::ControlPlaneRun),
                &timed,
                &owner(),
                &[]
            )
            .outcome,
            RunOutcome::Timeout
        );

        let failed = OwnerView {
            status: "failed".into(),
            ..owner()
        };
        assert_eq!(
            see(RunOperation::Status, failed).outcome,
            RunOutcome::ExecutionFailure
        );

        let mut known = owner();
        known.known = true;
        assert_eq!(see(RunOperation::Start, known).effect, RunEffect::None);
        assert_eq!(
            see(RunOperation::Start, owner()).effect,
            RunEffect::ApplyOnce
        );
        assert_eq!(
            see(RunOperation::Retry, owner()).outcome,
            RunOutcome::Unknown
        );
        let mut original = owner();
        original.known = true;
        assert_eq!(
            see(RunOperation::Retry, original).effect,
            RunEffect::ApplyOnce
        );

        let mut replay = request(RunOperation::Replay);
        replay.cursor = Some(1);
        let mut gapped = owner();
        gapped.events = vec![1, 1, 3];
        let gap = observe(
            true,
            "lab",
            &binding(IdentityKind::ControlPlaneRun),
            &replay,
            &gapped,
            &[],
        );
        assert_eq!(gap.outcome, RunOutcome::Gap);
        assert_eq!(gap.events, Vec::<u64>::new());

        let mut ordered = request(RunOperation::Events);
        ordered.cursor = Some(1);
        let events = observe(
            true,
            "lab",
            &binding(IdentityKind::ControlPlaneRun),
            &ordered,
            &owner(),
            &[],
        );
        assert_eq!(events.events, vec![2, 3]);

        let mut expired = request(RunOperation::Events);
        expired.cursor = Some(0);
        let mut dropped = owner();
        dropped.retained_from = 3;
        assert_eq!(
            observe(
                true,
                "lab",
                &binding(IdentityKind::ControlPlaneRun),
                &expired,
                &dropped,
                &[]
            )
            .outcome,
            RunOutcome::ExpiredCursor
        );
    }

    #[test]
    fn duplicates_restarts_and_approvals_do_not_invent_work() {
        let stored = [StoredReceipt {
            request_id: "req-1".into(),
            operation: RunOperation::Start,
            input_hash: "hash-a".into(),
            outcome: RunOutcome::Applied,
        }];
        assert_eq!(
            observe(
                true,
                "lab",
                &binding(IdentityKind::ControlPlaneRun),
                &request(RunOperation::Start),
                &owner(),
                &stored
            )
            .outcome,
            RunOutcome::Duplicate
        );
        let mut changed = request(RunOperation::Start);
        changed.input_hash = "hash-b".into();
        assert_eq!(
            observe(
                true,
                "lab",
                &binding(IdentityKind::ControlPlaneRun),
                &changed,
                &owner(),
                &stored
            )
            .outcome,
            RunOutcome::Conflict
        );

        let mut down = owner();
        down.live = false;
        down.restarted = true;
        let restarted = see(RunOperation::Status, down);
        assert_eq!(restarted.outcome, RunOutcome::Interrupted);
        assert_eq!(restarted.effect, RunEffect::None);

        assert_eq!(
            see(RunOperation::Cancel, owner()).effect,
            RunEffect::CancelOwner
        );
        let mut quiet = owner();
        quiet.supports_cancel = false;
        assert_eq!(
            see(RunOperation::Cancel, quiet).outcome,
            RunOutcome::Unsupported
        );

        assert_eq!(
            see(RunOperation::Approve, owner()).effect,
            RunEffect::ApproveOwner
        );
        let mut decided = owner();
        decided.approval_recorded = true;
        assert_eq!(see(RunOperation::Approve, decided).effect, RunEffect::None);

        let mut stale = request(RunOperation::Status);
        stale.generation = 1;
        assert_eq!(
            observe(
                true,
                "lab",
                &binding(IdentityKind::ControlPlaneRun),
                &stale,
                &owner(),
                &[]
            )
            .outcome,
            RunOutcome::GenerationChanged
        );
        assert_eq!(
            observe(
                false,
                "lab",
                &binding(IdentityKind::ControlPlaneRun),
                &request(RunOperation::Status),
                &owner(),
                &[]
            )
            .outcome,
            RunOutcome::Revoked
        );
        assert_eq!(
            observe(
                true,
                "other",
                &binding(IdentityKind::ControlPlaneRun),
                &request(RunOperation::Status),
                &owner(),
                &[]
            )
            .outcome,
            RunOutcome::WrongProject
        );

        let acp = observe(
            true,
            "lab",
            &binding(IdentityKind::AcpSession),
            &request(RunOperation::Start),
            &owner(),
            &[],
        );
        assert_eq!(acp.outcome, RunOutcome::Unsupported);
        assert_eq!(acp.continuation, "unsupported");
        let watched = observe(
            true,
            "lab",
            &binding(IdentityKind::AcpSession),
            &request(RunOperation::Status),
            &owner(),
            &[],
        );
        assert_eq!(watched.continuation, "unsupported");
        assert_eq!(watched.effect, RunEffect::None);
    }
}
