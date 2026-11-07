//! Host I/O adapters. Scientific method owners supply the frozen invocation and
//! retain budgets, attempt records, verification, and acceptance.
mod compose;
mod docker;
mod slurm;
pub use compose::{ComposeDeployment, ComposeEvidence, ComposeMember};
pub use slurm::SlurmSite;
mod local;
use crate::environments::{Identity, ResourceBinding};
use crate::owned_process::OwnedProcess;
pub use docker::{DockerImage, DockerOwner, DockerResource};
pub use local::LocalOwner;
use std::{
    path::{Path, PathBuf},
    process::Command,
};

/// Private execution handoff from an admitted method, never deserialized from
/// an App/public command body. Paths refer to a staged attempt directory.
pub struct MethodInvocation {
    pub program: PathBuf,
    pub arguments: Vec<String>,
    pub directory: PathBuf,
}

/// A real seam: local processes and container processes resolve differently.
/// The existing execution owner retains and polls the returned process.
pub trait ProcessOwner {
    fn observe(&self, now_ms: u64) -> Result<ResourceBinding, String>;
    fn launch(
        &mut self,
        use_id: &Identity,
        invocation: &MethodInvocation,
    ) -> Result<ProcessHandle, String>;
}

pub struct ProcessHandle {
    pub process: OwnedProcess,
    cleanup: Option<ContainerCleanup>,
}
struct ContainerCleanup {
    docker: PathBuf,
    context: String,
    name: String,
}
impl ProcessHandle {
    /// Docker stop/remove is separate from stopping the attached CLI process.
    /// A failed daemon operation is unknown and must be reconciled by original ID.
    pub fn stop(&mut self) -> Result<(), String> {
        if let Some(container) = &self.cleanup {
            let output = command_output(Command::new(&container.docker).args([
                "--context",
                &container.context,
                "rm",
                "--force",
                &container.name,
            ]))?;
            if !output.status.success() {
                return Err(format!(
                    "Container cleanup is unconfirmed: {}",
                    String::from_utf8_lossy(&output.stderr)
                ));
            }
            self.cleanup = None;
        }
        self.process.stop().map_err(|e| e.to_string())?;
        Ok(())
    }
    pub fn container_name(&self) -> Option<&str> {
        self.cleanup.as_ref().map(|c| c.name.as_str())
    }
}
impl Drop for ProcessHandle {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}

fn logs(command: &mut Command, directory: &Path) -> Result<(), String> {
    command
        .stdin(std::process::Stdio::null())
        .stdout(std::fs::File::create(directory.join("stdout.log")).map_err(|e| e.to_string())?)
        .stderr(std::fs::File::create(directory.join("stderr.log")).map_err(|e| e.to_string())?);
    Ok(())
}

#[cfg(test)]
mod tests;

/// External CLI inspection must not hold Host admission indefinitely. Timeout
/// means an unknown external effect; callers must reconcile the original ID.
fn command_output(command: &mut Command) -> Result<std::process::Output, String> {
    use std::{
        io::Read,
        process::Stdio,
        time::{Duration, Instant},
    };
    const LIMIT: u64 = 8 * 1024 * 1024;
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut process = OwnedProcess::spawn(command).map_err(|e| e.to_string())?;
    let stdout = process.child_mut().stdout.take().unwrap();
    let stderr = process.child_mut().stderr.take().unwrap();
    let out = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        stdout
            .take(LIMIT + 1)
            .read_to_end(&mut bytes)
            .map(|_| bytes)
    });
    let err = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        stderr
            .take(LIMIT + 1)
            .read_to_end(&mut bytes)
            .map(|_| bytes)
    });
    let deadline = Instant::now() + Duration::from_secs(30);
    let status = loop {
        if let Some(status) = process.try_wait().map_err(|e| e.to_string())? {
            break Some(status);
        }
        if Instant::now() >= deadline {
            break None;
        }
        std::thread::sleep(Duration::from_millis(10));
    };
    process.stop().map_err(|e| e.to_string())?;
    let stdout = out
        .join()
        .map_err(|_| "CLI stdout reader failed")?
        .map_err(|e| e.to_string())?;
    let stderr = err
        .join()
        .map_err(|_| "CLI stderr reader failed")?
        .map_err(|e| e.to_string())?;
    let status = status.ok_or("CLI timed out; reconcile the original resource before retry")?;
    if stdout.len() as u64 > LIMIT || stderr.len() as u64 > LIMIT {
        return Err("CLI observation exceeded 8 MiB".into());
    }
    Ok(std::process::Output {
        status,
        stdout,
        stderr,
    })
}
