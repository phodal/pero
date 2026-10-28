//! How Desktop presents a Cloud Task's delegation lifecycle. The list group,
//! the progress stage and the status label all come from one `Phase`.

/// Delegation progress shown as a stepper. Verification and acceptance are
/// separate decisions; an Agent outcome never advances past `AgentDone`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Stage {
    Created,
    Delegated,
    Executing,
    AgentDone,
    Verified,
    Accepted,
}

impl Stage {
    pub const ALL: [Stage; 6] = [
        Stage::Created,
        Stage::Delegated,
        Stage::Executing,
        Stage::AgentDone,
        Stage::Verified,
        Stage::Accepted,
    ];
    pub fn label_key(self) -> &'static str {
        match self {
            Stage::Created => "cloud.stage.created",
            Stage::Delegated => "cloud.stage.delegated",
            Stage::Executing => "cloud.stage.executing",
            Stage::AgentDone => "cloud.stage.agent_done",
            Stage::Verified => "cloud.stage.verified",
            Stage::Accepted => "cloud.stage.accepted",
        }
    }
}

/// Task list sections, in display order.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Group {
    Attention,
    Running,
    Queued,
    Ready,
    Ended,
}

impl Group {
    pub const ALL: [Group; 5] = [
        Group::Attention,
        Group::Running,
        Group::Queued,
        Group::Ready,
        Group::Ended,
    ];
    pub fn label_key(self) -> &'static str {
        match self {
            Group::Attention => "cloud.group.attention",
            Group::Running => "cloud.group.running",
            Group::Queued => "cloud.group.queued",
            Group::Ready => "cloud.group.ready",
            Group::Ended => "cloud.group.ended",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Tone {
    Muted,
    Info,
    Warning,
    Success,
    Danger,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Phase {
    Draft,
    Queued,
    Running,
    Stopping,
    Succeeded,
    Failed,
    Reconcile,
    Cancelled,
    SourceClosed,
}

impl Phase {
    /// `state` is the Task status from Cloud. A closed or missing source only
    /// ends a Task that has no execution of its own to report.
    pub fn of(state: &str, source_closed: bool) -> Self {
        let phase = match state {
            "queued" => Phase::Queued,
            "running" => Phase::Running,
            "cancel_requested" => Phase::Stopping,
            "succeeded" => Phase::Succeeded,
            "failed" => Phase::Failed,
            "reconcile" => Phase::Reconcile,
            "cancelled" => Phase::Cancelled,
            _ => Phase::Draft,
        };
        if source_closed && phase == Phase::Draft {
            Phase::SourceClosed
        } else {
            phase
        }
    }
    pub fn group(self) -> Group {
        match self {
            Phase::Succeeded | Phase::Failed | Phase::Reconcile => Group::Attention,
            Phase::Running | Phase::Stopping => Group::Running,
            Phase::Queued => Group::Queued,
            Phase::Draft => Group::Ready,
            Phase::Cancelled | Phase::SourceClosed => Group::Ended,
        }
    }
    /// The current stage and whether execution stopped there.
    pub fn stage(self) -> (Stage, bool) {
        match self {
            Phase::Draft | Phase::SourceClosed => (Stage::Delegated, false),
            Phase::Queued | Phase::Running | Phase::Stopping => (Stage::Executing, false),
            Phase::Failed | Phase::Reconcile | Phase::Cancelled => (Stage::Executing, true),
            Phase::Succeeded => (Stage::Verified, false),
        }
    }
    pub fn label_key(self) -> &'static str {
        match self {
            Phase::Draft => "cloud.phase.draft",
            Phase::Queued => "cloud.phase.queued",
            Phase::Running => "cloud.phase.running",
            Phase::Stopping => "cloud.phase.stopping",
            Phase::Succeeded => "cloud.phase.succeeded",
            Phase::Failed => "cloud.phase.failed",
            Phase::Reconcile => "cloud.phase.reconcile",
            Phase::Cancelled => "cloud.phase.cancelled",
            Phase::SourceClosed => "cloud.phase.source_closed",
        }
    }
    pub fn tone(self) -> Tone {
        match self {
            Phase::Draft | Phase::Cancelled | Phase::SourceClosed => Tone::Muted,
            Phase::Running => Tone::Info,
            Phase::Queued | Phase::Stopping => Tone::Warning,
            Phase::Succeeded => Tone::Success,
            Phase::Failed | Phase::Reconcile => Tone::Danger,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn phases_place_tasks_in_one_group_and_stage() {
        use Group::*;
        use Stage::*;
        for (state, closed, phase, group, stage, stopped) in [
            ("draft", false, Phase::Draft, Ready, Delegated, false),
            ("draft", true, Phase::SourceClosed, Ended, Delegated, false),
            ("queued", false, Phase::Queued, Queued, Executing, false),
            ("running", true, Phase::Running, Running, Executing, false),
            (
                "cancel_requested",
                false,
                Phase::Stopping,
                Running,
                Executing,
                false,
            ),
            (
                "succeeded",
                false,
                Phase::Succeeded,
                Attention,
                Verified,
                false,
            ),
            ("failed", false, Phase::Failed, Attention, Executing, true),
            (
                "reconcile",
                false,
                Phase::Reconcile,
                Attention,
                Executing,
                true,
            ),
            ("cancelled", false, Phase::Cancelled, Ended, Executing, true),
            ("unknown", false, Phase::Draft, Ready, Delegated, false),
        ] {
            let actual = Phase::of(state, closed);
            assert_eq!(actual, phase, "{state} closed={closed}");
            assert_eq!(actual.group(), group, "{state}");
            assert_eq!(actual.stage(), (stage, stopped), "{state}");
        }
    }
}
