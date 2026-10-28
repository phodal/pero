use crate::{
    control::{Control, lease_deadline},
    executor::{Execution, bounded_line, execution_env_allowed},
    journal::Journal,
    model::{Event, Outcome},
};
use pero_contracts::HostEvent;
use std::{
    collections::BTreeSet,
    io::{BufReader, Write},
    process::{Child, Command, Stdio},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    time::{Duration, Instant},
};

struct Process {
    child: Child,
    deadline: Arc<Mutex<Instant>>,
    expired: Arc<AtomicBool>,
    finished: Arc<AtomicBool>,
    groups: Arc<Mutex<BTreeSet<i32>>>,
    watchdog: Option<std::thread::JoinHandle<()>>,
    reaped: bool,
}

#[cfg(unix)]
fn signal_group(id: u32, signal: i32) {
    unsafe {
        libc::kill(-(id as i32), signal);
    }
}
#[cfg(not(unix))]
fn signal_group(_id: u32, _signal: i32) {}

fn descendants(root: u32) -> Result<BTreeSet<i32>, String> {
    // ACP SDK Agents lead a separate group; discover them by parent identity.
    let output = Command::new("/bin/ps")
        .args(["-eo", "pid=,ppid=,pgid="])
        .env_clear()
        .output()
        .map_err(|_| "Cannot inspect execution processes")?;
    if !output.status.success() {
        return Err("Cannot inspect execution processes".into());
    }
    let rows: Vec<Vec<i32>> = String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| {
            let row: Vec<_> = line
                .split_whitespace()
                .filter_map(|v| v.parse().ok())
                .collect();
            (row.len() == 3).then_some(row)
        })
        .collect();
    let mut pids = BTreeSet::from([root as i32]);
    loop {
        let before = pids.len();
        for row in &rows {
            if pids.contains(&row[1]) {
                pids.insert(row[0]);
            }
        }
        if pids.len() == before {
            break;
        }
    }
    Ok(rows
        .iter()
        .filter(|row| pids.contains(&row[0]))
        .map(|row| row[2])
        .filter(|group| *group > 1)
        .collect())
}

fn kill_tree(root: u32, groups: &Mutex<BTreeSet<i32>>) {
    // Process groups and POSIX signals are Unix-only. Windows reports that
    // supervision is unavailable before a child is spawned.
    #[cfg(unix)]
    {
        // Freeze the executor before discovery so it cannot launch another ACP group.
        unsafe {
            libc::kill(root as i32, libc::SIGSTOP);
        }
        for _ in 0..3 {
            if let Ok(current) = descendants(root) {
                groups.lock().unwrap().extend(current);
            }
            for group in groups.lock().unwrap().iter() {
                signal_group(*group as u32, libc::SIGSTOP);
            }
        }
        for group in groups.lock().unwrap().iter() {
            signal_group(*group as u32, libc::SIGKILL);
        }
        signal_group(root, libc::SIGKILL);
    }
    #[cfg(not(unix))]
    {
        let _ = (root, groups);
    }
}

#[cfg(unix)]
pub fn kill_orphan_tree() {
    let own = unsafe { libc::getpgrp() };
    if let Ok(groups) = descendants(std::process::id()) {
        for group in groups {
            if group != own {
                signal_group(group as u32, libc::SIGKILL);
            }
        }
    }
    signal_group(own as u32, libc::SIGKILL);
}

