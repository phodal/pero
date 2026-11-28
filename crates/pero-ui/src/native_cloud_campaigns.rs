use super::CloudSession;
use pero_contracts::{HostEvent, project_source::SharedWebSourceTarget};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
enum Request {
    List {
        target: SharedWebSourceTarget,
    },
    Read {
        target: SharedWebSourceTarget,
        id: String,
    },
    Review {
        target: SharedWebSourceTarget,
        id: String,
        decision: Decision,
    },
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Decision {
    gate_id: String,
    plan_digest: String,
    evidence_digest: String,
    choice: String,
}

fn segment(text: &str) -> Result<&str, String> {
    if text.is_empty()
        || text.len() > 96
        || !text
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
    {
        return Err("Invalid Campaign identity".into());
    }
    Ok(text)
}

impl CloudSession {
    pub(crate) fn shared_campaigns(&self, command: &Value) -> HostEvent {
        let mut event = HostEvent::new(
            "project_campaigns_result",
            command["request_id"].as_str().map(str::to_owned),
            String::new(),
        );
        let result = serde_json::from_value(command["request"].clone())
            .map_err(|_| "Invalid Campaign request".to_owned())
            .and_then(|request| self.shared_campaign_request(request));
        event.data = match result {
            Ok(value) => json!({"ok":true,"value":value}),
            Err(error) => json!({"ok":false,"error":error}),
        };
        event
    }

    fn shared_campaign_request(&self, request: Request) -> Result<Value, String> {
        let target = match &request {
            Request::List { target }
            | Request::Read { target, .. }
            | Request::Review { target, .. } => target,
        };
        let base = self.shared_project_route(target)?;
        match request {
            Request::List { .. } => self.get(&format!("{base}/campaigns")),
            Request::Read { id, .. } => self.get(&format!("{base}/campaigns/{}", segment(&id)?)),
            Request::Review { id, decision, .. } => {
                let gate = segment(&decision.gate_id)?;
                if !matches!(decision.choice.as_str(), "approve" | "reject")
                    || [&decision.plan_digest, &decision.evidence_digest]
                        .iter()
                        .any(|digest| {
                            digest.len() != 64 || !digest.bytes().all(|b| b.is_ascii_hexdigit())
                        })
                {
                    return Err("Invalid Campaign decision".into());
                }
                let url = format!("{}{base}/campaigns/{}/review", self.base, segment(&id)?);
                self.read(
                    self.http
                        .post(url)
                        .bearer_auth(&self.token)
                        .header(
                            "Idempotency-Key",
                            format!("desktop-{gate}-{}", decision.choice),
                        )
                        .json(&decision),
                )
            }
        }
    }
}
