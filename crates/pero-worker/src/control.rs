use crate::{
    journal::{Active, Claim},
    model::{Event, Outcome, RemoteGrant, Run},
};
use reqwest::{Url, blocking::Client};
use serde::{Deserialize, de::DeserializeOwned};
use serde_json::{Value, json};
use std::{
    io::Read,
    time::{Duration, Instant},
};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};

#[derive(Debug)]
pub struct CloudFailure {
    message: String,
    pub retryable: bool,
}
impl std::fmt::Display for CloudFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}
impl From<CloudFailure> for String {
    fn from(error: CloudFailure) -> String {
        error.message
    }
}
impl From<String> for CloudFailure {
    fn from(message: String) -> Self {
        Self::permanent(message)
    }
}
impl From<&str> for CloudFailure {
    fn from(message: &str) -> Self {
        Self::permanent(message)
    }
}
impl CloudFailure {
    pub fn retained(mut self) -> Self {
        self.message
            .push_str("; result retained for reconciliation");
        self
    }
    pub fn permanent(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            retryable: false,
        }
    }
}

pub struct Control {
    base: Url,
    token: String,
    client: Client,
}

#[derive(Deserialize)]
pub struct Renewal {
    pub cancel_requested: bool,
    pub lease_expires_at: String,
}

// Leave room below Go's 512 KiB body cap. Count encoded JSON bytes, including
// escapes and the Run envelope, rather than text characters or event count.
const MAX_EVENT_BATCH_BYTES: usize = 480 * 1024;

fn event_batch(active: &Active) -> Result<Vec<&Event>, String> {
    let mut bytes = serde_json::to_vec(&json!({"generation":active.run.generation,"instance_id":active.run.instance_id,"events":[]})).map_err(|e| e.to_string())?.len();
    let mut batch = Vec::new();
    for event in active
        .events
        .iter()
        .filter(|e| e.seq > active.acknowledged)
        .take(16)
    {
        event.validate()?;
        let encoded = serde_json::to_vec(event).map_err(|e| e.to_string())?.len()
            + usize::from(!batch.is_empty());
        if bytes + encoded > MAX_EVENT_BATCH_BYTES {
            break;
        }
        bytes += encoded;
        batch.push(event);
    }
    Ok(batch)
}

impl Control {
    pub fn new(base: &str, token: String) -> Result<Self, String> {
        let base = pero_runtime::local_worker::WorkerOrigin::parse(base)?.into_url();
        let client = Client::builder()
            .timeout(Duration::from_secs(2))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|e| e.to_string())?;
        Ok(Self {
            base,
            token,
            client,
        })
    }

    fn request<T: DeserializeOwned>(
        &self,
        method: reqwest::Method,
        path: &str,
        body: Option<Value>,
    ) -> Result<T, CloudFailure> {
        let url = self
            .base
            .join(path)
            .map_err(|_| CloudFailure::permanent("Invalid API route"))?;
        let mut request = self.client.request(method, url).bearer_auth(&self.token);
        if let Some(body) = body {
            request = request.json(&body);
        }
        let response = request.send().map_err(|_| CloudFailure {
            message: "Cloud connection failed".into(),
            retryable: true,
        })?;
        let status = response.status();
        if !status.is_success() {
            return Err(CloudFailure {
                message: format!("Cloud returned HTTP {}", status.as_u16()),
                retryable: status.is_server_error() || matches!(status.as_u16(), 408 | 429),
            });
        }
        let mut bytes = Vec::new();
        response
            .take(1_048_577)
            .read_to_end(&mut bytes)
            .map_err(|_| CloudFailure::permanent("Invalid Cloud response"))?;
        if bytes.len() > 1_048_576 {
            return Err(CloudFailure::permanent("Cloud response exceeds size limit"));
        }
        serde_json::from_slice(&bytes)
            .map_err(|_| CloudFailure::permanent("Invalid Cloud response"))
    }

    pub fn claim(&self, claim: &Claim) -> Result<Option<Run>, CloudFailure> {
        #[derive(Deserialize)]
        struct Receipt {
            run: Option<Run>,
        }
        self.request::<Receipt>(
            reqwest::Method::POST,
            "/api/worker/v1/claims",
            Some(serde_json::to_value(claim).map_err(|_| "Invalid claim identity")?),
        )
        .map(|r| r.run)
    }
    pub fn origin(&self) -> String {
        self.base.to_string()
    }
    pub fn open_channel(&self, run: &Run, grant: &RemoteGrant) -> Result<(), CloudFailure> {
        #[derive(Deserialize)]
        struct Receipt {
            session_id: String,
        }
        let receipt: Receipt = self.request(
            reqwest::Method::POST,
            &format!("/api/worker/v1/runs/{}/channel", run.id),
            Some(json!({"generation":run.generation,"instance_id":run.instance_id,
                "session_id":grant.session_id,"secret":grant.secret})),
        )?;
        if receipt.session_id != grant.session_id {
            return Err("Remote channel receipt changed identity".into());
        }
        Ok(())
    }
    pub fn inspect(&self, run: &Run) -> Result<Run, CloudFailure> {
        self.request(
            reqwest::Method::GET,
            &format!(
                "/api/worker/v1/runs/{}?instance_id={}",
                run.id, run.instance_id
            ),
            None,
        )
    }
    pub fn renew(&self, run: &Run) -> Result<Renewal, CloudFailure> {
        self.request(
            reqwest::Method::POST,
            &format!("/api/worker/v1/runs/{}/renew", run.id),
            Some(json!({"generation":run.generation,"instance_id":run.instance_id})),
        )
    }
    pub fn flush(&self, active: &Active) -> Result<u64, CloudFailure> {
        let batch = event_batch(active)?;
        if batch.is_empty() {
            return Ok(active.acknowledged);
        }
        #[derive(Deserialize)]
        struct Receipt {
            last_seq: u64,
        }
        let receipt: Receipt = self.request(
            reqwest::Method::POST, &format!("/api/worker/v1/runs/{}/events", active.run.id), Some(json!({"generation":active.run.generation,"instance_id":active.run.instance_id,"events":batch})))?;
        if receipt.last_seq < batch.last().unwrap().seq
            || receipt.last_seq > active.events.last().map_or(0, |e| e.seq)
        {
            return Err("Invalid event acknowledgement".into());
        }
        Ok(receipt.last_seq)
    }
    pub fn complete(&self, run: &Run, result: &Outcome) -> Result<Run, CloudFailure> {
        self.request(reqwest::Method::POST, &format!("/api/worker/v1/runs/{}/complete", run.id), Some(json!({"generation":run.generation,"instance_id":run.instance_id,"outcome":result.outcome,"summary":result.summary})))
    }
}

