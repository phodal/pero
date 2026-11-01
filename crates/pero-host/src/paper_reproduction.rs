//! Narrow Desktop-approved Paper continuation. Python remains the execution owner.
//! Capability headers are resolved inside Host, never accepted from an App body.
use crate::research_assets::ResearchId;
use pero_runtime::apps::{AppName, AppStore, BackendAccess};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{io::Read, time::Duration};

#[derive(Clone, Deserialize, Serialize)]
#[serde(try_from = "String", into = "String")]
pub(crate) struct RequestId(String);
impl TryFrom<String> for RequestId {
    type Error = String;
    fn try_from(value: String) -> Result<Self, String> {
        if value.is_empty() || value.len() > 128 || value.chars().any(char::is_control) {
            return Err("Use a request ID of 1–128 bytes without control characters".into());
        }
        Ok(Self(value))
    }
}
impl From<RequestId> for String { fn from(value: RequestId) -> Self { value.0 } }

#[derive(Clone, Deserialize, Serialize)]
#[serde(try_from = "String", into = "String")]
pub(crate) struct Ticket(String);
impl TryFrom<String> for Ticket {
    type Error = String;
    fn try_from(value: String) -> Result<Self, String> {
        if value.is_empty() || value.len() > 256 || !value.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_') {
            return Err("Invalid private approval ticket".into());
        }
        Ok(Self(value))
    }
}
impl From<Ticket> for String { fn from(value: Ticket) -> Self { value.0 } }

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Decision { Allow, Deny }

/// The stdio caller is Desktop Main. The browser cannot reach Decide; Main only
/// sends it after its native confirmation, using the private Prepare response.
#[derive(Deserialize, Serialize)]
#[serde(tag = "operation", rename_all = "lowercase", rename_all_fields = "camelCase", deny_unknown_fields)]
pub(crate) enum ReproductionRequest {
    Prepare { item_id: ResearchId, spec_id: ResearchId, request_id: RequestId },
    Decide { item_id: ResearchId, spec_id: ResearchId, request_id: RequestId,
             ticket: Ticket, binding_digest: ResearchId, decision: Decision },
    Cancel { item_id: ResearchId, spec_id: ResearchId, request_id: RequestId },
}

pub(crate) struct PaperReproduction { backend: BackendAccess }
impl PaperReproduction {
    pub(crate) fn resolve(store: &mut AppStore, caller: &AppName) -> Result<Self, String> {
        if caller.as_str() != "paper-agent" {
            return Err("Fixed reproduction is reserved for Paper".into());
        }
        let backend = store.running_backend(caller)?;
        Self::configured(backend)
    }

    fn configured(backend: BackendAccess) -> Result<Self, String> {
        if backend.reproduction_token.is_none() {
            return Err("Paper compute is not enabled by trusted deployment configuration".into());
        }
        Ok(Self { backend })
    }

