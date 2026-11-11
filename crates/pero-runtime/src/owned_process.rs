//! One Host-owned process group, shared by App services and compute adapters.
use std::{
    process::{Child, Command, ExitStatus},
    time::{Duration, Instant},
};

pub struct OwnedProcess {
    child: Child,
    stopped: Option<ExitStatus>,
}

/// Stop a registered scientific group after its original App owner has closed.
/// It may contain native descendants even after the scientific Python exited.
#[cfg(unix)]
pub(crate) fn stop_process_group(group:u32)->std::io::Result<()> {
    let absent=||unsafe {libc::kill(-(group as i32),0)==-1 && std::io::Error::last_os_error().raw_os_error()==Some(libc::ESRCH)};
    for signal in [libc::SIGTERM,libc::SIGKILL] {
        if absent() {return Ok(());}
        unsafe {libc::kill(-(group as i32),signal);}
        let deadline=Instant::now()+Duration::from_secs(2);
        while !absent() && Instant::now()<deadline {std::thread::sleep(Duration::from_millis(10));}
    }
    if absent() {Ok(())} else {Err(std::io::Error::other("Scientific process group stop is not confirmed"))}
}
#[cfg(not(unix))]
pub(crate) fn stop_process_group(_group:u32)->std::io::Result<()> {
    Err(std::io::Error::other("Scientific process groups are unsupported"))
}
impl OwnedProcess {
    pub fn spawn(command: &mut Command) -> std::io::Result<Self> {
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            command.process_group(0);
        }
        Ok(Self {
            child: command.spawn()?,
            stopped: None,
        })
    }
    pub fn child_mut(&mut self) -> &mut Child {
        &mut self.child
    }
    pub fn try_wait(&mut self) -> std::io::Result<Option<ExitStatus>> {
        self.child.try_wait()
    }
    /// Stop the owned group even if its leader already exited, then reap the leader.
    /// This is local OS process control, never proof that remote work stopped.
    pub fn stop(&mut self) -> std::io::Result<ExitStatus> {
        if let Some(status) = self.stopped {
            return Ok(status);
        }
        #[cfg(unix)]
        {
            let group = -(self.child.id() as i32);
            unsafe {
                libc::kill(group, libc::SIGTERM);
            }
            let deadline = Instant::now() + Duration::from_secs(2);
            while self.child.try_wait()?.is_none() && Instant::now() < deadline {
                std::thread::sleep(Duration::from_millis(10));
            }
            unsafe {
                libc::kill(group, libc::SIGKILL);
            }
        }
        #[cfg(not(unix))]
        {
            if self.child.try_wait()?.is_none() {
                self.child.kill()?;
            }
        }
        let status = self.child.wait()?;
        self.stopped = Some(status);
        Ok(status)
    }
}
impl Drop for OwnedProcess {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}
