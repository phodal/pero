//! Cloud account and Run binding for a single explicitly approved Chrome tab.
use super::{CloudSession, identifier};
use crate::native_connectors::NativeConnectors;
use pero_contracts::HostEvent;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

#[derive(PartialEq, Eq)]
struct Run {
    origin: String,
    account: String,
    task_id: String,
    run_id: String,
    title: String,
}

impl CloudSession {
    fn browser_run(&self) -> Option<Run> {
        let task = &self.detail["task"];
        let run = &self.detail["run"];
        let task_id = identifier(task.get("id"))?;
        let run_id = identifier(run.get("id"))?;
        let account = identifier(self.identity.get("id"))?;
        if !self.configured()
            || !self.client_mode
            || self.identity["role"] != "client"
            || self.selected.as_deref() != Some(&task_id)
            || task["claimed_by"]["id"].as_str() != Some(&account)
            || task["current_run_id"].as_str() != Some(&run_id)
            || run["status"] != "running"
        {
            return None;
        }
        Some(Run {
            origin: self.base.clone(),
            account,
            task_id,
            run_id,
            title: task["title"].as_str().unwrap_or_default().to_owned(),
        })
    }

    fn browser_ready(&self, run: &Run) -> Option<bool> {
        let ready = self
            .get(&format!(
                "/api/runtime/v1/runs/{0}/browser/desktop?session_id={0}",
                run.run_id
            ))
            .ok()?;
        (ready["available"] == true).then(|| ready["screenshots"] == true)
    }
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChromeTab {
    tab_id: String,
    grant_id: String,
    origin: String,
    title: String,
}

struct Consent {
    id: String,
    run: Run,
    tab: ChromeTab,
    screenshots: bool,
}

#[derive(Default)]
pub(crate) struct BrowserShare {
    candidate: Option<Consent>,
    active: Option<(String, Run)>,
}

impl BrowserShare {
    pub(crate) fn command(
        &mut self,
        cloud: &CloudSession,
        owner: Option<&NativeConnectors>,
        action: &str,
        request: &Value,
    ) -> Option<HostEvent> {
        let result = (|| {
            let owner = owner.ok_or("browser_use.unavailable")?;
            match action {
                "remote_browser_prepare" => {
                    self.candidate = None;
                    let run = cloud
                        .browser_run()
                        .filter(|run| request["task_id"].as_str() == Some(&run.task_id))
                        .ok_or("browser_use.cloud_select_chrome")?;
                    let screenshots = cloud
                        .browser_ready(&run)
                        .ok_or("browser_use.cloud_not_ready")?;
                    let value = owner
                        .request(json!({"operation":"cloud-browser-target"}))
                        .map_err(|_| "browser_use.unavailable")?;
                    let tab: ChromeTab = serde_json::from_value(value["value"].clone())
                        .map_err(|_| "browser_use.cloud_select_chrome")?;
                    let id = super::idempotency_key();
                    let confirmation = json!({
                        "state":"confirm", "id":id, "taskId":run.task_id, "taskTitle":run.title,
                        "cloudOrigin":run.origin, "pageTitle":tab.title, "pageOrigin":tab.origin,
                        "screenshots":screenshots
                    });
                    self.candidate = Some(Consent {
                        id,
                        run,
                        tab,
                        screenshots,
                    });
                    Ok(Some(confirmation))
                }
                "remote_browser_approve" => {
                    let consent = self
                        .candidate
                        .take()
                        .filter(|consent| request["id"].as_str() == Some(&consent.id))
                        .filter(|consent| cloud.browser_run().as_ref() == Some(&consent.run))
                        .ok_or("browser_use.cloud_select_chrome")?;
                    if cloud.browser_ready(&consent.run) != Some(consent.screenshots) {
                        return Err("browser_use.cloud_not_ready");
                    }
                    self.stop(owner);
                    let result = owner
                        .request(json!({
                            "operation":"cloud-browser-start", "id":consent.id, "token":cloud.token,
                            "origin":consent.run.origin, "runId":consent.run.run_id,
                            "tab":consent.tab, "screenshots":consent.screenshots
                        }))
                        .map_err(|_| "browser_use.unavailable")?;
                    if result["ok"] != true {
                        return Err(if result["reason"] == "tab_changed" {
                            "browser_use.cloud_tab_changed"
                        } else {
                            "browser_use.cloud_not_ready"
                        });
                    }
                    self.active = Some((consent.id, consent.run));
                    Ok(None)
                }
                "remote_browser_dismiss" => {
                    self.candidate = None;
                    Ok(Some(json!({"state":"idle"})))
                }
                "remote_browser_stop" => {
                    self.stop(owner);
                    Ok(Some(json!({"state":"idle"})))
                }
                _ => return Ok(None),
            }
        })();
        let data = match result {
            Ok(data) => data?,
            Err(key) => json!({"state":"error","key":key}),
        };
        let mut event = HostEvent::new("native_cloud_browser", None, String::new());
        event.data = data;
        Some(event)
    }

    pub(crate) fn reconcile(
        &mut self,
        cloud: &CloudSession,
        owner: Option<&NativeConnectors>,
        action: &str,
    ) {
        let current = cloud.browser_run();
        let reset = matches!(
            action,
            "remote_login" | "remote_disconnect" | "remote_configure"
        );
        if self
            .candidate
            .as_ref()
            .is_some_and(|candidate| reset || Some(&candidate.run) != current.as_ref())
        {
            self.candidate = None;
        }
        if self
            .active
            .as_ref()
            .is_some_and(|(_, run)| reset || Some(run) != current.as_ref())
            && let Some(owner) = owner
        {
            self.stop(owner);
        }
    }

    fn stop(&mut self, owner: &NativeConnectors) {
        if let Some((id, _)) = self.active.take() {
            let _ = owner.conversation_command(&json!({"action":"cloud-browser-stop","id":id}));
        }
    }
}
