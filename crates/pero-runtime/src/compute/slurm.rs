//! Slurm remains the queue/allocation authority. A submission receipt is not a
//! running-node snapshot, and disappearance from scontrol is never proof of stop.
use super::{Command, Path, PathBuf, SshTransport, command_output};
use crate::environments::{
    BatchConstraints, BatchObservation, BatchState, BatchSubmission, ContentDigest, Identity,
};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::{fs, io::Write};

/// An admitted method's fixed batch handoff. Only the Host composition supplies
/// site paths; this value is never deserialized from an App command body.
pub struct SlurmInvocation<'a> {
    pub operation: Identity,
    pub constraints: BatchConstraints,
    pub payload: ContentDigest,
    pub entry: &'a Path,
    pub directory: &'a Path,
    pub account: Option<&'a Identity>,
}
pub struct SlurmSite {
    binaries: PathBuf,
    cluster: Identity,
    transport: Option<SshTransport>,
}
#[derive(Deserialize)]
struct Controller {
    meta: Meta,
}
#[derive(Deserialize)]
struct JobList {
    jobs: Vec<Job>,
    meta: Meta,
}
#[derive(Deserialize)]
struct Meta {
    slurm: SlurmMeta,
}
#[derive(Deserialize)]
struct SlurmMeta {
    cluster: Identity,
}
#[derive(Deserialize)]
struct Job {
    job_id: u64,
    cluster: Identity,
    comment: String,
    submit_time: Number,
    start_time: Number,
    end_time: Number,
    job_state: Vec<BatchState>,
    nodes: String,
}
#[derive(Deserialize)]
struct Number {
    set: bool,
    infinite: bool,
    number: u64,
}
impl Number {
    fn value(&self) -> Option<u64> {
        (self.set && !self.infinite && self.number > 0).then_some(self.number)
    }
}
impl SlurmSite {
    /// Local CLI and SSH share the same submission/observation rules.
    pub fn connect(binaries: PathBuf, expected_cluster: Identity) -> Result<Self, String> {
        let site = Self {
            binaries,
            cluster: expected_cluster,
            transport: None,
        };
        let actual = site.controller()?;
        if actual != site.cluster {
            return Err("Slurm cluster identity changed".into());
        }
        Ok(site)
    }
    pub fn connect_ssh(
        transport: SshTransport,
        binaries: PathBuf,
        expected_cluster: Identity,
    ) -> Result<Self, String> {
        let site = Self {
            binaries,
            cluster: expected_cluster,
            transport: Some(transport),
        };
        if site.controller()? != site.cluster {
            return Err("Slurm cluster identity changed".into());
        }
        Ok(site)
    }
    /// Discover the controller's identity during an explicit connection probe.
    pub fn probe_ssh(transport: SshTransport, binaries: PathBuf) -> Result<Self, String> {
        let mut site = Self {
            binaries,
            cluster: "probe".to_owned().try_into().unwrap(),
            transport: Some(transport),
        };
        site.cluster = site.controller()?;
        Ok(site)
    }
    pub fn cluster(&self) -> &Identity {
        &self.cluster
    }
    fn run(&self, binary: &str, arguments: &[String]) -> Result<std::process::Output, String> {
        let program = self.binaries.join(binary);
        match &self.transport {
            Some(transport) => transport.run(&program, arguments),
            None => command_output(Command::new(program).args(arguments)),
        }
    }
    fn controller(&self) -> Result<Identity, String> {
        let output = self.run("scontrol", &["--json".into(), "ping".into()])?;
        if !output.status.success() {
            return Err("Slurm controller is unavailable".into());
        }
        let controller: Controller =
            serde_json::from_slice(&output.stdout).map_err(|e| e.to_string())?;
        Ok(controller.meta.slurm.cluster)
    }
    fn jobs(&self, job_id: u64) -> Result<Vec<Job>, String> {
        let output = self.run(
            "scontrol",
            &[
                "--json".into(),
                "show".into(),
                "jobs".into(),
                job_id.to_string(),
            ],
        )?;
        if !output.status.success() {
            return Err("Slurm observation unavailable; original job state is unknown".into());
        }
        let observed: JobList = serde_json::from_slice(&output.stdout)
            .map_err(|e| format!("Unsupported Slurm JSON observation: {e}"))?;
        if observed.meta.slurm.cluster != self.cluster {
            return Err("Slurm cluster identity changed".into());
        }
        Ok(observed.jobs)
    }
    /// Payload is a fixed executable in the selected site's filesystem. Its
    /// digest is checked inside the allocation before executing scientific work.
    /// Directory/input staging and scientific approval belong to the method owner.
    pub fn submit(
        &self,
        operation: Identity,
        constraints: BatchConstraints,
        payload: &Path,
        directory: &Path,
        record: &Path,
        executions: &Path,
    ) -> Result<BatchSubmission, String> {
        let payload = payload.canonicalize().map_err(|e| e.to_string())?;
        let directory = directory.canonicalize().map_err(|e| e.to_string())?;
        let bytes = fs::read(&payload).map_err(|e| e.to_string())?;
        let digest: ContentDigest = format!("{:x}", Sha256::digest(&bytes)).try_into().unwrap();
        self.submit_staged(
            SlurmInvocation {
                operation,
                constraints,
                payload: digest,
                entry: &payload,
                directory: &directory,
                account: None,
            },
            record,
            executions,
        )
    }
    /// The method owner staged and froze these bytes before approval. Payload and
    /// working directory are absolute paths on the selected remote site.
    pub fn submit_staged(
        &self,
        invocation: SlurmInvocation<'_>,
        record: &Path,
        executions: &Path,
    ) -> Result<BatchSubmission, String> {
        let SlurmInvocation {
            operation,
            constraints,
            payload: digest,
            entry: payload,
            directory,
            account,
        } = invocation;
        if !payload.is_absolute() || !directory.is_absolute() {
            return Err("Slurm payload and attempt directory must be absolute".into());
        }
        let marker = format!("pero:{}", ContentDigest::of(&operation).as_str());
        let intent = serde_json::json!({"operation":operation,"cluster":self.cluster,"constraints":constraints,"account":account,"payload":digest});
        // Exclusive intent prevents replay even if sbatch's response is lost.
        let mut intent_file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(record)
            .map_err(|e| {
                format!(
                    "Submission exists or cannot be recorded; reconcile original operation: {e}"
                )
            })?;
        intent_file
            .write_all(&serde_json::to_vec(&intent).map_err(|e| e.to_string())?)
            .and_then(|_| intent_file.sync_all())
            .map_err(|e| e.to_string())?;
        let payload_arg = quote(payload.to_str().ok_or("Site payload path must be UTF-8")?);
        // The wrapper runs only after Slurm allocates a node. Captured facts are
        // retained beside outputs and are distinct from requested constraints.
        let script = format!(
            "set -eu\nactual=$(sha256sum -- {payload_arg})\n[ \"${{actual%% *}}\" = '{}' ] || exit 125\n[ \"${{SLURM_CPUS_PER_TASK:-0}}\" -ge {} ] || exit 125\nprintf '%s\\n' \"job=$SLURM_JOB_ID\" \"nodes=$SLURM_JOB_NODELIST\" \"cpus=$SLURM_CPUS_PER_TASK\" \"payload={}\" > allocation.txt\nexec {payload_arg}",
            digest.as_str(),
            constraints.cpus(),
            digest.as_str()
        );
        let seconds = constraints.walltime_seconds();
        let walltime = format!(
            "{}:{:02}:{:02}",
            seconds / 3600,
            (seconds / 60) % 60,
            seconds % 60
        );
        let mut arguments = vec![
            "--parsable".into(),
            "--no-requeue".into(),
            "--comment".into(),
            marker.clone(),
            "--partition".into(),
            constraints.partition().as_str().into(),
            "--cpus-per-task".into(),
            constraints.cpus().to_string(),
            "--mem".into(),
            format!("{}M", constraints.memory_mib()),
            "--time".into(),
            walltime,
            "--output".into(),
            "stdout.log".into(),
            "--error".into(),
            "stderr.log".into(),
            "--chdir".into(),
            directory
                .to_str()
                .ok_or("Site directory must be UTF-8")?
                .into(),
            "--wrap".into(),
            script,
        ];
        if let Some(account) = account {
            arguments.extend(["--account".into(), account.as_str().into()]);
        }
        let output = self.run("sbatch", &arguments)?;
        if !output.status.success() {
            return Err(format!(
                "Slurm submission unconfirmed; reconcile marker {marker}: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }
        let raw = String::from_utf8_lossy(&output.stdout);
        let mut response = raw.trim().split(';');
        let job_id: u64 = response
            .next()
            .ok_or("Missing Slurm job receipt")?
            .parse()
            .map_err(|_| "Invalid Slurm job receipt")?;
        if response
            .next()
            .is_some_and(|cluster| cluster != self.cluster.as_str())
            || job_id == 0
        {
            return Err("Slurm submission receipt belongs to another cluster".into());
        }
        let reconcile = |reason: String| {
            format!(
                "Submitted Slurm job {job_id}, marker {marker}: {reason}; reconcile original job, do not resubmit"
            )
        };
        let job = self
            .jobs(job_id)
            .map_err(&reconcile)?
            .into_iter()
            .find(|j| j.job_id == job_id && j.comment == marker && j.cluster == self.cluster)
            .ok_or_else(|| reconcile("Job identity unavailable".into()))?;
        let submission = BatchSubmission {
            operation,
            cluster: self.cluster.clone(),
            constraints,
            payload: digest,
            job_id,
            submit_time: job
                .submit_time
                .value()
                .ok_or_else(|| reconcile("Submit time unavailable".into()))?,
        };
        super::store_batch_receipt(executions, &submission, None).map_err(&reconcile)?;
        Ok(submission)
    }
    pub fn observe(
        &self,
        executions: &Path,
        submission: &BatchSubmission,
    ) -> Result<BatchObservation, String> {
        let job = self.jobs(submission.job_id)?.into_iter().find(|j| j.job_id == submission.job_id)
            .ok_or("Original job is absent from controller history; reconcile accounting, do not infer stopped")?;
        let marker = format!("pero:{}", ContentDigest::of(&submission.operation).as_str());
        if job.cluster != submission.cluster
            || job.submit_time.value() != Some(submission.submit_time)
            || job.comment != marker
        {
            return Err("Slurm numeric job ID now refers to a different submission".into());
        }
        let observed = BatchObservation {
            submission: submission.clone(),
            states: job.job_state,
            nodes: job.nodes,
            start_time: job.start_time.value(),
            end_time: job.end_time.value(),
        };
        super::store_batch_receipt(executions, submission, Some(&observed))?;
        Ok(observed)
    }
    pub fn cancel(
        &self,
        executions: &Path,
        submission: &BatchSubmission,
    ) -> Result<BatchObservation, String> {
        let observed = self.observe(executions, submission)?;
        if observed.stopped() {
            return Ok(observed);
        }
        let result = self.run("scancel", &[submission.job_id.to_string()]);
        // A job may finish while scancel is in flight. Its observed terminal
        // receipt is authoritative even if the cancellation reply was lost.
        let observed = self.observe(executions, submission)?;
        if observed.stopped() || result.as_ref().is_ok_and(|r| r.status.success()) {
            Ok(observed)
        } else {
            Err("Original Slurm cancellation is unconfirmed".into())
        }
    }
}
fn quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}
