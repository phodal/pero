//! The execution owner writes one receipt file. A later observation replaces
//! that file. This is not a second ledger and it does not scan a workspace.
use crate::environments::{BatchObservation, BatchSubmission, ContentDigest, Identity};
use serde::{Deserialize, Serialize};
use std::{fs, io::Write, path::Path};

/// A managed process fact. It has no scheduler job and no scientific verdict.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProcessReceipt {
    pub operation: Identity,
    pub host: Identity,
    pub payload: ContentDigest,
    pub started: u64,
    pub ended: Option<u64>,
    pub exit_code: Option<u8>,
    /// The owner could not confirm how the process stopped. No exit or end is recorded.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub unconfirmed: bool,
    pub entry: Option<String>,
    pub snapshot: Option<ContentDigest>,
    pub logs: Vec<String>,
}
impl ProcessReceipt {
    fn receipt_id(&self) -> ContentDigest {
        ContentDigest::of(&(&self.operation, &self.host, self.started, &self.payload))
    }
}

pub fn store_batch_receipt(
    directory: &Path,
    submission: &BatchSubmission,
    observation: Option<&BatchObservation>,
) -> Result<(), String> {
    let id = submission.receipt_id();
    let body = match observation {
        Some(observation) => serde_json::to_vec_pretty(observation).map_err(|e| e.to_string())?,
        None => serde_json::to_vec_pretty(submission).map_err(|e| e.to_string())?,
    };
    publish(directory, &id, &body)
}

pub fn store_process_receipt(directory: &Path, receipt: &ProcessReceipt) -> Result<(), String> {
    if receipt.started == 0 {
        return Err("Process receipt needs the caller's start time".into());
    }
    if receipt.ended.is_some_and(|ended| ended < receipt.started) {
        return Err("Process receipt end is before its start".into());
    }
    if receipt.unconfirmed && (receipt.exit_code.is_some() || receipt.ended.is_some()) {
        return Err("An unconfirmed process stop has no exit or end".into());
    }
    let body = serde_json::to_vec_pretty(receipt).map_err(|e| e.to_string())?;
    publish(directory, &receipt.receipt_id(), &body)
}

fn publish(directory: &Path, id: &ContentDigest, body: &[u8]) -> Result<(), String> {
    if body.len() > 64 * 1024 {
        return Err("Execution receipt exceeds 64 KiB".into());
    }
    fs::create_dir_all(directory).map_err(|e| e.to_string())?;
    let final_path = directory.join(format!("{}.json", id.as_str()));
    let temporary = directory.join(format!(".{}.json.partial", id.as_str()));
    let _ = fs::remove_file(&temporary);
    {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|e| e.to_string())?;
        file.write_all(body)
            .and_then(|_| file.sync_all())
            .map_err(|e| e.to_string())?;
    }
    fs::rename(temporary, final_path).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::environments::{BatchConstraints, BatchObservation, BatchState};

    fn id(value: &str) -> Identity {
        value.to_owned().try_into().unwrap()
    }
    fn submission() -> BatchSubmission {
        BatchSubmission {
            operation: id("attempt"),
            cluster: id("site"),
            constraints: BatchConstraints::new(id("cpu"), 1, 32, 60).unwrap(),
            payload: ContentDigest::of(&"payload"),
            job_id: 42,
            submit_time: 10,
        }
    }

    #[test]
    fn observation_replaces_the_submission_file() {
        let directory = std::env::temp_dir().join(format!("pero-receipt-{}", std::process::id()));
        let _ = fs::remove_dir_all(&directory);
        let submitted = submission();
        store_batch_receipt(&directory, &submitted, None).unwrap();
        let observed = BatchObservation {
            submission: submitted.clone(),
            states: vec![BatchState::Completed],
            nodes: "n1".into(),
            start_time: Some(10),
            end_time: Some(20),
        };
        store_batch_receipt(&directory, &submitted, Some(&observed)).unwrap();
        let files: Vec<_> = fs::read_dir(&directory)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().into_string().unwrap())
            .filter(|name| !name.starts_with('.'))
            .collect();
        assert_eq!(files.len(), 1);
        let body: BatchObservation =
            serde_json::from_slice(&fs::read(directory.join(&files[0])).unwrap()).unwrap();
        assert_eq!(body.states, vec![BatchState::Completed]);
        assert!(body.end_time == Some(20));
        fs::remove_dir_all(&directory).unwrap();
    }

    #[test]
    fn an_unconfirmed_stop_records_no_exit() {
        let directory =
            std::env::temp_dir().join(format!("pero-receipt-open-{}", std::process::id()));
        let _ = fs::remove_dir_all(&directory);
        let mut receipt = ProcessReceipt {
            operation: id("use"),
            host: id("host"),
            payload: ContentDigest::of(&"payload"),
            started: 10,
            ended: None,
            exit_code: None,
            unconfirmed: true,
            entry: None,
            snapshot: None,
            logs: Vec::new(),
        };
        store_process_receipt(&directory, &receipt).unwrap();
        receipt.exit_code = Some(0);
        assert!(store_process_receipt(&directory, &receipt).is_err());
        receipt.exit_code = None;
        receipt.ended = Some(20);
        assert!(store_process_receipt(&directory, &receipt).is_err());
        fs::remove_dir_all(directory).unwrap();
    }
}
