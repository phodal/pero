//! Slurm remains the queue/allocation authority. A submission receipt is not a
//! running-node snapshot, and disappearance from scontrol is never proof of stop.
use super::{Command, Path, PathBuf, command_output};
use crate::environments::{
    BatchConstraints, BatchObservation, BatchState, BatchSubmission, ContentDigest, Identity,
};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::{fs, io::Write};

pub struct SlurmSite {
    binaries: PathBuf,
    cluster: Identity,
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
    /// Trusted composition selects these CLI executables. For a remote site the
    /// existing site transport supplies them; App JSON cannot provide commands.
    pub fn connect(binaries: PathBuf, expected_cluster: Identity) -> Result<Self, String> {
        let site = Self {
            binaries,
            cluster: expected_cluster,
        };
        site.jobs(None)?;
        Ok(site)
    }
    fn jobs(&self, job_id: Option<u64>) -> Result<Vec<Job>, String> {
        let mut command = Command::new(self.binaries.join("scontrol"));
        command.args(["--json", "show", "jobs"]);
        if let Some(id) = job_id {
            command.arg(id.to_string());
        }
        let output = command_output(&mut command)?;
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
    ) -> Result<BatchSubmission, String> {
        let payload = payload.canonicalize().map_err(|e| e.to_string())?;
        let directory = directory.canonicalize().map_err(|e| e.to_string())?;
        let bytes = fs::read(&payload).map_err(|e| e.to_string())?;
        let digest: ContentDigest = format!("{:x}", Sha256::digest(&bytes)).try_into().unwrap();
        let marker = format!("pero:{}", ContentDigest::of(&operation).as_str());
        let intent = serde_json::json!({"operation":operation,"cluster":self.cluster,"constraints":constraints,"payload":digest});
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
        let output = command_output(
            Command::new(self.binaries.join("sbatch"))
                .args([
                    "--parsable",
                    "--no-requeue",
                    "--comment",
                    &marker,
                    "--partition",
                    constraints.partition().as_str(),
                    "--cpus-per-task",
                    &constraints.cpus().to_string(),
                    "--mem",
                    &format!("{}M", constraints.memory_mib()),
                    "--time",
                    &walltime,
                    "--output",
                    "stdout.log",
                    "--error",
                    "stderr.log",
                    "--chdir",
                ])
                .arg(directory)
                .args(["--wrap", &script]),
        )?;
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
        let job = self
            .jobs(Some(job_id))?
            .into_iter()
            .find(|j| j.job_id == job_id && j.comment == marker && j.cluster == self.cluster)
            .ok_or("Submitted job cannot be reconciled; do not resubmit")?;
        let submission = BatchSubmission {
            operation,
            cluster: self.cluster.clone(),
            constraints,
            payload: digest,
            job_id,
            submit_time: job
                .submit_time
                .value()
                .ok_or("Slurm submit time unavailable")?,
        };
        let receipt = record.with_extension("receipt.json");
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(receipt)
            .map_err(|e| e.to_string())?;
        file.write_all(&serde_json::to_vec_pretty(&submission).map_err(|e| e.to_string())?)
            .and_then(|_| file.sync_all())
            .map_err(|e| e.to_string())?;
        Ok(submission)
    }
    pub fn observe(&self, submission: &BatchSubmission) -> Result<BatchObservation, String> {
        let job = self.jobs(Some(submission.job_id))?.into_iter().find(|j| j.job_id == submission.job_id)
            .ok_or("Original job is absent from controller history; reconcile accounting, do not infer stopped")?;
        let marker = format!("pero:{}", ContentDigest::of(&submission.operation).as_str());
        if job.cluster != submission.cluster
            || job.submit_time.value() != Some(submission.submit_time)
            || job.comment != marker
        {
            return Err("Slurm numeric job ID now refers to a different submission".into());
        }
        Ok(BatchObservation {
            submission: submission.clone(),
            states: job.job_state,
            nodes: job.nodes,
            start_time: job.start_time.value(),
            end_time: job.end_time.value(),
        })
    }
    pub fn cancel(&self, submission: &BatchSubmission) -> Result<BatchObservation, String> {
        let observed = self.observe(submission)?;
        if observed.stopped() {
            return Ok(observed);
        }
        let result = command_output(
            Command::new(self.binaries.join("scancel")).arg(submission.job_id.to_string()),
        )?;
        if !result.status.success() {
            return Err("Original Slurm cancellation is unconfirmed".into());
        }
        // scancel success is an intent. Caller polls until the original job is terminal.
        self.observe(submission)
    }
}
fn quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}
