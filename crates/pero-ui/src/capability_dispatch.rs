//! Native half of the inventory dispatch. The table is
//! `protocol/inventory/capabilities.json`. Routing is not a grant.
use serde_json::{Map, Value, json};
use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

#[cfg_attr(not(feature = "native"), allow(dead_code))]
pub struct CapabilityRejection {
    pub body: Vec<u8>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DispatchError {
    pub code: &'static str,
    pub capability: Option<String>,
    pub operation: Option<String>,
}

#[derive(Clone, Debug)]
pub struct Envelope {
    pub route: String,
    pub body: Value,
    pub owner: String,
    pub inject_operation: bool,
}

struct Table {
    families: HashMap<String, Value>,
    operations_by_route: HashMap<String, HashSet<String>>,
}

fn table() -> &'static Table {
    static TABLE: OnceLock<Table> = OnceLock::new();
    TABLE.get_or_init(|| {
        let inventory: Value = serde_json::from_str(include_str!(
            "../../../protocol/inventory/capabilities.json"
        ))
        .expect("capability inventory");
        let mut families = HashMap::new();
        let mut operations_by_route: HashMap<String, HashSet<String>> = HashMap::new();
        for family in inventory["families"].as_array().expect("families") {
            let id = family["id"].as_str().expect("family id").to_owned();
            for operation in family["operations"].as_array().expect("operations") {
                let route = operation["route"].as_str().expect("route").to_owned();
                let name = operation["name"].as_str().expect("name").to_owned();
                operations_by_route.entry(route).or_default().insert(name);
            }
            families.insert(id, family.clone());
        }
        Table {
            families,
            operations_by_route,
        }
    })
}

fn reject(
    code: &'static str,
    capability: Option<String>,
    operation: Option<String>,
) -> DispatchError {
    DispatchError {
        code,
        capability,
        operation,
    }
}

fn envelope_carrier(operation: &Value) -> bool {
    operation["carrier"]
        .as_str()
        .is_some_and(|carrier| carrier.contains("envelope"))
}

pub fn dispatch_envelope(value: &Value) -> Result<Envelope, DispatchError> {
    let Some(raw) = value.as_object() else {
        return Err(reject("invalid_input", None, None));
    };
    let capability = raw
        .get("capability")
        .and_then(Value::as_str)
        .map(str::to_owned);
    let operation = raw
        .get("operation")
        .and_then(Value::as_str)
        .map(str::to_owned);
    let Some(family) = capability
        .as_deref()
        .and_then(|id| table().families.get(id))
    else {
        return Err(reject("unknown_operation", capability, operation));
    };
    let Some(input) = raw.get("input").and_then(Value::as_object) else {
        return Err(reject(
            "invalid_input",
            capability,
            operation.filter(|item| !item.is_empty()).or(None),
        ));
    };
    if operation.as_deref().is_none_or(str::is_empty) {
        return Err(reject("invalid_input", capability, operation));
    }
    let operation = operation.unwrap();
    if family["id"] == "automation" {
        if input.contains_key("operation") {
            return Err(reject("invalid_input", capability, Some(operation)));
        }
        return Ok(Envelope {
            route: family["route"].as_str().unwrap().to_owned(),
            body: Value::Object(input.clone()),
            owner: family["owner"].as_str().unwrap_or("host").to_owned(),
            inject_operation: false,
        });
    }
    let operations = family["operations"].as_array().unwrap();
    if operations.is_empty() {
        let mut body = input.clone();
        body.insert("operation".into(), json!(operation));
        return Ok(Envelope {
            route: family["route"].as_str().unwrap().to_owned(),
            body: Value::Object(body),
            owner: family["owner"].as_str().unwrap_or("host").to_owned(),
            inject_operation: true,
        });
    }
    let matches: Vec<&Value> = operations
        .iter()
        .filter(|item| item["name"] == operation)
        .collect();
    if matches.is_empty() {
        return Err(reject("unknown_operation", capability, Some(operation)));
    }
    let selected = if family["id"] == "agent" {
        matches.into_iter().find(|item| envelope_carrier(item))
    } else {
        matches.into_iter().next()
    };
    let Some(selected) = selected else {
        return Err(reject("unknown_operation", capability, Some(operation)));
    };
    let mut body = input.clone();
    body.insert("operation".into(), json!(operation));
    Ok(Envelope {
        route: selected["route"].as_str().unwrap().to_owned(),
        body: Value::Object(body),
        owner: selected["owner"].as_str().unwrap_or("host").to_owned(),
        inject_operation: true,
    })
}

