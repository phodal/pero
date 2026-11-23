use super::CloudSession;
use pero_contracts::{
    HostEvent,
    project_source::{SharedWebSourceRequest, SharedWebSourceTarget},
};
use serde_json::{Value, json};

impl CloudSession {
    pub(crate) fn shared_web_sources(&self, command: &Value) -> HostEvent {
        let id = command["request_id"].as_str().map(str::to_owned);
        let mut event = HostEvent::new("project_sources_result", id, String::new());
        let response = serde_json::from_value(command["request"].clone())
            .map_err(|_| "Invalid shared Project source request".to_owned())
            .and_then(|request| self.shared_web_source_request(request));
        event.data = match response {
            Ok(value) => json!({"ok":true,"value":value}),
            Err(error) => json!({"ok":false,"error":error}),
        };
        event
    }

    fn shared_web_source_request(&self, request: SharedWebSourceRequest) -> Result<Value, String> {
        let account = self.identity["id"].as_str().filter(|id| !id.is_empty());
        let signed_in = self.configured()
            && self.client_mode
            && self.identity["role"] == "client"
            && account.is_some();
        let projects = self.identity["projects"].as_array();
        let route = |target: SharedWebSourceTarget| -> Result<String, String> {
            if !signed_in
                || target.origin != self.base
                || account != Some(target.account_id.as_str())
                || !projects.is_some_and(|items| {
                    items
                        .iter()
                        .any(|item| item.as_str() == Some(&target.project_id))
                })
            {
                return Err(
                    "The shared Project or Cloud account changed. Select the destination again."
                        .into(),
                );
            }
            target
                .route()
                .ok_or_else(|| "Invalid shared Project identity".into())
        };
        match request {
            SharedWebSourceRequest::Projects {} => {
                let mut choices = Vec::new();
                if let Some(account_id) = account.filter(|_| signed_in) {
                    for id in projects.into_iter().flatten().filter_map(Value::as_str) {
                        let target = SharedWebSourceTarget {
                            project_id: id.into(),
                            origin: self.base.clone(),
                            account_id: account_id.into(),
                        };
                        if target.route().is_some() {
                            choices.push(json!({"id":id,"title":id,"target":target}));
                        }
                    }
                }
                Ok(json!({"projects":choices}))
            }
            SharedWebSourceRequest::List { target } => self.get(&route(target)?),
            SharedWebSourceRequest::Read { target, id } => {
                self.get(&format!("{}/{}", route(target)?, id.as_str()))
            }
            SharedWebSourceRequest::Save { target, source } => {
                let body = serde_json::to_value(source)
                    .map_err(|_| "Invalid reviewed source".to_owned())?;
                self.post(&route(target)?, &body)
            }
        }
    }
}
