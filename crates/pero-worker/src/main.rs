mod approval;
mod control;
mod executor;
mod journal;
mod model;
mod supervisor;

use control::{CloudFailure, Control};
use journal::{Active, Claim, Journal};
use model::{Outcome, ReconnectBackoff, RemoteGrant};
use pero_contracts::local_worker::{LocalWorkerStatus, WorkerProgress};
use ring::rand::SecureRandom;
use std::io::Write;
use std::{
    path::PathBuf,
    time::{Duration, Instant},
};

fn main() {
    let result = if std::env::args().nth(1).as_deref() == Some("--execute") {
        executor::child_execute()
    } else {
        run()
    };
    if let Err(error) = result {
        eprintln!("pero-worker: {error}");
        if std::env::args().nth(1).as_deref() != Some("--execute") {
            progress(LocalWorkerStatus::NeedsAttention, &error, None);
        }
        std::process::exit(1);
    }
}

fn required(name: &str) -> Result<String, String> {
    std::env::var(name)
        .ok()
        .filter(|v| !v.trim().is_empty())
        .ok_or_else(|| format!("Set {name}"))
}

fn terminal(status: &str) -> bool {
    matches!(status, "succeeded" | "failed" | "cancelled" | "reconcile")
}

fn clear(journal: &mut Journal) -> Result<(), String> {
    journal.state.active = None;
    journal.state.pending_claim = None;
    journal.save()
}

fn complete(control: &Control, journal: &mut Journal) -> Result<(), CloudFailure> {
    let active = journal.state.active.as_ref().ok_or("Missing Run journal")?;
    let result = active.result.clone().ok_or("Missing execution outcome")?;
    let run = active.run.clone();
    // Persisted result is retried verbatim, preserving the server's idempotent receipt.
    match control.complete(&run, &result) {
        Ok(_) => clear(journal).map_err(Into::into),
        Err(error) => match control.inspect(&run) {
            Ok(current) if terminal(&current.status) => clear(journal).map_err(Into::into),
            Ok(current)
                if current.status == "cancel_requested" && result.outcome == "succeeded" =>
            {
                journal.state.active.as_mut().unwrap().result = Some(Outcome::new(
                    "reconcile",
                    "Cancellation raced with Agent completion; execution stopped; review candidate effects",
                ));
                journal.save()?;
                complete(control, journal)
            }
            _ => Err(error.retained()),
        },
    }
}

fn recover(control: &Control, journal: &mut Journal) -> Result<bool, CloudFailure> {
    let mut needs_review = false;
    // A lost claim response is recovered using the ORIGINAL process instance and key.
    if let Some(claim) = &journal.state.pending_claim {
        let request_id = claim.request_id.clone();
        let run = control.claim(claim)?;
        journal.state.pending_claim = None;
        if let Some(run) = run {
            journal.state.active = Some(Active {
                run,
                request_id,
                events: vec![],
                acknowledged: 0,
                result: None,
                remote_grant: None,
            });
        }
        journal.save()?;
    }
    if let Some(active) = journal.state.active.as_ref() {
        needs_review = active
            .result
            .as_ref()
            .is_none_or(|result| result.outcome == "reconcile" || result.needs_attention);
        if control
            .inspect(&active.run)
            .is_ok_and(|current| terminal(&current.status))
        {
            clear(journal)?;
            return Ok(needs_review);
        }
        if active.result.is_none() {
            if let Some(grant) = &active.remote_grant {
                // Reconcile the same issuance receipt only; never reopen the duplex
                // connection or regenerate the grant after an interrupted process.
                let _ = control.open_channel(&active.run, grant);
            }
            journal.state.active.as_mut().unwrap().result = Some(Outcome::new(
                "reconcile",
                "Worker restarted after acquiring execution; prompt was not replayed; inspect previous effects",
            ));
            journal.save()?;
        }
        complete(control, journal)?;
    }
    Ok(needs_review)
}

