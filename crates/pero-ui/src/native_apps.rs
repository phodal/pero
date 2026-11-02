//! Native App transport. The stdio Host remains the catalog/backend authority.
use pero_contracts::HostEvent;
use serde::{Deserialize, de::DeserializeOwned};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
        mpsc,
    },
    time::Duration,
};
use wry::http::{Request, Response};

#[derive(Deserialize)]
struct Access {
    root: PathBuf,
    entry: String,
    backend: Option<Backend>,
}
#[derive(Deserialize)]
struct Backend {
    url: String,
    token: String,
}
#[derive(Deserialize)]
struct Reply {
    ok: bool,
    value: Option<Value>,
    error: Option<String>,
}

#[derive(Clone)]
pub(crate) struct NativeApps {
    connectors: Option<std::sync::Weak<crate::native_connectors::NativeConnectors>>,
    host: mpsc::Sender<String>,
    pending: Arc<Mutex<BTreeMap<String, mpsc::Sender<Reply>>>>,
    next: Arc<AtomicU64>,
    events: async_channel::Sender<HostEvent>,
    client: reqwest::blocking::Client,
}
impl NativeApps {
    pub fn new(host: mpsc::Sender<String>, events: async_channel::Sender<HostEvent>, connectors: Option<std::sync::Weak<crate::native_connectors::NativeConnectors>>) -> Self {
        Self {
            connectors,
            host,
            events,
            pending: Default::default(),
            next: Default::default(),
            client: reqwest::blocking::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .no_proxy()
                .timeout(Duration::from_secs(30))
                .build()
                .expect("App HTTP client"),
        }
    }
    pub fn require_connectors(&self) -> anyhow::Result<()> {
        self.request::<Value>("connectors", json!({"name":"connectors"}))?;
        Ok(())
    }
    pub fn accept(&self, event: &HostEvent) -> bool {
        if event.kind != "apps_result" {
            return false;
        }
        if let Some(sender) = self
            .pending
            .lock()
            .unwrap()
            .remove(event.request_id.as_deref().unwrap_or(""))
        {
            let reply = serde_json::from_value(event.data.clone()).unwrap_or(Reply {
                ok: false,
                value: None,
                error: Some("Invalid App reply".into()),
            });
            let _ = sender.send(reply);
        }
        true // Private paths and backend credentials never become Workbench events.
    }
    pub(super) fn request<T: DeserializeOwned>(&self, action: &str, fields: Value) -> anyhow::Result<T> {
        let id = format!("native-app-{}", self.next.fetch_add(1, Ordering::Relaxed));
        let mut command = fields;
        command["method"] = json!("apps");
        command["action"] = json!(action);
        command["id"] = json!(id);
        let (sender, receiver) = mpsc::channel();
        self.pending.lock().unwrap().insert(id.clone(), sender);
        let reply = self
            .host
            .send(command.to_string())
            .map_err(anyhow::Error::from)
            .and_then(|_| {
                receiver
                    .recv_timeout(Duration::from_secs(660))
                    .map_err(anyhow::Error::from)
            });
        self.pending.lock().unwrap().remove(&id);
        let reply = reply?;
        if !reply.ok {
            anyhow::bail!(
                "{}",
                reply.error.unwrap_or_else(|| "App request failed".into())
            );
        }
        Ok(serde_json::from_value(reply.value.unwrap_or(Value::Null))?)
    }
    pub(super) fn shell_request(&self, data: Value) -> anyhow::Result<Value> {
        let id = format!("native-surface-{}", self.next.fetch_add(1, Ordering::Relaxed));
        let (sender, receiver) = mpsc::channel();
        self.pending.lock().unwrap().insert(id.clone(), sender);
        let mut event = HostEvent::new("native_app_rpc", Some(id.clone()), String::new());
        event.data = data;
        let result = self.events.send_blocking(event).map_err(anyhow::Error::from)
            .and_then(|_| Ok(receiver.recv_timeout(Duration::from_secs(65))?));
        self.pending.lock().unwrap().remove(&id);
        let reply = result?;
        anyhow::ensure!(reply.ok, "{}", reply.error.unwrap_or_default());
        Ok(reply.value.unwrap_or(Value::Null))
    }
    pub(super) fn shell_reply(&self, id: &str, result: anyhow::Result<Value>) {
        if let Some(sender) = self.pending.lock().unwrap().remove(id) {
            let reply = match result {
                Ok(value) => Reply { ok: true, value: Some(value), error: None },
                Err(error) => Reply { ok: false, value: None, error: Some(error.to_string()) },
            };
            let _ = sender.send(reply);
        }
    }
    pub(super) fn context(&self, request: Value) -> anyhow::Result<Value> {
        let value = self.connectors.as_ref().and_then(std::sync::Weak::upgrade)
            .ok_or_else(||anyhow::anyhow!("Native App tools are unavailable"))?.request(request)?;
        anyhow::ensure!(value.is_array(), "{}", value["message"].as_str().unwrap_or("Native App context is unavailable"));
        Ok(value)
    }
    pub fn command(&self, value: Value) {
        let this = self.clone();
        std::thread::spawn(move || {
            if value["action"] == "apps_project_resources" {
                let app = value["name"].as_str().unwrap_or("").to_string();
                let result = if matches!(app.as_str(), "paper-agent" | "control-lab" | "lab") {
                    this.request::<pero_contracts::project_resources::ProjectResourceCatalog>("projectresources", json!({"name":app}))
                } else { Err(anyhow::anyhow!("This App has no project resource catalog")) };
                let catalog = result.unwrap_or_else(|error| pero_contracts::project_resources::ProjectResourceCatalog { app, resources: Vec::new(), error: Some(error.to_string()) });
                let mut event = HostEvent::new("project_resources", value["request_id"].as_str().map(str::to_string), String::new());
                event.data = serde_json::to_value(catalog).expect("Public resource catalog");
                let _ = this.events.send_blocking(event);
                return;
            }
            let result = (|| -> anyhow::Result<HostEvent> {
                let action = value["action"]
                    .as_str()
                    .unwrap_or("")
                    .trim_start_matches("apps_");
                let mut event = HostEvent::new(
                    if action == "open" {
                        "apps_opened"
                    } else {
                        "apps_catalog"
                    },
                    None,
                    String::new(),
                );
                if action == "open" {
                    let access: Access = this.request("resolve", json!({"name":value["name"]}))?;
                    let catalog: Vec<Value> = this.request("list", json!({}))?;
                    let panel = catalog.iter().find(|app| app["name"] == value["name"] && app["enabled"] == true)
                        .and_then(|app| app["panels"].as_array()).and_then(|panels| panels.iter().find(|panel| panel["id"] == value["panel"]));
                    let entry = panel.and_then(|panel| panel["entry"].as_str()).ok_or_else(|| anyhow::anyhow!("Unknown App panel"))?;
                    let _ = access;
                    event.data = json!({"name":value["name"],"panel":value["panel"],"entry":entry});
                } else {
                    let fields = match action {
                        "list" => json!({}),
                        "install" => json!({"path":value["path"]}),
                        "prepare" | "enable" | "disable" | "uninstall" => json!({"name":value["name"]}),
                        _ => anyhow::bail!("Unsupported App action"),
                    };
                    event.data = this.request(action, fields)?;
                }
                Ok(event)
            })();
            let event = result
                .unwrap_or_else(|error| HostEvent::new("apps_error", None, error.to_string()));
            let _ = this.events.send_blocking(event);
        });
    }
    pub fn serve(&self, name: &str, request: Request<Vec<u8>>) -> Response<Vec<u8>> {
        match self.respond(name, request) {
            Ok(response) => response,
            Err(error) => Response::builder()
                .status(503)
                .header("Content-Type", "text/plain; charset=utf-8")
                .body(error.to_string().into_bytes())
                .unwrap(),
        }
    }
    fn respond(&self, name: &str, request: Request<Vec<u8>>) -> anyhow::Result<Response<Vec<u8>>> {
        let uri = url::Url::parse(&request.uri().to_string())?;
        anyhow::ensure!(
            uri.scheme() == "pero-app" && uri.host_str() == Some(name),
            "App origin refused"
        );
        if let Some(origin) = request.headers().get("Origin") {
            anyhow::ensure!(
                origin == format!("pero-app://{name}").as_str() || origin == "null",
                "App origin refused"
            );
        }
        let path = uri.path();
        // The App webview is not an approved Agent session. Only Host write
        // dispatch may attach the frozen goal and call this private endpoint.
        if matches!(name, "control-lab" | "lab")
            && percent_encoding::percent_decode_str(path).decode_utf8()? == "/api/agent-step"
        {
            return Ok(Response::builder().status(403)
                .header("Cache-Control", "no-store")
                .body(b"Agent route is reserved for the Host".to_vec())?);
        }
        let method = request.method();
        let body = request.body();
        if path == "/host/research-assets" {
            if method != "POST" {
                return Ok(Response::builder().status(405).body(b"Method refused".to_vec())?);
            }
            if body.len() > 4096 {
                return Ok(Response::builder().status(413).body(b"Request too large".to_vec())?);
            }
            let operation: Value = serde_json::from_slice(body)?;
            let value = self.request::<Value>("research-assets", json!({"name":name,"request":operation}))?;
            return Ok(Response::builder().header("Content-Type", "application/json")
                .header("Cache-Control", "no-store").body(serde_json::to_vec(&value)?)?);
        }
        if path == "/host/automation" {
            anyhow::ensure!(method == "POST" && body.len() <= 256_000, "Invalid Automation request");
            let operation: Value = serde_json::from_slice(body)?;
            let value=self.request::<Value>("automation", json!({"name":name,"request":operation}))?;
            return Ok(Response::builder().header("Content-Type","application/json").header("Cache-Control","no-store")
                .body(serde_json::to_vec(&value)?).unwrap());
        }
        if path == "/host/connectors" {
            let response = |status, value: Value| Response::builder().status(status)
                .header("Content-Type", "application/json").header("Cache-Control", "no-store")
                .body(serde_json::to_vec(&value).unwrap()).unwrap();
            if method != "POST" { return Ok(response(405, json!({"ok":false,"code":"MCP_HOST_METHOD"}))); }
            if body.len() > 131072 { return Ok(response(413, json!({"ok":false,"code":"MCP_ARGUMENT"}))); }
            if self.request::<Value>("connectors", json!({"name":name})).is_err() {
                return Ok(response(403, json!({"ok":false,"code":"MCP_HOST_FORBIDDEN"})));
            }
            let operation: Value = match serde_json::from_slice(body) {
                Ok(value) => value,
                Err(_) => return Ok(response(400, json!({"ok":false,"code":"MCP_ARGUMENT"}))),
            };
            return Ok(match self.connectors.as_ref().and_then(std::sync::Weak::upgrade).map(|owner| owner.request(operation)) {
                Some(Ok(value)) => response(200, value),
                _ => response(503, json!({"ok":false,"code":"MCP_HOST_UNAVAILABLE"})),
            });
        }
        let (status, content_type, data) = if matches!(path, "/host/agent" | "/host/point-agent" | "/host/insights") {
            anyhow::ensure!(
                method == "POST" && body.len() <= 256_000,
                "Invalid App Host request"
            );
            let operation: Value = serde_json::from_slice(body)?;
            let (action, fields) = if path == "/host/point-agent" {
                ("pointagent", json!({"name":name,"request":operation}))
            } else if path == "/host/agent" {
                ("agent", json!({"name":name,"request":operation}))
            } else {
                let mut fields = json!({"name":name});
                if let Some(thread) = operation.get("threadId") {
                    fields["threadId"] = thread.clone();
                }
                ("insights", fields)
            };
            let value: Value = self.request(action, fields)?;
            (
                200,
                "application/json".to_string(),
                serde_json::to_vec(&value)?,
            )
        } else {
            let access: Access = self.request("resolve", json!({"name":name}))?;
            if matches!(path,"/api/workspaces"|"/api/harnesses") {
                anyhow::ensure!(method == "GET" && uri.query().is_none(),"Method refused");
                let value:Value=self.request("pointcatalog",json!({"name":name,"path":path}))?;
                return Ok(Response::builder().status(200).header("Content-Type","application/json").header("Cache-Control","no-store").body(serde_json::to_vec(&value)?)?);
            }
            if path.starts_with("/api/") {
                anyhow::ensure!(body.len() <= 16 * 1024 * 1024, "Request too large");
                let backend = access
                    .backend
                    .ok_or_else(|| anyhow::anyhow!("This App has no backend"))?;
                let target = format!(
                    "{}{}{}",
                    backend.url,
                    path,
                    uri.query()
                        .map(|query| format!("?{query}"))
                        .unwrap_or_default()
                );
                let response = self
                    .client
                    .request(
                        reqwest::Method::from_bytes(method.as_str().as_bytes())?,
                        target,
                    )
                    .header("X-Pero-App-Token", backend.token)
                    .header(
                        "Content-Type",
                        request
                            .headers()
                            .get("Content-Type")
                            .and_then(|value| value.to_str().ok())
                            .unwrap_or("application/json"),
                    )
                    .body(body.clone())
                    .send()?;
                let status = response.status().as_u16();
                let content_type = response
                    .headers()
                    .get("Content-Type")
                    .and_then(|value| value.to_str().ok())
                    .unwrap_or("application/json")
                    .to_string();
                (status, content_type, response.bytes()?.to_vec())
            } else {
                anyhow::ensure!(method == "GET", "Method refused");
                let asset_path=path.to_owned();
                let path = percent_encoding::percent_decode_str(&asset_path).decode_utf8()?;
                let assets = access
                    .root
                    .join(&access.entry)
                    .parent()
                    .unwrap()
                    .canonicalize()?;
                let file = access
                    .root
                    .join(path.trim_start_matches('/'))
                    .canonicalize()?;
                anyhow::ensure!(
                    file.starts_with(&assets) && file.is_file(),
                    "App asset unavailable"
                );
                (
                    200,
                    mime_guess::from_path(&file)
                        .first_or_octet_stream()
                        .to_string(),
                    std::fs::read(file)?,
                )
            }
        };
        Ok(Response::builder().status(status).header("Content-Type", content_type).header("Cache-Control", "no-store")
            .header("X-Content-Type-Options", "nosniff")
            .header("Content-Security-Policy", "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'")
            .body(data)?)
    }
}

