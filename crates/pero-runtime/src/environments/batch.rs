//! Submission constraints are approved before an allocation exists. They are
//! requested limits, never evidence of allocated or enforced resources.
use super::{ContentDigest, EnvironmentError, Identity};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "BatchConstraintsInput")]
pub struct BatchConstraints {
    partition: Identity,
    cpus: u16,
    memory_mib: u32,
    walltime_seconds: u32,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct BatchConstraintsInput {
    partition: Identity,
    cpus: u16,
    memory_mib: u32,
    walltime_seconds: u32,
}
impl TryFrom<BatchConstraintsInput> for BatchConstraints {
    type Error = EnvironmentError;
    fn try_from(v: BatchConstraintsInput) -> Result<Self, Self::Error> {
        Self::new(v.partition, v.cpus, v.memory_mib, v.walltime_seconds)
    }
}
impl BatchConstraints {
    pub fn new(
        partition: Identity,
        cpus: u16,
        memory_mib: u32,
        walltime_seconds: u32,
    ) -> Result<Self, EnvironmentError> {
        if cpus == 0 || memory_mib == 0 || walltime_seconds == 0 {
            return Err(EnvironmentError::Invalid(
                "positive batch resource constraints",
            ));
        }
        Ok(Self {
            partition,
            cpus,
            memory_mib,
            walltime_seconds,
        })
    }
    pub fn partition(&self) -> &Identity {
        &self.partition
    }
    pub fn cpus(&self) -> u16 {
        self.cpus
    }
    pub fn memory_mib(&self) -> u32 {
        self.memory_mib
    }
    pub fn walltime_seconds(&self) -> u32 {
        self.walltime_seconds
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum BatchState {
    Pending,
    Running,
    Completing,
    Configuring,
    Suspended,
    Completed,
    Cancelled,
    Failed,
    Timeout,
    NodeFail,
    OutOfMemory,
    BootFail,
    Deadline,
    Preempted,
    #[serde(other)]
    Unknown,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BatchSubmission {
    pub operation: Identity,
    pub cluster: Identity,
    pub constraints: BatchConstraints,
    pub payload: ContentDigest,
    pub job_id: u64,
    pub submit_time: u64,
}
impl BatchSubmission {
    /// One file name for this submission and every later observation of it.
    pub fn receipt_id(&self) -> ContentDigest {
        ContentDigest::of(&(
            &self.operation,
            &self.cluster,
            self.job_id,
            self.submit_time,
        ))
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BatchObservation {
    pub submission: BatchSubmission,
    pub states: Vec<BatchState>,
    pub nodes: String,
    pub start_time: Option<u64>,
    pub end_time: Option<u64>,
}
impl BatchObservation {
    /// Terminal observation of the original no-requeue job, not a local guess.
    pub fn stopped(&self) -> bool {
        !self.states.is_empty()
            && self.end_time.is_some()
            && self.states.iter().all(|state| {
                matches!(
                    state,
                    BatchState::Completed
                        | BatchState::Cancelled
                        | BatchState::Failed
                        | BatchState::Timeout
                        | BatchState::NodeFail
                        | BatchState::OutOfMemory
                        | BatchState::BootFail
                        | BatchState::Deadline
                        | BatchState::Preempted
                )
            })
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn submission_and_allocated_stop_are_separate_facts() {
        let id = |s: &str| Identity::try_from(s.to_owned()).unwrap();
        let submission = BatchSubmission {
            operation: id("attempt"),
            cluster: id("site"),
            constraints: BatchConstraints::new(id("partition"), 1, 32, 60).unwrap(),
            payload: ContentDigest::of(&"payload"),
            job_id: 1,
            submit_time: 10,
        };
        for (states, end_time, expected) in [
            (vec![BatchState::Pending], None, false),
            (vec![BatchState::Running], Some(100), false),
            (
                vec![BatchState::Cancelled, BatchState::Completing],
                Some(100),
                false,
            ),
            (vec![BatchState::Completed], None, false),
            (vec![BatchState::Cancelled], Some(100), true),
            (vec![BatchState::Completed], Some(100), true),
            (vec![BatchState::Unknown], Some(100), false),
            (vec![], Some(100), false),
        ] {
            let observed = BatchObservation {
                submission: submission.clone(),
                states,
                nodes: String::new(),
                start_time: None,
                end_time,
            };
            assert_eq!(observed.stopped(), expected, "{:?}", observed.states);
        }
    }
}
