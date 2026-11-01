use crate::model::{Event, Outcome, RemoteGrant, Run};
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use std::{
    fs::{File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};

#[derive(Default, Deserialize, Serialize)]
pub struct State {
    pub pending_claim: Option<Claim>,
    pub active: Option<Active>,
}

#[derive(Deserialize, Serialize)]
pub struct Claim {
    pub request_id: String,
    pub instance_id: String,
    // Trusted-pool identity, frozen with the claim before its first HTTP request.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub runtime_pod_uid: Option<String>,
}

#[derive(Deserialize, Serialize)]
pub struct Active {
    pub run: Run,
    #[serde(default)]
    pub request_id: String,
    pub events: Vec<Event>,
    pub acknowledged: u64,
    pub result: Option<Outcome>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remote_grant: Option<RemoteGrant>,
}

pub struct Journal {
    path: PathBuf,
    _lock: StateLock,
    pub state: State,
}

// The Journal is the sole claim owner. A fork/dup may transiently retain the
// file description, so closing only this descriptor is not a release boundary.
struct StateLock(File);

impl Drop for StateLock {
    fn drop(&mut self) {
        // Unlock the owned description before File closes it. If unlock fails,
        // normal close still applies; no alternate owner or retry is fabricated.
        let _ = FileExt::unlock(&self.0);
    }
}

impl Journal {
    pub fn open(path: PathBuf) -> Result<Self, String> {
        if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let lock = private_file(&path.with_extension("lock"))?;
        lock.try_lock_exclusive()
            .map_err(|_| "Worker state is already in use".to_owned())?;
        let lock = StateLock(lock);
        let state = match std::fs::read(&path) {
            Ok(bytes) => serde_json::from_slice(&bytes)
                .map_err(|e| format!("Invalid Worker journal: {e}"))?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => State::default(),
            Err(e) => return Err(e.to_string()),
        };
        Ok(Self {
            path,
            _lock: lock,
            state,
        })
    }

    pub fn save(&self) -> Result<(), String> {
        let pending = self.path.with_extension("pending");
        let mut file = private_file(&pending)?;
        file.set_len(0).map_err(|e| e.to_string())?;
        file.write_all(&serde_json::to_vec(&self.state).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        // Windows cannot rename a file that still has a write handle, and it
        // denies FlushFileBuffers on a directory. The file data is already synced.
        drop(file);
        std::fs::rename(pending, &self.path).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        if let Some(parent) = self.path.parent().filter(|p| !p.as_os_str().is_empty()) {
            File::open(parent)
                .and_then(|dir| dir.sync_all())
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn append(&mut self, mut event: Event) -> Result<(), String> {
        let active = self.state.active.as_mut().ok_or("No active Run")?;
        event.seq = active.events.last().map_or(1, |e| e.seq + 1);
        event.validate()?;
        // Bound disk usage; overflow ends execution instead of silently dropping evidence.
        if active.events.len() >= 4096
            || serde_json::to_vec(&active.events)
                .map_err(|e| e.to_string())?
                .len()
                >= 8 * 1024 * 1024
        {
            return Err("Worker event journal limit reached".into());
        }
        active.events.push(event);
        self.save()
    }
}

pub fn private_file(path: &Path) -> Result<File, String> {
    let mut options = OpenOptions::new();
    options.create(true).read(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
    }
    options.open(path).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn releasing_journal_does_not_wait_for_an_inherited_descriptor() {
        let dir = std::env::temp_dir().join(format!("pero-worker-{}", uuid::Uuid::new_v4()));
        let path = dir.join("state.json");
        let journal = Journal::open(path.clone()).unwrap();
        // dup and fork share the same open-file description on Unix. Retain an
        // alias to deterministically model the fork-before-exec window, without
        // unsafe pre_exec code or a scheduler-dependent sleep.
        let inherited = journal._lock.0.try_clone().unwrap();
        assert!(Journal::open(path.clone()).is_err());
        drop(journal);
        let next_owner = Journal::open(path.clone()).expect("owner drop must release the claim");
        assert!(Journal::open(path.clone()).is_err());
        drop(inherited);
        assert!(Journal::open(path.clone()).is_err(), "old descriptor must not release the new claim");
        drop(next_owner);
        assert!(Journal::open(path).is_ok());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn durable_claim_and_exclusive_state_lock() {
        let dir = std::env::temp_dir().join(format!("pero-worker-{}", uuid::Uuid::new_v4()));
        let path = dir.join("state.json");
        let mut journal = Journal::open(path.clone()).unwrap();
        journal.state.pending_claim = Some(Claim {
            request_id: "request".into(),
            instance_id: "instance".into(),
            runtime_pod_uid: None,
        });
        journal.save().unwrap();
        assert!(Journal::open(path.clone()).is_err());
        drop(journal);
        assert_eq!(
            Journal::open(path)
                .unwrap()
                .state
                .pending_claim
                .unwrap()
                .request_id,
            "request"
        );
        std::fs::remove_dir_all(dir).unwrap();
    }
}
