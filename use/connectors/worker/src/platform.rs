//! OS-owned process lifetime boundary. MCP framing and session policy stay shared.
//!
//! Unix sessions own a process group, observe their parent's identity and retire
//! on SIGTERM. This does not reclaim descendants that deliberately detach.
//! Windows must gain equivalent Job Object and owner-lifetime behavior before
//! enabling execution; compiling the unsupported branch is not runtime support.
use std::{
    io,
    path::{Path, PathBuf},
    process::Command,
};

pub const UNSUPPORTED: &str = "MCP_PLATFORM_UNSUPPORTED";

pub const fn supported() -> bool {
    cfg!(unix)
}

#[cfg(not(unix))]
fn unsupported() -> io::Error {
    io::Error::new(io::ErrorKind::Unsupported, UNSUPPORTED)
}

#[derive(Clone, Copy)]
pub struct Owner {
    #[cfg(unix)]
    parent: libc::pid_t,
}
impl Owner {
    pub fn capture() -> Self {
        Self {
            #[cfg(unix)]
            parent: unsafe { libc::getppid() },
        }
    }
    pub fn disconnected(self) -> bool {
        #[cfg(unix)]
        {
            self.parent <= 1 || unsafe { libc::getppid() } != self.parent
        }
        #[cfg(not(unix))]
        {
            true
        }
    }
    #[cfg(all(test, unix))]
    pub fn missing() -> Self {
        Self { parent: 0 }
    }
}

/// Each spawned server gets its own group before it can execute server code.
pub fn prepare_command(command: &mut Command) -> io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
        Ok(())
    }
    #[cfg(not(unix))]
    {
        let _ = command;
        Err(unsupported())
    }
}
pub fn prepare_async_command(command: &mut tokio::process::Command) -> io::Result<()> {
    #[cfg(unix)]
    {
        command.process_group(0);
        Ok(())
    }
    #[cfg(not(unix))]
    {
        let _ = command;
        Err(unsupported())
    }
}

/// Signal only the process group created for this owned child. The caller must
/// still wait/reap its direct child; signal acceptance is not cleanup evidence.
pub fn kill_owned_group(pid: u32) {
    #[cfg(unix)]
    if pid > 1 && pid <= i32::MAX as u32 {
        unsafe {
            libc::kill(-(pid as i32), libc::SIGKILL);
        }
    }
    #[cfg(not(unix))]
    {
        let _ = pid;
    }
}

pub fn default_working_directory() -> io::Result<PathBuf> {
    #[cfg(unix)]
    {
        Ok(PathBuf::from("/"))
    }
    #[cfg(not(unix))]
    {
        Err(unsupported())
    }
}

/// Preserve the Unix canonical-path requirement. Windows path normalization
/// needs an explicit decision before execution is enabled there.
pub fn is_canonical_absolute(path: &Path) -> io::Result<bool> {
    #[cfg(unix)]
    {
        Ok(path.is_absolute() && path.canonicalize()? == path)
    }
    #[cfg(not(unix))]
    {
        let _ = path;
        Err(unsupported())
    }
}

#[cfg(unix)]
static CANCELLED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
#[cfg(unix)]
extern "C" fn cancel(_: libc::c_int) {
    CANCELLED.store(true, std::sync::atomic::Ordering::Relaxed);
}
pub fn install_cancellation_handler() {
    #[cfg(unix)]
    unsafe {
        libc::signal(libc::SIGTERM, cancel as *const () as libc::sighandler_t);
    }
}
pub fn cancellation_requested() -> bool {
    #[cfg(unix)]
    {
        CANCELLED.load(std::sync::atomic::Ordering::Relaxed)
    }
    #[cfg(not(unix))]
    {
        true
    }
}

pub struct Termination {
    #[cfg(unix)]
    signal: tokio::signal::unix::Signal,
}
impl Termination {
    pub fn new() -> io::Result<Self> {
        #[cfg(unix)]
        {
            Ok(Self {
                signal: tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())?,
            })
        }
        #[cfg(not(unix))]
        {
            Err(unsupported())
        }
    }
    pub async fn recv(&mut self) {
        #[cfg(unix)]
        {
            self.signal.recv().await;
        }
        #[cfg(not(unix))]
        {
            std::future::pending::<()>().await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn support_matches_owned_process_implementation() {
        assert_eq!(supported(), cfg!(unix));
        #[cfg(not(unix))]
        {
            assert!(Owner::capture().disconnected());
            assert!(prepare_command(&mut Command::new("never-started")).is_err());
            assert!(default_working_directory().is_err());
            assert!(Termination::new().is_err());
        }
    }
    #[cfg(unix)]
    #[test]
    fn canonical_paths_remain_strict() {
        assert!(is_canonical_absolute(Path::new("/")).unwrap());
        assert!(!is_canonical_absolute(Path::new(".")).unwrap());
        assert!(!is_canonical_absolute(Path::new("/tmp/..")).unwrap());
    }
}