#[cfg(test)]
mod research_assets_tests {
    use super::*;

    #[test]
    fn research_agent_route_is_denied_before_resolve_or_dispatch() {
        let (host, requests) = mpsc::channel();
        let (events, _) = async_channel::unbounded();
        let apps = NativeApps::new(host, events, None);
        for app in ["control-lab", "lab"] {
            for path in ["/api/agent-step", "/api/agent-step?ignored=1",
                "/api/extra/../agent-step", "/api/%61gent-step", "/api%2Fagent-step",
                "/api/extra/%2e%2e/agent-step"] {
                for method in ["GET", "POST"] {
                    let response = apps.serve(app, Request::builder()
                        .uri(format!("pero-app://{app}{path}"))
                        .method(method).header("Origin", format!("pero-app://{app}"))
                        .body(b"{}".to_vec()).unwrap());
                    assert_eq!(response.status(), 403, "{app} {method} {path}");
                    assert_eq!(response.body(), b"Agent route is reserved for the Host");
                    assert!(requests.try_recv().is_err());
                }
            }
        }
    }

    #[test]
    fn research_asset_route_forwards_only_the_origin_and_operation_to_host() {
        let (host, requests) = mpsc::channel();
        let (events, _) = async_channel::unbounded();
        let apps = NativeApps::new(host, events, None);
        for operation in ["start", "status", "cancel"] {
            let body = json!({"operation":operation,"bundleId":"a".repeat(64),"assetId":"b".repeat(64)});
            let expected = body.clone();
            let serving = apps.clone();
            let response = std::thread::spawn(move || serving.serve("paper-agent", Request::builder()
                .uri("pero-app://paper-agent/host/research-assets").method("POST")
                .header("Origin", "pero-app://paper-agent")
                .body(serde_json::to_vec(&body).unwrap()).unwrap()));
            let command: Value = serde_json::from_str(&requests.recv_timeout(Duration::from_secs(2)).unwrap()).unwrap();
            assert_eq!(command["method"], "apps");
            assert_eq!(command["action"], "research-assets");
            assert_eq!(command["name"], "paper-agent");
            assert_eq!(command["request"], expected);
            let mut reply = HostEvent::new("apps_result", command["id"].as_str().map(str::to_owned), String::new());
            reply.data = json!({"ok":true,"value":{"state":"queued"}});
            assert!(apps.accept(&reply));
            let response = response.join().unwrap();
            assert_eq!(response.status(), 200);
            assert_eq!(response.headers()["Cache-Control"], "no-store");
            assert_eq!(serde_json::from_slice::<Value>(response.body()).unwrap(), json!({"state":"queued"}));
        }
        for (method, origin, body, status) in [
            ("GET", "pero-app://paper-agent", vec![], 405),
            ("POST", "pero-app://paper-agent", vec![b' '; 4097], 413),
            ("POST", "pero-app://other-app", vec![], 503),
        ] {
            let response = apps.serve("paper-agent", Request::builder().uri("pero-app://paper-agent/host/research-assets")
                .method(method).header("Origin", origin).body(body).unwrap());
            assert_eq!(response.status(), status);
            assert!(requests.try_recv().is_err());
        }
    }
}
