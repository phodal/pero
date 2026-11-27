use super::{CloudSession, identifier, read_body};
use pero_contracts::HostEvent;
use serde::Serialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{io::Write, path::Path};

#[derive(Serialize)]
pub(super) struct DesktopWatch {
    task_id: String,
    detail: Value,
    error: Option<String>,
}

impl CloudSession {
    pub(super) fn watch_desktop(&mut self, task_id: Option<&Value>) {
        self.watched_desktop = identifier(task_id).map(|task_id| DesktopWatch {
            task_id: task_id.to_owned(),
            detail: Value::Null,
            error: None,
        });
        self.refresh_watched_desktop();
    }

    pub(super) fn refresh_watched_desktop(&mut self) {
        let Some(mut watch) = self.watched_desktop.take() else {
            return;
        };
        match self.get(&format!("{}/tasks/{}", self.api(), watch.task_id)) {
            Ok(detail) => {
                let task = &detail["task"];
                let run = &detail["run"];
                watch.detail = json!({
                    "task": {"id":task["id"], "current_run_id":task["current_run_id"], "claimed_by":task["claimed_by"]},
                    "run": {"id":run["id"], "status":run["status"], "desktop_profile":run["desktop_profile"],
                        "desktop_handoff":run["desktop_handoff"]},
                });
                watch.error = None;
            }
            Err(error) => watch.error = Some(error),
        }
        self.watched_desktop = Some(watch);
    }

    pub(crate) fn run_desktop(&self, value: &Value) -> HostEvent {
        let mut event = HostEvent::new("native_run_desktop", None, String::new());
        let result = (|| {
            let id = identifier(value.get("run_id")).ok_or("Invalid Run identity")?;
            let route = format!("{}/runs/{id}", self.api());
            match value["action"].as_str() {
                Some("remote_desktop_open") => {
                    let mode = value["mode"]
                        .as_str()
                        .filter(|mode| matches!(*mode, "watch" | "control" | "release" | "return"))
                        .ok_or("Invalid desktop mode")?;
                    let mut command = json!({"id":value["request_id"], "mode":mode});
                    if let Some(handoff_id) = value.get("handoff_id") {
                        command["handoff_id"] = handoff_id.clone();
                    }
                    self.post(&format!("{route}/desktop"), &command)
                }
                Some("remote_desktop_artifacts") => self.get(&format!("{route}/artifacts")),
                Some("remote_desktop_save") => {
                    let file = value["file"]
                        .as_str()
                        .filter(|file| {
                            matches!(
                                *file,
                                "screenshot.png"
                                    | "screenshot.jpg"
                                    | "actions.json"
                                    | "result.blend"
                                    | "result.obj"
                            )
                        })
                        .ok_or("Invalid desktop evidence file")?;
                    let digest = value["sha256"].as_str().ok_or("Missing evidence hash")?;
                    let path = value["path"]
                        .as_str()
                        .map(Path::new)
                        .filter(|path| path.is_absolute())
                        .ok_or("Select a file to save")?;
                    let response = self
                        .http
                        .get(format!(
                            "{}{route}/artifacts/desktop/files/{file}",
                            self.base
                        ))
                        .bearer_auth(&self.token)
                        .send()
                        .map_err(|_| "Could not download Run evidence")?;
                    if !response.status().is_success() {
                        return Err("The Run evidence could not be read".into());
                    }
                    let bytes = read_body(response, 8 << 20)?;
                    if format!("sha256:{:x}", Sha256::digest(&bytes)) != digest {
                        return Err("Run evidence did not match its saved hash".into());
                    }
                    let mut output = std::fs::OpenOptions::new()
                        .write(true)
                        .create_new(true)
                        .open(path)
                        .map_err(|_| "Choose an unused path for this evidence file")?;
                    if output
                        .write_all(&bytes)
                        .and_then(|_| output.sync_all())
                        .is_err()
                    {
                        drop(output);
                        let _ = std::fs::remove_file(path);
                        return Err("Could not save the evidence file".into());
                    }
                    Ok(json!({"saved":file}))
                }
                _ => Err("Invalid Run desktop action".into()),
            }
        })();
        event.data = json!({"run_id":value["run_id"],"request_id":value["request_id"],"action":value["action"],"mode":value["mode"],"handoff_id":value["handoff_id"]});
        match result {
            Ok(result) => event.data["result"] = result,
            Err(error) => event.data["error"] = json!(error),
        }
        event
    }
}