pub fn lease_deadline(expires: &str, started: Instant) -> Result<Instant, String> {
    let expires =
        OffsetDateTime::parse(expires, &Rfc3339).map_err(|_| "Invalid lease expiration")?;
    let remaining = (expires - OffsetDateTime::now_utc()).whole_milliseconds();
    if !(250..=3_600_000).contains(&remaining) {
        return Err("Lease has expired or exceeds supported duration".into());
    }
    let remaining = Duration::from_millis(remaining as u64);
    Ok(started + remaining - remaining.div_f64(10.0).min(Duration::from_millis(500)))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_remote_plaintext_and_redirect_credentials() {
        assert!(Control::new("http://example.com", "secret".into()).is_err());
        assert!(Control::new("https://u:p@example.com", "secret".into()).is_err());
        assert!(Control::new("http://127.0.0.1:8787", "secret".into()).is_ok());
        assert!(lease_deadline("2020-01-01T00:00:00Z", Instant::now()).is_err());
    }

    #[test]
    fn large_event_batches_fit_go_request_limit_without_losing_order() {
        let text = format!("{}{}", "\\\n".repeat(15000), "x".repeat(5000));
        let mut active = Active {
            run: Run {
                remote_execution: None,
                id: "r".into(),
                generation: 1,
                instance_id: "i".repeat(128),
                status: "running".into(),
                lease_expires_at: String::new(),
                spec: crate::model::Spec {
                    title: String::new(),
                    prompt: String::new(),
                    workspace_key: String::new(),
                    agent_id: String::new(),
                    acceptance: Value::Null,
                },
            },
            request_id: "request".into(),
            acknowledged: 0,
            result: None,
            remote_grant: None,
            events: (1..=16)
                .map(|seq| Event {
                    seq,
                    kind: "session_update".into(),
                    text: text.clone(),
                    data: Value::Null,
                })
                .collect(),
        };
        let mut delivered = Vec::new();
        while active.acknowledged < 16 {
            let batch = event_batch(&active).unwrap();
            assert!(!batch.is_empty());
            assert!(
                batch.len() <= 7,
                "near-64-KiB events must split into multiple requests"
            );
            let body = json!({"generation":active.run.generation,"instance_id":active.run.instance_id,"events":batch});
            assert!(serde_json::to_vec(&body).unwrap().len() <= MAX_EVENT_BATCH_BYTES);
            delivered.extend(batch.iter().map(|event| event.seq));
            active.acknowledged = batch.last().unwrap().seq;
        }
        assert_eq!(delivered, (1..=16).collect::<Vec<_>>());
    }

    #[test]
    fn individual_event_fields_match_go_byte_limits() {
        let mut event = Event {
            seq: 1,
            kind: "session_update".into(),
            text: "x".repeat(64001),
            data: Value::Null,
        };
        assert!(event.validate().is_err());
        event.text.clear();
        event.data = json!("x".repeat(63999));
        assert!(
            event.validate().is_err(),
            "JSON string quotes also count toward Go RawMessage limit"
        );
        event.data = json!("x".repeat(63998));
        assert!(event.validate().is_ok());
    }
}
