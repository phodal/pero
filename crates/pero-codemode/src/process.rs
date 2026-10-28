//! One interpreter process and the tree under it.
//!
//! Unix puts the child in its own process group and signals the group.
//! Windows assigns the child to a job and terminates that job. The assignment
//! happens after `CreateProcess` returns, so a grandchild created in that
//! gap is not in the job; cancel then falls back to `taskkill /T`. The job
//! kills its members when the Host closes the last handle, so a Host that exits
//! or crashes does not leave a run behind.
//!
//! A run ends when its leader ends. Whatever the leader left behind is killed
//! before the receipt is written, so nothing outlives the workspace write turn.

use crate::run::{Prepare, is_rooted};
use std::{
    io::{self, Read},
    path::Path,
    process::{Child, Command, Stdio},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::{Duration, Instant},
};

const PROBE: &str = "\
import hashlib, sys
from pathlib import Path
marker = Path(sys.prefix) / '.pero-packages'
digest = ''
if marker.is_file() and not marker.is_symlink():
    digest = hashlib.sha256(marker.read_bytes()).hexdigest()
print(sys.prefix)
print(digest)
";

const KEPT_ENV: &[&str] = &[
    "PATH",
    "HOME",
    "USERPROFILE",
    "TMPDIR",
    "TEMP",
    "TMP",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "USER",
    "LOGNAME",
    "SYSTEMROOT",
    "WINDIR",
    "COMSPEC",
    "PATHEXT",
];

pub(crate) struct Spawned {
    pub child: Child,
    pub tree: Arc<Tree>,
}

pub(crate) struct Tree {
    pid: u32,
    live: AtomicBool,
    #[cfg(windows)]
    job: usize,
}

impl Tree {
    pub(crate) fn kill(&self) {
        if !self.live.swap(false, Ordering::SeqCst) {
            return;
        }
        self.signal();
    }

    /// The process has been waited on. Drop must not signal a pid that may be reused.
    pub(crate) fn disarm(&self) {
        self.live.store(false, Ordering::SeqCst);
    }

    /// True when the leader has exited and has not been reaped yet.
    ///
    /// A zombie still owns its pid, so signalling its process group now cannot
    /// reach a recycled pid. After `wait` that guarantee is gone, so descendants
    /// must be killed before the leader is reaped.
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    pub(crate) fn leader_exited(&self) -> bool {
        if self.pid <= 1 {
            return false;
        }
        // SAFETY: `info` is zeroed plain data; WNOWAIT leaves the child waitable.
        unsafe {
            let mut info: libc::siginfo_t = std::mem::zeroed();
            let status = libc::waitid(
                libc::P_PID,
                self.pid as libc::id_t,
                &mut info,
                libc::WEXITED | libc::WNOHANG | libc::WNOWAIT,
            );
            status == 0 && info.si_signo != 0
        }
    }

    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    pub(crate) fn leader_exited(&self) -> bool {
        false
    }

    /// The leader has been reaped. A Windows job still names its members, so it
    /// can be terminated; a bare pid may be reused, so nothing else is signalled.
    pub(crate) fn sweep_reaped(&self) {
        #[cfg(windows)]
        if self.job != 0 {
            self.kill();
            return;
        }
        self.disarm();
    }

    #[cfg(unix)]
    fn signal(&self) {
        if self.pid <= 1 {
            return;
        }
        unsafe {
            libc::kill(-(self.pid as i32), libc::SIGKILL);
            libc::kill(self.pid as i32, libc::SIGKILL);
        }
    }

    #[cfg(windows)]
    fn signal(&self) {
        if self.job != 0 {
            unsafe {
                windows_sys::Win32::System::JobObjects::TerminateJobObject(self.job as _, 1);
            }
            return;
        }
        if self.pid > 4 {
            let _ = Command::new("taskkill")
                .args(["/F", "/T", "/PID", &self.pid.to_string()])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
        }
    }

    #[cfg(not(any(unix, windows)))]
    fn signal(&self) {}
}

impl Drop for Tree {
    fn drop(&mut self) {
        self.kill();
        #[cfg(windows)]
        if self.job != 0 {
            unsafe {
                windows_sys::Win32::Foundation::CloseHandle(self.job as _);
            }
        }
    }
}

pub(crate) fn spawn_program(spec: &Prepare) -> io::Result<Spawned> {
    let mut command = isolated(&spec.interpreter, Some(&spec.cwd), Stdio::piped());
    command.arg("-I").arg(&spec.program_path);
    finish(command)
}

pub(crate) fn probe(interpreter: &Path) -> Option<(String, String)> {
    let mut command = isolated(interpreter, None, Stdio::null());
    command.arg("-I").arg("-c").arg(PROBE);
    let mut spawned = finish(command).ok()?;
    let tree = Arc::clone(&spawned.tree);
    let deadline = Instant::now() + Duration::from_secs(5);
    let status = loop {
        match spawned.child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() >= deadline => {
                tree.kill();
                let _ = spawned.child.wait();
                return None;
            }
            Ok(None) => thread::sleep(Duration::from_millis(20)),
            Err(_) => return None,
        }
    };
    tree.disarm();
    if !status.success() {
        return None;
    }
    let mut output = String::new();
    spawned
        .child
        .stdout
        .take()?
        .read_to_string(&mut output)
        .ok()?;
    if output.len() > 8192 {
        return None;
    }
    let mut lines = output.lines();
    let prefix = lines.next()?.trim();
    let marker = lines.next().unwrap_or("").trim();
    if !is_rooted(prefix)
        || prefix.len() > 4096
        || marker.len() > 64
        || !marker.bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return None;
    }
    Some((prefix.to_string(), marker.to_string()))
}

fn isolated(interpreter: &Path, cwd: Option<&Path>, stderr: Stdio) -> Command {
    let mut command = Command::new(interpreter);
    command
        .env_clear()
        .envs(kept_env())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(stderr);
    if let Some(cwd) = cwd {
        command.current_dir(cwd);
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    command
}

fn finish(mut command: Command) -> io::Result<Spawned> {
    let child = command.spawn()?;
    let tree = Arc::new(Tree {
        pid: child.id(),
        live: AtomicBool::new(true),
        #[cfg(windows)]
        job: job_handle(&child),
    });
    Ok(Spawned { child, tree })
}

#[cfg(windows)]
fn job_handle(child: &Child) -> usize {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
        SetInformationJobObject,
    };
    unsafe {
        let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if job.is_null() {
            return 0;
        }
        // The job's processes die with the last handle, which the Host holds.
        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            std::ptr::addr_of!(limits).cast(),
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        );
        if AssignProcessToJobObject(job, child.as_raw_handle()) == 0 {
            CloseHandle(job);
            return 0;
        }
        job as usize
    }
}

fn kept_env() -> Vec<(String, String)> {
    KEPT_ENV
        .iter()
        .filter_map(|key| {
            let value = std::env::var(key).ok()?;
            (value.len() <= 32_768 && !value.contains('\0') && !value.is_empty())
                .then(|| ((*key).to_string(), value))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_child_only_inherits_the_allowlist() {
        let passed = kept_env();
        assert!(passed.iter().all(|(key, value)| {
            KEPT_ENV.contains(&key.as_str())
                && !key.starts_with("PYTHON")
                && !key.starts_with("PERO")
                && !value.is_empty()
                && !value.contains('\0')
        }));
    }
}
