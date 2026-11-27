use crate::{
    control::Control,
    executor::{Execution, bounded_line},
    model::{Outcome, Run},
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    io::{BufReader, Write},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::mpsc,
    time::{Duration, Instant},
};

#[derive(Deserialize)]
struct DesktopMcp {
    url: String,
    access: String,
}

pub(crate) struct RunDesktop {
    child: Child,
    replies: mpsc::Receiver<Value>,
}

impl RunDesktop {
    pub(crate) fn start(
        control: &Control,
        run: &Run,
        execution: &mut Execution,
    ) -> Result<Self, String> {
        if !cfg!(target_os = "linux") || run.remote_execution.is_some() {
            return Err("The Blender profile requires a self-hosted Linux Worker".into());
        }
        let script = PathBuf::from(crate::required("PERO_RUN_DESKTOP_SCRIPT")?);
        if !script.is_absolute() || !script.is_file() {
            return Err("Configure an installed absolute Run desktop script".into());
        }
        let node = std::env::var_os("PERO_RUN_DESKTOP_NODE").unwrap_or_else(|| "node".into());
        let token = crate::required("PERO_WORKER_TOKEN")?;
        let mut child = Command::new(node)
            .arg(script)
            .env_remove("PERO_WORKER_TOKEN")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .map_err(|_| "Cannot start the Run desktop process")?;
        let stdout = child.stdout.take().unwrap();
        let (out, replies) = mpsc::sync_channel(2);
        std::thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            while let Ok(Some(line)) = bounded_line(&mut reader, 8 * 1024) {
                let Ok(value) = serde_json::from_slice(&line) else {
                    break;
                };
                if out.send(value).is_err() {
                    break;
                }
            }
        });
        let mut desktop = Self { child, replies };
        let init = json!({"id":run.id,"instance_id":run.instance_id,"generation":run.generation,"url":control.origin(),"token":token});
        writeln!(desktop.child.stdin.as_mut().unwrap(), "{init}")
            .map_err(|_| "Cannot initialize the Run desktop process")?;
        let reply = desktop
            .replies
            .recv_timeout(Duration::from_secs(18))
            .map_err(|_| "Run desktop did not start")?;
        let mcp: DesktopMcp =
            serde_json::from_value(reply).map_err(|_| "Invalid Run desktop response")?;
        let url = reqwest::Url::parse(&mcp.url).map_err(|_| "Invalid Run desktop MCP URL")?;
        if url.scheme() != "http"
            || url.host_str() != Some("127.0.0.1")
            || url.port().is_none()
            || url.path() != "/mcp"
            || url.query().is_some()
            || url.fragment().is_some()
            || !url.username().is_empty()
            || url.password().is_some()
            || uuid::Uuid::parse_str(&mcp.access).is_err()
        {
            return Err("Run desktop MCP must use a scoped loopback endpoint".into());
        }
        execution.attach_desktop(url.as_str(), &mcp.access)?;
        Ok(desktop)
    }

    pub(crate) fn finish(mut self, control: &Control, run: &Run, outcome: Outcome) -> Outcome {
        if outcome.outcome == "reconcile" {
            return outcome;
        }
        let sent = self
            .child
            .stdin
            .take()
            .is_some_and(|mut input| writeln!(input, "finish").is_ok());
        if !sent {
            return Outcome::new(
                "reconcile",
                "Run desktop exited before evidence collection and cleanup could be confirmed",
            );
        }
        let deadline = Instant::now() + Duration::from_secs(45);
        while Instant::now() < deadline {
            let _ = control.renew(run);
            match self.replies.recv_timeout(Duration::from_secs(2)) {
                Ok(reply) => {
                    let files = reply["files"].as_array();
                    let complete = files.is_some_and(|files| {
                        let has = |name| files.iter().any(|file| file.as_str() == Some(name));
                        has("actions.json")
                            && has("result.blend")
                            && (has("screenshot.png") || has("screenshot.jpg"))
                    });
                    return if outcome.outcome == "succeeded" && !complete {
                        Outcome::new(
                            "failed",
                            "Blender Run ended with missing screenshots, action receipts, or model evidence; inspect its artifacts",
                        )
                    } else {
                        outcome
                    };
                }
                Err(mpsc::RecvTimeoutError::Timeout) => continue,
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
        Outcome::new(
            "reconcile",
            "Run desktop cleanup could not be confirmed; inspect the original Run and Worker",
        )
    }
}

impl Drop for RunDesktop {
    fn drop(&mut self) {
        drop(self.child.stdin.take());
        let until = Instant::now() + Duration::from_secs(12);
        while Instant::now() < until {
            if !matches!(self.child.try_wait(), Ok(None)) {
                return;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