pub fn direct_operation(path: &str, body: &Value) -> Result<(), DispatchError> {
    if path == "/host/insights" {
        return Ok(());
    }
    if path == "/host/automation" {
        if body
            .as_object()
            .is_some_and(|object| object.contains_key("operation"))
        {
            let operation = body
                .get("operation")
                .and_then(Value::as_str)
                .map(str::to_owned);
            return Err(reject(
                "invalid_input",
                Some("automation".into()),
                operation,
            ));
        }
        return Ok(());
    }
    let Some(allowed) = table().operations_by_route.get(path) else {
        return Ok(());
    };
    let Some(object) = body.as_object() else {
        return Err(reject("invalid_input", None, None));
    };
    let operation = object.get("operation").and_then(Value::as_str);
    if operation.is_none_or(|name| !allowed.contains(name)) {
        return Err(reject(
            "unknown_operation",
            None,
            operation.map(str::to_owned),
        ));
    }
    Ok(())
}

#[cfg_attr(not(feature = "native"), allow(dead_code))]
pub fn error_response(error: &DispatchError) -> CapabilityRejection {
    let mut body = Map::new();
    body.insert("code".into(), json!(error.code));
    body.insert("message".into(), json!("Host capability unavailable"));
    if let Some(capability) = &error.capability {
        body.insert("capability".into(), json!(capability));
    }
    if let Some(operation) = &error.operation {
        body.insert("operation".into(), json!(operation));
    }
    CapabilityRejection {
        body: serde_json::to_vec(&Value::Object(body)).expect("capability error"),
    }
}

/// HTTP 403 for a migrated family. The route decision stays here; NativeApps only forwards.
#[cfg(feature = "native")]
pub fn rejection_response(error: &DispatchError) -> wry::http::Response<Vec<u8>> {
    wry::http::Response::builder()
        .status(403)
        .header("Content-Type", "application/json")
        .header("Cache-Control", "no-store")
        .body(error_response(error).body)
        .expect("capability error response")
}

/// Admit a parsed direct-route body. `Err` is the response NativeApps returns.
#[cfg(feature = "native")]
pub fn admit_route(path: &str, body: &Value) -> Result<(), wry::http::Response<Vec<u8>>> {
    direct_operation(path, body).map_err(|error| rejection_response(&error))
}

#[cfg(all(test, feature = "native"))]
mod native_adapter {
    use super::*;
    use crate::native_apps::NativeApps;
    use pero_contracts::HostEvent;
    use std::sync::mpsc;
    use std::time::Duration;
    use wry::http::Request;

    fn spawn_serve(
        apps: &NativeApps,
        path: &str,
        body: &Value,
    ) -> std::thread::JoinHandle<wry::http::Response<Vec<u8>>> {
        let serving = apps.clone();
        let path = path.to_owned();
        let bytes = serde_json::to_vec(body).unwrap();
        std::thread::spawn(move || {
            serving.serve(
                "paper-agent",
                Request::builder()
                    .method("POST")
                    .uri(format!("pero-app://paper-agent{path}"))
                    .header("Origin", "pero-app://paper-agent")
                    .body(bytes)
                    .unwrap(),
            )
        })
    }

    fn finish(
        apps: &NativeApps,
        requests: &mpsc::Receiver<String>,
        action: &str,
        forward: &Value,
    ) -> Value {
        let command: Value =
            serde_json::from_str(&requests.recv_timeout(Duration::from_secs(2)).unwrap()).unwrap();
        assert_eq!(command["action"], action);
        assert_eq!(command["request"], *forward);
        let mut reply = HostEvent::new(
            "apps_result",
            command["id"].as_str().map(str::to_owned),
            String::new(),
        );
        reply.data = json!({"ok":true,"value":{"state":"queued"}});
        assert!(apps.accept(&reply));
        command
    }

