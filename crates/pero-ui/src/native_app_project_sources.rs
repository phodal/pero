use super::NativeApps;
use serde_json::{Value, json};
use std::{
    sync::{atomic::Ordering, mpsc},
    time::Duration,
};

impl NativeApps {
    pub(crate) fn with_cloud(mut self, cloud: mpsc::Sender<String>) -> Self {
        self.cloud = Some(cloud);
        self
    }

    pub(crate) fn project_source_request(&self, mut request: Value) -> anyhow::Result<Value> {
        let destination = request
            .as_object_mut()
            .and_then(|fields| fields.remove("destination"));
        let method = match destination.as_ref().map(Value::as_str) {
            None => "project_sources",
            Some(Some("shared")) => "shared_project_sources",
            _ => anyhow::bail!("Invalid Project source destination"),
        };
        let id = format!(
            "native-collector-{}",
            self.next.fetch_add(1, Ordering::Relaxed)
        );
        let command = json!({"method":method,"request_id":id,"request":request});
        let reply = self.host_reply(id, command, Duration::from_secs(30))?;
        Ok(json!({"ok":reply.ok,"value":reply.value,"error":reply.error}))
    }
}