    pub(crate) fn execute(self, request: ReproductionRequest) -> Result<Value, String> {
        let client = reqwest::blocking::Client::builder().no_proxy()
            .redirect(reqwest::redirect::Policy::none()).timeout(Duration::from_secs(15))
            .build().map_err(|_| "Cannot create the private Paper transport".to_string())?;
        let response = client.post(format!("{}/api/reproduction/host", self.backend.url))
            .header("X-Pero-App-Token", &self.backend.token)
            .header("X-Pero-Compute-Token", self.backend.reproduction_token.as_ref().expect("configured capability"))
            .json(&request).send().map_err(|_| "Paper reproduction request interrupted; inspect the original request before retrying".to_string())?;
        if !response.status().is_success() {
            return Err(format!("Paper reproduction request refused (HTTP {})", response.status().as_u16()));
        }
        let mut bytes = Vec::new();
        response.take(1024 * 1024 + 1).read_to_end(&mut bytes)
            .map_err(|_| "Paper reproduction response interrupted".to_string())?;
        if bytes.len() > 1024 * 1024 { return Err("Paper reproduction response exceeds 1 MiB".into()); }
        serde_json::from_slice(&bytes).map_err(|_| "Paper reproduction returned invalid JSON".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn scope(operation: &str) -> Value {
        json!({"operation":operation,"itemId":"a".repeat(64),"specId":"b".repeat(64),"requestId":"fixture-request"})
    }

    #[test]
    fn shipped_paper_manifest_registers_without_exposing_private_compute() {
        let definition = pero_runtime::apps::AppDefinition::parse(
            include_bytes!("../../../apps/paper-agent/app.json")).expect("actual built-in Paper manifest");
        // Use the real declaration, not a synthetic one-route fixture. The route
        // ceiling remains owned by AppDefinition (including its separate updates).
        assert_eq!(definition.name.as_str(), "paper-agent");
        let manifest: Value = serde_json::from_slice(include_bytes!("../../../apps/paper-agent/app.json")).unwrap();
        let writes = manifest["contributes"]["writes"].as_array().unwrap();
        assert!(!writes.is_empty());
        assert!(writes.iter().all(|route| route["path"] != "/api/reproduction/host"));
        let route = writes.iter().find(|route| route["name"] == "reproduction-step").unwrap();
        assert!(!route["schema"]["properties"]["action"]["enum"].as_array().unwrap().contains(&json!("start")));
    }

    #[test]
    fn only_the_fixed_opaque_scope_and_private_decision_fields_are_accepted() {
        for operation in ["prepare", "cancel"] {
            let value = scope(operation);
            assert!(serde_json::from_value::<ReproductionRequest>(value.clone()).is_ok());
            for key in ["approved", "checkout", "interpreter", "command", "budget", "ticket"] {
                let mut changed = value.clone(); changed[key] = json!("caller-controlled");
                assert!(serde_json::from_value::<ReproductionRequest>(changed).is_err(), "{key}");
            }
        }
        let mut decision = scope("decide");
        assert!(serde_json::from_value::<ReproductionRequest>(decision.clone()).is_err());
        decision["ticket"] = json!("private-ticket");
        decision["bindingDigest"] = json!("c".repeat(64));
        decision["decision"] = json!("allow");
        assert!(serde_json::from_value::<ReproductionRequest>(decision.clone()).is_ok());
        decision["decision"] = json!(true);
        assert!(serde_json::from_value::<ReproductionRequest>(decision).is_err());
        for (field, invalid) in [("itemId", "../data"), ("specId", "short"), ("requestId", ""), ("requestId", "\n")] {
            let mut value = scope("prepare"); value[field] = json!(invalid);
            assert!(serde_json::from_value::<ReproductionRequest>(value).is_err());
        }
    }

    #[test]
    fn ordinary_backend_authority_does_not_enable_computation() {
        let backend = BackendAccess { url: "http://127.0.0.1:1".into(), token: "ordinary".into(), reproduction_token: None };
        assert!(PaperReproduction::configured(backend).is_err());
    }

    #[test]
    fn transport_is_fixed_to_private_paper_route_and_both_host_credentials() {
        use std::io::{BufRead, BufReader, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let worker = std::thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            stream.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
            let mut input = BufReader::new(stream);
            let mut first = String::new(); input.read_line(&mut first).unwrap();
            assert_eq!(first, "POST /api/reproduction/host HTTP/1.1\r\n");
            let mut headers = String::new();
            let mut size = 0;
            loop {
                let mut line = String::new(); input.read_line(&mut line).unwrap();
                if line == "\r\n" { break; }
                if let Some(value) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                    size = value.trim().parse::<usize>().unwrap();
                }
                headers.push_str(&line.to_ascii_lowercase());
            }
            assert!(headers.contains("x-pero-app-token: ordinary-secret\r\n"));
            assert!(headers.contains("x-pero-compute-token: private-compute-secret\r\n"));
            let mut body = vec![0; size]; input.read_exact(&mut body).unwrap();
            assert_eq!(serde_json::from_slice::<Value>(&body).unwrap(), scope("prepare"));
            let response = r#"{"state":"requires-approval","ticket":"one-shot-private","bindingDigest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","summary":"fixed fixture"}"#;
            write!(input.get_mut(), "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", response.len(), response).unwrap();
        });
        let handoff = PaperReproduction::configured(BackendAccess { url: format!("http://{address}"),
            token: "ordinary-secret".into(), reproduction_token: Some("private-compute-secret".into()) }).unwrap();
        let result = handoff.execute(serde_json::from_value(scope("prepare")).unwrap()).unwrap();
        assert_eq!(result["state"], "requires-approval");
        assert!(!result.to_string().contains("private-compute-secret"));
        worker.join().unwrap();
    }

    #[test]
    fn wrong_app_cannot_resolve_private_compute_or_prepare_an_environment() {
        let root = std::env::temp_dir().join(format!("pero-no-compute-{}-{}", std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        let package = root.join("apps/paper-agent");
        std::fs::create_dir_all(&package).unwrap();
        std::fs::write(package.join("app.json"), json!({"schemaVersion":1,"name":"paper-agent", "version":"1", "displayName":"Fixture",
            "contributes":{"panels":[{"id":"main","title":"Fixture","entry":"index.html"}]},
            "backend":{"type":"python","entry":"server.py","dependencies":["never-install-fixture==1"]}}).to_string()).unwrap();
        std::fs::write(package.join(".installation.json"), r#"{"enabled":true}"#).unwrap();
        let mut store = AppStore::open(root.join("apps"), Default::default()).unwrap();
        let other = AppName::try_from("other-app".to_owned()).unwrap();
        assert!(PaperReproduction::resolve(&mut store, &other).is_err());
        let paper = AppName::try_from("paper-agent".to_owned()).unwrap();
        assert!(PaperReproduction::resolve(&mut store, &paper).err().unwrap().contains("Open the configured App"));
        assert!(!root.join("environment").exists());
        assert!(!root.join("app-data").exists());
        drop(store);
        std::fs::write(package.join(".installation.json"), r#"{"enabled":false}"#).unwrap();
        let mut disabled = AppStore::open(root.join("apps"), Default::default()).unwrap();
        assert!(PaperReproduction::resolve(&mut disabled, &paper).err().unwrap().contains("disabled"));
        drop(disabled); std::fs::remove_dir_all(root).unwrap();
    }

}
