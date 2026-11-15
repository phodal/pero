//! OpenSSH is the authentication/configuration owner. Apps receive observations,
//! never passwords, keys, SSH options or executable selection.
use super::{command_input, command_output};
use crate::environments::{ContentDigest, Identity};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    path::{Path, PathBuf},
    process::{Command, Output},
};

#[derive(Clone)]
pub struct SshTransport {
    ssh: PathBuf,
    host: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshProbe {
    pub hostname: String,
    pub system: String,
    pub architecture: String,
    pub python: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteProcessObservation {
    pub pid: u32,
    pub started_ms: u64,
    pub ended_ms: Option<u64>,
    pub running: bool,
    pub exit_code: Option<u8>,
    pub stop_requested: bool,
}
pub struct StagedFile {
    pub name: String,
    pub bytes: Vec<u8>,
    pub executable: bool,
}
pub struct CollectedFile {
    pub name: String,
    pub bytes: Vec<u8>,
    pub sha256: ContentDigest,
}
impl SshTransport {
    /// The composition root chooses OpenSSH; the connection supplies only a host
    /// or configured alias. No ad-hoc SSH options or private credentials enter here.
    pub fn new(ssh: PathBuf, host: String) -> Result<Self, String> {
        if host.is_empty()
            || host.len() > 255
            || host.starts_with('-')
            || host.chars().any(|c| c.is_whitespace() || c.is_control())
        {
            return Err("Choose an SSH host or configured alias".into());
        }
        Ok(Self { ssh, host })
    }
    fn command(&self, program: &Path, arguments: &[String]) -> Result<Command, String> {
        let program = program.to_str().ok_or("Remote program must be UTF-8")?;
        let line = std::iter::once(program)
            .chain(arguments.iter().map(String::as_str))
            .map(quote)
            .collect::<Vec<_>>()
            .join(" ");
        let mut command = Command::new(&self.ssh);
        command.args([
            "-o",
            "BatchMode=yes",
            "-o",
            "ConnectTimeout=10",
            "-o",
            "StrictHostKeyChecking=yes",
            "--",
            &self.host,
            &line,
        ]);
        Ok(command)
    }
    pub(super) fn run(&self, program: &Path, arguments: &[String]) -> Result<Output, String> {
        command_output(&mut self.command(program, arguments)?)
    }
    fn request<T: serde::de::DeserializeOwned>(&self, value: Value) -> Result<T, String> {
        let input = serde_json::to_vec(&value).map_err(|e| e.to_string())?;
        if input.len() > 8 * 1024 * 1024 {
            return Err("Remote input exceeds 8 MiB".into());
        }
        let mut command = self.command(
            Path::new("python3"),
            &["-c".into(), include_str!("ssh_remote.py").into()],
        )?;
        let output = command_input(&mut command, Some(&input))?;
        if !output.status.success() {
            return Err(format!(
                "SSH operation failed; preserve the original operation and remote path: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }
        serde_json::from_slice(&output.stdout)
            .map_err(|e| format!("Unsupported SSH observation: {e}"))
    }
    pub fn probe(&self) -> Result<SshProbe, String> {
        self.request(json!({"action":"probe"}))
    }
    /// Creates one private directory; an existing attempt is never overwritten.
    pub fn stage(&self, directory: &Path, files: &[StagedFile]) -> Result<(), String> {
        let files = files.iter().map(|f| json!({"name":f.name,"bytes":STANDARD.encode(&f.bytes),"executable":f.executable})).collect::<Vec<_>>();
        let _: Value =
            self.request(json!({"action":"stage","directory":directory,"files":files}))?;
        Ok(())
    }
    /// Exclusive durable intent precedes dispatch. A lost response is reconciled
    /// with observe, never by repeating start with a new process identity.
    pub fn start(
        &self,
        directory: &Path,
        operation: &Identity,
        program: &Path,
        arguments: &[String],
        expected: &[(String, ContentDigest)],
    ) -> Result<RemoteProcessObservation, String> {
        self.request(json!({"action":"start","directory":directory,"operation":operation,"program":program,"arguments":arguments,"expected":expected}))
    }
    pub fn observe(
        &self,
        directory: &Path,
        operation: &Identity,
    ) -> Result<RemoteProcessObservation, String> {
        self.request(json!({"action":"observe","directory":directory,"operation":operation}))
    }
    /// Success may still report running=true. Only a terminal observation proves
    /// the original remote process group stopped, independently of SSH lifetime.
    pub fn cancel(
        &self,
        directory: &Path,
        operation: &Identity,
    ) -> Result<RemoteProcessObservation, String> {
        self.request(json!({"action":"cancel","directory":directory,"operation":operation}))
    }
    /// Explicit bounded files only. A missing/oversized output is an error;
    /// callers retain the remote location instead of inventing an artifact.
    pub fn collect(
        &self,
        directory: &Path,
        names: &[String],
    ) -> Result<Vec<CollectedFile>, String> {
        #[derive(Deserialize)]
        struct File {
            name: String,
            bytes: String,
            sha256: ContentDigest,
        }
        let files: Vec<File> =
            self.request(json!({"action":"collect","directory":directory,"names":names}))?;
        files
            .into_iter()
            .map(|f| {
                let bytes = STANDARD.decode(f.bytes).map_err(|e| e.to_string())?;
                if format!("{:x}", Sha256::digest(&bytes)) != f.sha256.as_str() {
                    return Err("Collected output digest does not match its bytes".into());
                }
                Ok(CollectedFile {
                    name: f.name,
                    bytes,
                    sha256: f.sha256,
                })
            })
            .collect()
    }
}
fn quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

#[cfg(test)]
#[path = "ssh_tests.rs"]
mod tests;