impl Process {
    fn spawn(
        execution: &Execution,
        deadline: Instant,
    ) -> Result<(Self, mpsc::Receiver<Result<HostEvent, String>>), String> {
        #[cfg(not(unix))]
        {
            return Err("Worker process supervision currently requires Unix".into());
        }
        let mut command = Command::new(std::env::current_exe().map_err(|e| e.to_string())?);
        command
            .arg("--execute")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        // The Agent process inherits provider authentication, never control-plane credentials.
        command
            .env_clear()
            .envs(std::env::vars_os().filter(|(key, _)| execution_env_allowed(key)));
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            command.process_group(0);
        }
        let child = command
            .spawn()
            .map_err(|_| "Unable to start supervised executor")?;
        let id = child.id();
        let mut process = Self {
            child,
            deadline: Arc::new(Mutex::new(deadline)),
            expired: Arc::new(AtomicBool::new(false)),
            finished: Arc::new(AtomicBool::new(false)),
            groups: Arc::new(Mutex::new(BTreeSet::from([id as i32]))),
            watchdog: None,
            reaped: false,
        };
        let id = process.child.id();
        let limit = process.deadline.clone();
        let expired = process.expired.clone();
        let finished = process.finished.clone();
        let groups = process.groups.clone();
        process.watchdog = Some(std::thread::spawn(move || {
            while !finished.load(Ordering::SeqCst) {
                if Instant::now() >= *limit.lock().unwrap() {
                    expired.store(true, Ordering::SeqCst);
                    kill_tree(id, &groups);
                    break;
                }
                if let Ok(current) = descendants(id) {
                    if current.contains(&(id as i32)) {
                        *groups.lock().unwrap() = current;
                    }
                }
                std::thread::sleep(Duration::from_millis(50));
            }
        }));
        let mut bytes = serde_json::to_vec(execution).map_err(|e| e.to_string())?;
        bytes.push(b'\n');
        process
            .child
            .stdin
            .as_mut()
            .ok_or("Missing child input")?
            .write_all(&bytes)
            .map_err(|_| "Executor input failed")?;
        let stdout = process.child.stdout.take().ok_or("Missing child output")?;
        let (tx, rx) = mpsc::sync_channel(32);
        std::thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            loop {
                match bounded_line(&mut reader, 65536) {
                    Ok(Some(bytes)) => {
                        let event = serde_json::from_slice(&bytes)
                            .map_err(|_| "Invalid executor event".to_owned());
                        if tx.send(event).is_err() {
                            break;
                        }
                    }
                    Ok(None) => break,
                    Err(error) => {
                        let _ = tx.send(Err(error));
                        break;
                    }
                }
            }
        });
        Ok((process, rx))
    }

    fn cleanup(&mut self) -> bool {
        self.finished.store(true, Ordering::SeqCst);
        if let Some(watchdog) = self.watchdog.take() {
            let _ = watchdog.join();
        }
        // Give ACP a brief chance to acknowledge cancellation before enforcing termination.
        if let Some(input) = self.child.stdin.as_mut() {
            let _ = input.write_all(b"cancel\n");
        }
        std::thread::sleep(Duration::from_millis(250));
        kill_tree(self.child.id(), &self.groups);
        let _ = self.child.wait();
        self.reaped = true;
        let until = Instant::now() + Duration::from_secs(2);
        while Instant::now() < until {
            #[cfg(unix)]
            {
                if self.groups.lock().unwrap().iter().all(|group| unsafe { libc::kill(-*group, 0) } == -1
                    && std::io::Error::last_os_error().raw_os_error() == Some(libc::ESRCH))
                {
                    self.finished.store(true, Ordering::SeqCst);
                    return true;
                }
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        self.finished.store(true, Ordering::SeqCst);
        false
    }
}

impl Drop for Process {
    fn drop(&mut self) {
        self.finished.store(true, Ordering::SeqCst);
        if let Some(watchdog) = self.watchdog.take() {
            let _ = watchdog.join();
        }
        if !self.reaped {
            kill_tree(self.child.id(), &self.groups);
            let _ = self.child.wait();
        }
    }
}

pub fn execute(
    control: &Control,
    journal: &mut Journal,
    execution: Execution,
    claim_started: Instant,
) -> Result<Outcome, String> {
    let run = journal
        .state
        .active
        .as_ref()
        .ok_or("Missing active Run")?
        .run
        .clone();
    let deadline = lease_deadline(&run.lease_expires_at, claim_started)?;
    let (mut process, events) = Process::spawn(&execution, deadline)?;
    let mut renew_at = Instant::now();
    let mut flush_at = Instant::now();
    let mut result = None;
    let started = Instant::now();
    let outcome = loop {
        if process.expired.load(Ordering::SeqCst) {
            break Outcome::new(
                "reconcile",
                "Execution lease lost; process group stopped; effects require reconciliation",
            );
        }
        if started.elapsed() >= Duration::from_secs(3600) {
            break Outcome::new("failed", "Worker execution exceeded its one-hour limit");
        }
        if Instant::now() >= renew_at {
            let request_started = Instant::now();
            match control.renew(&run) {
                Ok(renewal) => {
                    if renewal.cancel_requested {
                        break Outcome::new("cancelled", "Cancellation requested by Cloud");
                    }
                    match lease_deadline(&renewal.lease_expires_at, request_started) {
                        Ok(deadline) => {
                            // Once expired, a late HTTP response can never resurrect execution.
                            if process.expired.load(Ordering::SeqCst) {
                                break Outcome::new("reconcile", "Lease expired while renewing");
                            }
                            *process.deadline.lock().unwrap() = deadline;
                            renew_at = Instant::now()
                                + deadline
                                    .saturating_duration_since(Instant::now())
                                    .div_f64(3.0)
                                    .max(Duration::from_millis(50));
                        }
                        Err(_) => {
                            break Outcome::new(
                                "reconcile",
                                "Cloud returned an expired execution lease",
                            );
                        }
                    }
                }
                Err(_) => {
                    renew_at = Instant::now() + Duration::from_millis(250);
                }
            }
        }
        let mut disconnected = false;
        for _ in 0..32 {
            let event = match events.try_recv() {
                Ok(Ok(event)) => event,
                Ok(Err(error)) => {
                    result = Some(Outcome::new("failed", error));
                    disconnected = true;
                    break;
                }
                Err(mpsc::TryRecvError::Empty) => break,
                Err(mpsc::TryRecvError::Disconnected) => {
                    disconnected = true;
                    break;
                }
            };
            if event.kind == "worker_result" {
                result = Some(
                    serde_json::from_value::<Outcome>(event.data.clone())
                        .map_err(|_| "Invalid executor result")?,
                );
            }
            if let Err(error) = journal.append(Event {
                seq: 0,
                kind: event.kind,
                text: event.text,
                data: event.data,
            }) {
                result = Some(Outcome::new("reconcile", error));
                disconnected = true;
                break;
            }
        }
        if result.is_some() || disconnected {
            break result
                .unwrap_or_else(|| Outcome::new("failed", "Executor exited without a result"));
        }
        if Instant::now() >= flush_at {
            if let Ok(acknowledged) = control.flush(journal.state.active.as_ref().unwrap()) {
                journal.state.active.as_mut().unwrap().acknowledged = acknowledged;
                journal.save()?;
            }
            flush_at = Instant::now() + Duration::from_millis(250);
        }
        std::thread::sleep(Duration::from_millis(25));
    };
    let clean = process.cleanup();
    if !clean {
        return Ok(Outcome::new(
            "reconcile",
            "Process group cleanup could not be confirmed",
        ));
    }
    Ok(outcome)
}