    #[test]
    fn native_adapter_forwards_the_corpus_and_denies_unknown_operations() {
        let (host, requests) = mpsc::channel();
        let (events, _) = async_channel::unbounded();
        let apps = NativeApps::new(host, events, None);
        let cases: Vec<Value> = serde_json::from_str(include_str!(
            "../../../protocol/fixtures/capability-dispatch/cases.json"
        ))
        .unwrap();
        let status = cases
            .iter()
            .find(|item| item["id"] == "agent-status")
            .unwrap();
        let response = spawn_serve(&apps, "/host/capability", &status["body"]);
        finish(&apps, &requests, "agentrun", &status["forward"]);
        assert_eq!(response.join().unwrap().status(), 200);

        let queries = cases
            .iter()
            .find(|item| item["id"] == "research-queries")
            .unwrap();
        let response = spawn_serve(&apps, "/host/capability", &queries["body"]);
        finish(&apps, &requests, "research-assets", &queries["forward"]);
        assert_eq!(response.join().unwrap().status(), 200);

        let automation = cases
            .iter()
            .find(|item| item["id"] == "automation-envelope")
            .unwrap();
        let response = spawn_serve(&apps, "/host/capability", &automation["body"]);
        let command = finish(&apps, &requests, "automation", &automation["forward"]);
        assert!(command["request"].get("operation").is_none());
        assert_eq!(response.join().unwrap().status(), 200);

        for id in [
            "unknown-capability",
            "agent-info-envelope",
            "direct-app-agent-science",
            "direct-research-read",
        ] {
            let case = cases.iter().find(|item| item["id"] == id).unwrap();
            let path = if case["kind"] == "direct" {
                case["path"].as_str().unwrap()
            } else {
                "/host/capability"
            };
            let response = spawn_serve(&apps, path, &case["body"]);
            let response = response.join().unwrap();
            assert_eq!(response.status(), 403, "{id}");
            let payload: Value = serde_json::from_slice(response.body()).unwrap();
            assert_eq!(payload["code"], case["error"], "{id}");
            assert!(requests.try_recv().is_err(), "{id}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shared_corpus_matches_the_inventory_dispatch() {
        let cases: Vec<Value> = serde_json::from_str(include_str!(
            "../../../protocol/fixtures/capability-dispatch/cases.json"
        ))
        .unwrap();
        for case in cases {
            let id = case["id"].as_str().unwrap();
            if case["kind"] == "direct" {
                let result = direct_operation(case["path"].as_str().unwrap(), &case["body"]);
                if let Some(code) = case["error"].as_str() {
                    assert_eq!(result.unwrap_err().code, code, "{id}");
                } else {
                    result.unwrap_or_else(|error| panic!("{id} {}", error.code));
                }
                continue;
            }
            let result = dispatch_envelope(&case["body"]);
            if let Some(code) = case["error"].as_str() {
                assert_eq!(result.unwrap_err().code, code, "{id}");
                continue;
            }
            let envelope = result.unwrap_or_else(|error| panic!("{id} {}", error.code));
            assert_eq!(envelope.route, case["route"].as_str().unwrap(), "{id}");
            assert_eq!(envelope.owner, case["owner"].as_str().unwrap(), "{id}");
            assert_eq!(
                envelope.inject_operation,
                case["injectOperation"].as_bool().unwrap(),
                "{id}"
            );
            assert_eq!(envelope.body, case["forward"], "{id}");
        }
    }

    #[test]
    fn protocol_ready_corpus_matches_native_dispatch() {
        let corpus: Value = serde_json::from_str(include_str!(
            "../../../protocol/fixtures/protocol-ready/corpus.json"
        ))
        .unwrap();
        for case in corpus["dispatch"].as_array().unwrap() {
            let id = case["id"].as_str().unwrap();
            let result = dispatch_envelope(&case["body"]);
            if let Some(code) = case["error"].as_str() {
                assert_eq!(result.unwrap_err().code, code, "{id}");
                continue;
            }
            let envelope = result.unwrap_or_else(|error| panic!("{id} {}", error.code));
            assert_eq!(envelope.route, case["route"].as_str().unwrap(), "{id}");
            assert_eq!(envelope.owner, case["owner"].as_str().unwrap(), "{id}");
            assert_eq!(envelope.inject_operation, case["injectOperation"].as_bool().unwrap(), "{id}");
            assert_eq!(envelope.body, case["forward"], "{id}");
            assert_eq!(case["remote"].as_bool(), Some(false), "{id}");
            assert!(envelope.route.starts_with("/host/"), "{id}");
        }
    }
}
