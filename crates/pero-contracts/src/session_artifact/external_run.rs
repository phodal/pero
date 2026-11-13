//! Observed external execution, retained beside a delivered output. No scientific verdict.
use super::{
    ArtifactError, ArtifactRelationRole, MAX_ARTIFACT_RELATIONS, identifier, snapshot_digest,
};
use serde::Deserialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExternalRunOutcome {
    Succeeded,
    Failed,
    Cancelled,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExternalRunOutputKind {
    /// A wrapper's report of a run, rather than a file created by the recorded command.
    RunReport,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExternalRunInvocation {
    pub command: String,
    pub args: Vec<String>,
    /// The recorded workspace root. Absolute argument paths remain explicit portability limits.
    pub cwd: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExternalRunExecution {
    pub started_at: String,
    pub finished_at: String,
    pub exit_code: Option<i32>,
    pub signal: Option<String>,
    #[serde(default)]
    pub spawn_error: Option<String>,
    #[serde(default)]
    pub cancellation_requested: bool,
}

/// Versions 1 and 2 share the original evidence store. V1 has no observed invocation.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExternalRunManifest {
    pub schema_version: u32,
    pub system: String,
    pub run_id: String,
    pub outcome: ExternalRunOutcome,
    pub output_sha256: String,
    pub evidence: Vec<ExternalRunEvidence>,
    #[serde(default)]
    pub output_path: Option<String>,
    #[serde(default)]
    pub output_kind: Option<ExternalRunOutputKind>,
    #[serde(default)]
    pub invocation: Option<ExternalRunInvocation>,
    #[serde(default)]
    pub execution: Option<ExternalRunExecution>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExternalRunEvidence {
    pub path: String,
    pub role: ArtifactRelationRole,
    pub sha256: String,
    /// Original workspace path for a code/input file frozen before execution.
    #[serde(default)]
    pub source_path: Option<String>,
}

fn workspace_path(path: &str) -> bool {
    !path.is_empty()
        && !path.starts_with('/')
        && !path.contains(['\\', '\0', ':'])
        && path
            .split('/')
            .all(|part| !part.is_empty() && part != "." && part != "..")
}

impl ExternalRunManifest {
    pub fn validate(&self) -> Result<(), ArtifactError> {
        if !matches!(self.schema_version, 1 | 2)
            || !identifier(&self.system)
            || !identifier(&self.run_id)
            || !snapshot_digest(&self.output_sha256)
            || self.evidence.len() >= MAX_ARTIFACT_RELATIONS
            || self.evidence.iter().any(|item| {
                item.path.is_empty()
                    || !snapshot_digest(&item.sha256)
                    || item.role == ArtifactRelationRole::RunRecord
                    || item
                        .source_path
                        .as_ref()
                        .is_some_and(|path| !workspace_path(path))
            })
        {
            return Err(ArtifactError::Source);
        }
        // Existing receipts remain honest partial records; do not invent execution observations.
        if self.schema_version == 1 {
            if self.invocation.is_some()
                || self.execution.is_some()
                || self.output_path.is_some()
                || self.output_kind.is_some()
                || self.evidence.iter().any(|item| item.source_path.is_some())
            {
                return Err(ArtifactError::Source);
            }
            return Ok(());
        }
        let (Some(invocation), Some(execution), Some(output)) =
            (&self.invocation, &self.execution, &self.output_path)
        else {
            return Err(ArtifactError::Source);
        };
        if !workspace_path(output)
            || self.evidence.iter().any(|item| !workspace_path(&item.path))
            || invocation.command.is_empty()
            || invocation.command.contains('\0')
            || invocation.args.iter().any(|arg| arg.contains('\0'))
            || invocation.cwd != "."
            || execution.started_at.is_empty()
            || execution.finished_at.is_empty()
            || execution
                .signal
                .as_ref()
                .is_some_and(|signal| signal.is_empty())
            || execution
                .spawn_error
                .as_ref()
                .is_some_and(|error| error.is_empty())
        {
            return Err(ArtifactError::Source);
        }
        let cancelled = execution.cancellation_requested || execution.signal.is_some();
        let consistent = match self.outcome {
            ExternalRunOutcome::Succeeded => {
                !cancelled && execution.exit_code == Some(0) && execution.spawn_error.is_none()
            }
            ExternalRunOutcome::Failed => {
                !cancelled
                    && (execution.spawn_error.is_some()
                        || execution.exit_code.is_some_and(|code| code != 0))
            }
            ExternalRunOutcome::Cancelled => cancelled,
        };
        if !consistent {
            return Err(ArtifactError::Source);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn execution_receipts_preserve_observed_outcomes_and_legacy_gaps() {
        let legacy = json!({"schema_version":1,"system":"solver","run_id":"first",
            "outcome":"succeeded","output_sha256":"a".repeat(64),"evidence":[]});
        let mut current = legacy.clone();
        current["schema_version"] = json!(2);
        current["output_path"] = json!("results/output.csv");
        current["invocation"] = json!({"command":"python3","args":["analysis.py"],"cwd":"."});
        current["execution"] = json!({"started_at":"2026-11-13T08:00:00Z","finished_at":"2026-11-13T08:00:01Z","exit_code":0,"signal":null});
        let mut cases = vec![
            ("legacy without observations", legacy, true),
            ("complete success", current.clone(), true),
        ];
        for (name, outcome, exit, signal, requested, valid) in [
            ("failure", "failed", Some(1), None, false, true),
            ("signal", "cancelled", None, Some("SIGINT"), false, true),
            (
                "caught cancellation",
                "cancelled",
                Some(0),
                None,
                true,
                true,
            ),
            ("false success", "succeeded", Some(1), None, false, false),
            ("false failure", "failed", Some(0), None, false, false),
            (
                "false cancellation",
                "cancelled",
                Some(0),
                None,
                false,
                false,
            ),
            ("cancelled success", "succeeded", Some(0), None, true, false),
        ] {
            let mut receipt = current.clone();
            receipt["outcome"] = json!(outcome);
            receipt["execution"]["exit_code"] = json!(exit);
            receipt["execution"]["signal"] = json!(signal);
            receipt["execution"]["cancellation_requested"] = json!(requested);
            cases.push((name, receipt, valid));
        }
        let mut missing = current.clone();
        missing.as_object_mut().unwrap().remove("invocation");
        cases.push(("unobserved invocation", missing, false));
        let mut escape = current.clone();
        escape["output_path"] = json!("../output.csv");
        cases.push(("nonportable output", escape, false));
        let mut spawn = current.clone();
        spawn["outcome"] = json!("failed");
        spawn["execution"]["exit_code"] = json!(null);
        spawn["execution"]["spawn_error"] = json!("ENOENT");
        cases.push(("launch failure", spawn, true));
        for (name, value, accepted) in cases {
            let receipt: ExternalRunManifest = serde_json::from_value(value).unwrap();
            assert_eq!(receipt.validate().is_ok(), accepted, "{name}");
        }
    }
}