fn run() -> Result<(), String> {
    #[cfg(not(unix))]
    {
        return Err("Worker process supervision currently requires Unix".into());
    }
    #[cfg(unix)]
    if std::env::var("PERO_LOCAL_WORKER_SUPERVISED").as_deref() == Ok("1") {
        let parent = unsafe { libc::getppid() };
        if parent <= 1 {
            return Err("Local Worker Host is unavailable".into());
        }
        std::thread::spawn(move || {
            loop {
                std::thread::sleep(Duration::from_millis(100));
                if unsafe { libc::getppid() } != parent {
                    // The durable journal survives; an orphan executor observes EOF/parent loss.
                    std::process::exit(0);
                }
            }
        });
    }
    let runtime_pod_uid = std::env::var("PERO_RUNTIME_POD_UID").ok();
    if runtime_pod_uid.as_ref().is_some_and(|uid| {
        uid.is_empty() || uid.len() > 128 || !uid.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')
    }) {
        return Err("PERO_RUNTIME_POD_UID must be a bounded Kubernetes UID".into());
    }
    let control = Control::new(&required("PERO_CLOUD_URL")?, required("PERO_WORKER_TOKEN")?)?;
    let config_path = PathBuf::from(required("PERO_WORKER_CONFIG")?);
    let mut config: executor::Config = serde_json::from_slice(
        &std::fs::read(&config_path).map_err(|_| "Worker configuration is unavailable")?,
    )
    .map_err(|_| "Invalid Worker configuration")?;
    let config_root = config_path
        .canonicalize()
        .map_err(|e| e.to_string())?
        .parent()
        .unwrap()
        .to_path_buf();
    for path in config.workspaces.values_mut() {
        if path.is_relative() {
            *path = config_root.join(&*path);
        }
    }
    if let Some(path) = config.agents_file.as_mut() {
        if path.is_relative() {
            *path = config_root.join(&*path);
        }
    }
    config.ready()?;
    progress(LocalWorkerStatus::Starting, "Connecting local Worker", None);
    let mut journal = Journal::open(PathBuf::from(required("PERO_WORKER_STATE")?))?;
    let once = std::env::args().any(|arg| arg == "--once");
    let mut backoff = ReconnectBackoff::default();
    let recovered = loop {
        match recover(&control, &mut journal) {
            Ok(needs_review) => break needs_review,
            Err(error) if error.retryable && !once => {
                let delay = backoff.failed().as_secs();
                progress(
                    LocalWorkerStatus::Offline,
                    &format!("Cloud is unavailable; recovering the original claim in {delay}s"),
                    None,
                );
                std::thread::sleep(Duration::from_secs(delay));
            }
            Err(error) => return Err(error.into()),
        }
    };
    if recovered {
        let message =
            "Interrupted execution reconciled; review effects before restarting this Worker";
        eprintln!("{message}");
        progress(LocalWorkerStatus::NeedsAttention, message, None);
        return Ok(());
    }
    let instance_id = uuid::Uuid::new_v4().to_string();
    backoff = ReconnectBackoff::default();
    let mut idle = false;
    loop {
        if journal.state.pending_claim.is_none() {
            journal.state.pending_claim = Some(Claim {
                request_id: uuid::Uuid::new_v4().to_string(),
                instance_id: instance_id.clone(),
                runtime_pod_uid: runtime_pod_uid.clone(),
            });
        }
        journal.save()?;
        let started = Instant::now();
        let claim = journal.state.pending_claim.as_ref().unwrap();
        let request_id = claim.request_id.clone();
        let claimed = match control.claim(claim) {
            Ok(claimed) => {
                backoff = ReconnectBackoff::default();
                claimed
            }
            Err(error) if error.retryable && !once => {
                let delay = backoff.failed().as_secs();
                progress(
                    LocalWorkerStatus::Offline,
                    &format!("Cloud is unavailable; retrying in {delay}s"),
                    None,
                );
                idle = false;
                std::thread::sleep(Duration::from_secs(delay));
                continue;
            }
            Err(error) => return Err(error.into()),
        };
        journal.state.pending_claim = None;
        let Some(run) = claimed else {
            journal.save()?;
            if !idle {
                progress(LocalWorkerStatus::Idle, "Ready for assigned tasks", None);
                idle = true;
            }
            if once {
                return Ok(());
            }
            std::thread::sleep(Duration::from_secs(2));
            continue;
        };
        if terminal(&run.status) {
            journal.save()?;
            continue;
        }
        idle = false;
        progress(
            LocalWorkerStatus::Running,
            "Running assigned task",
            Some(run.id.clone()),
        );
        let remote_grant = if let Some(remote) = &run.remote_execution {
            let mut bytes = [0u8; 32];
            ring::rand::SystemRandom::new()
                .fill(&mut bytes)
                .map_err(|_| "Unable to create scoped channel secret")?;
            Some(RemoteGrant {
                session_id: remote.session_id.clone(),
                secret: bytes.iter().map(|b| format!("{b:02x}")).collect(),
            })
        } else {
            None
        };
        journal.state.active = Some(Active {
            run: run.clone(),
            request_id,
            events: vec![],
            acknowledged: 0,
            result: None,
            remote_grant: remote_grant.clone(),
        });
        // This durable record MUST precede workspace access, Agent spawn and prompt submission.
        journal.save()?;
        let execution = if let Some(grant) = &remote_grant {
            let scratch = PathBuf::from(required("PERO_WORKER_STATE")?).with_extension("remote");
            match config.remote_execution(&run, grant, control.origin(), scratch) {
                Ok(execution) => match control.open_channel(&run, grant) {
                    Ok(()) => Ok(execution),
                    Err(_) => Err("Remote channel admission uncertain; original grant retained; no attach attempted".into()),
                },
                Err(error) => Err(error),
            }
        } else {
            config.execution(&run)
        };
        let mut result = match execution {
            Ok(execution) => supervisor::execute(&control, &mut journal, execution, started)
                .unwrap_or_else(|error| Outcome::new("reconcile", error)),
            Err(error) => Outcome::blocked(error),
        };
        if run.remote_execution.is_some() && result.outcome == "failed" {
            // A cancelled remote channel can close before the next renewal poll.
            // Only an ordinary execution failure after confirmed LOCAL cleanup
            // may acknowledge the trusted control-plane cancellation. Blocked
            // launch, lease loss, or uncertain cleanup must remain reconciliation.
            let cancelled = !result.needs_attention && control.inspect(&run).is_ok_and(|current| {
                current.id == run.id && current.generation == run.generation
                    && current.instance_id == run.instance_id && current.status == "cancel_requested"
            });
            result = if cancelled {
                Outcome::new("cancelled", "Cloud cancellation confirmed; local remote bridge stopped; remote compute cleanup remains separate")
            } else {
                Outcome::new("reconcile", "Remote execution stopped without a confirmed result; original Run requires reconciliation")
            };
        }
        eprintln!("Run {}: {}", run.id, result.outcome);
        let stop = result.outcome == "reconcile" || result.needs_attention;
        let stop_message = result.summary.clone();
        journal.state.active.as_mut().unwrap().result = Some(result);
        journal.save()?;
        // Once execution stops, retain and upload its complete evidence before completion.
        backoff = ReconnectBackoff::default();
        while journal
            .state
            .active
            .as_ref()
            .is_some_and(|active| active.acknowledged < active.events.last().map_or(0, |e| e.seq))
        {
            let active = journal.state.active.as_ref().unwrap();
            if let Err(error) = control.renew(&active.run) {
                // Lease expiry may already have produced a terminal reconcile state.
                if control
                    .inspect(&active.run)
                    .is_ok_and(|current| terminal(&current.status))
                {
                    break;
                }
                if error.retryable && !once {
                    let delay = backoff.failed().as_secs();
                    progress(
                        LocalWorkerStatus::Offline,
                        &format!("Execution stopped; reconnecting to upload events in {delay}s"),
                        Some(run.id.clone()),
                    );
                    std::thread::sleep(Duration::from_secs(delay));
                    continue;
                }
                return Err(format!("{error}; stopped Run retained for reconciliation"));
            }
            let acknowledged = match control.flush(journal.state.active.as_ref().unwrap()) {
                Ok(acknowledged) => {
                    backoff = ReconnectBackoff::default();
                    acknowledged
                }
                Err(error) if error.retryable && !once => {
                    let delay = backoff.failed().as_secs();
                    progress(
                        LocalWorkerStatus::Offline,
                        &format!("Execution stopped; retaining events for upload in {delay}s"),
                        Some(run.id.clone()),
                    );
                    std::thread::sleep(Duration::from_secs(delay));
                    continue;
                }
                Err(error) => return Err(error.into()),
            };
            journal.state.active.as_mut().unwrap().acknowledged = acknowledged;
            journal.save()?;
        }
        backoff = ReconnectBackoff::default();
        loop {
            match complete(&control, &mut journal) {
                Ok(()) => break,
                Err(error) if error.retryable && !once => {
                    let delay = backoff.failed().as_secs();
                    progress(
                        LocalWorkerStatus::Offline,
                        &format!("Execution stopped; uploading its retained result in {delay}s"),
                        Some(run.id.clone()),
                    );
                    std::thread::sleep(Duration::from_secs(delay));
                }
                Err(error) => return Err(error.into()),
            }
        }
        if stop {
            return Err(format!(
                "{stop_message}; Worker stopped receiving tasks; resolve locally before restarting"
            ));
        }
        if once {
            return Ok(());
        }
    }
}

fn progress(status: LocalWorkerStatus, message: &str, run_id: Option<String>) {
    let progress = WorkerProgress {
        status,
        message: message.into(),
        run_id,
    };
    let mut output = std::io::stdout().lock();
    if serde_json::to_writer(&mut output, &progress).is_ok() {
        let _ = writeln!(output);
        let _ = output.flush();
    }
}
