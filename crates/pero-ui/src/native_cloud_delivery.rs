use super::{CloudSession, identifier};
use pero_contracts::HostEvent;
use serde_json::{Value, json};

impl CloudSession {
    pub(super) fn coding_delivery(&self, action: &str, value: &Value) -> HostEvent {
        let project = identifier(value.get("project"));
        let requested_id = identifier(value.get("id"));
        let mut event = HostEvent::new(
            "project_delivery",
            identifier(value.get("response_id")),
            String::new(),
        );
        let result = (|| {
            let project = project.as_ref().ok_or("Invalid Project")?;
            if !self.configured() || !self.client_mode {
                return Err("Connect as a Project client".into());
            }
            let route = format!("/api/client/v1/projects/{project}/coding-deliveries");
            if action == "remote_delivery_list" {
                return self.get(&route);
            }
            if action == "remote_delivery_more" {
                let cursor = identifier(value.get("before")).ok_or("Invalid delivery cursor")?;
                return self.get(&format!("{route}?before={cursor}"));
            }
            if action == "remote_delivery_create" {
                let request = identifier(value.get("request_id")).ok_or("Invalid request")?;
                return self.read(
                    self.http
                        .post(format!("{}{route}", self.base))
                        .bearer_auth(&self.token)
                        .header("Idempotency-Key", request)
                        .json(&value["manifest"]),
                );
            }
            let id = requested_id.as_ref().ok_or("Invalid Delivery")?;
            if action == "remote_delivery_read" {
                return self.get(&format!("{route}/{id}"));
            }
            let kind = value["kind"]
                .as_str()
                .filter(|kind| matches!(*kind, "proposal" | "candidate" | "approval" | "report"))
                .ok_or("Invalid evidence")?;
            self.get(&format!("{route}/{id}/evidence/{kind}"))
        })();
        event.data = match result {
            Ok(value) => {
                json!({"project":project,"action":action,"id": requested_id,"value":value})
            }
            Err(error) => json!({"project":project,"action":action,"error":error}),
        };
        event
    }
}
