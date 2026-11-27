use super::{CloudSession, identifier, read_body};
use pero_contracts::HostEvent;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{io::Write, path::Path};

impl CloudSession {
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
