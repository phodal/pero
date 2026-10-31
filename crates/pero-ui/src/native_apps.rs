//! Native App transport. The stdio Host remains the catalog/backend authority.
#[path = "native_point_apps.rs"]
mod point;
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
                        "enable" | "disable" | "uninstall" => json!({"name":value["name"]}),
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
        let method = request.method();
        let body = request.body();
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
        let mut response_headers = Vec::new();
        let (status, content_type, data) = if matches!(path, "/host/agent" | "/host/insights") {
            anyhow::ensure!(
                method == "POST" && body.len() <= 256_000,
                "Invalid App Host request"
            );
            let operation: Value = serde_json::from_slice(body)?;
            let (action, fields) = if path == "/host/agent" {
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
            let point = point::PointApp::read(&access.root)?;
            if let Some(point) = &point {
                if path == "/api/projects" || path.starts_with("/api/projects/") {
                    anyhow::ensure!(method == "GET" || method == "POST", "Method refused");
                    anyhow::ensure!(body.len() <= 65536, "Project request exceeds 64 KiB");
                    let mut headers = serde_json::Map::new();
                    for key in ["idempotency-key", "if-match"] {
                        if let Some(value) = request.headers().get(key) { headers.insert(key.into(), Value::String(value.to_str()?.into())); }
                    }
                    let mut operation = json!({"method":method.as_str(),"path":format!("{path}{}",uri.query().map(|q|format!("?{q}")).unwrap_or_default()),"headers":headers});
                    if !body.is_empty() { operation["body"] = serde_json::from_slice(body)?; }
                    let value: Value = self.request("pointprojects", json!({"name":name,"request":operation}))?;
                    let mut response = Response::builder().status(value["status"].as_u64().ok_or_else(||anyhow::anyhow!("Invalid Project status"))? as u16);
                    if let Some(headers) = value["headers"].as_object() { for (key,value) in headers { response = response.header(key, value.as_str().ok_or_else(||anyhow::anyhow!("Invalid Project header"))?); } }
                    return Ok(response.body(serde_json::to_vec(&value["body"])?)?);
                }
                if path == format!("/api/apps/{name}/config") {
                    anyhow::ensure!(point.permissions.storage && point.permissions.api.iter().any(|route| route == path), "App storage permission denied");
                    anyhow::ensure!(method == "GET" || method == "PUT", "Method refused");
                    let mut fields = json!({"name":name});
                    if method == "PUT" {
                        anyhow::ensure!(body.len() <= 1048576, "Config exceeds 1 MiB");
                        let config: Value = serde_json::from_slice(body)?;
                        anyhow::ensure!(config.is_object(), "Config must be an object");
                        fields["config"] = config;
                    }
                    let value: Value = self.request("pointconfig", fields)?;
                    return Ok(Response::builder().status(200).header("Content-Type", "application/json").header("Cache-Control", "no-store").body(serde_json::to_vec(&value["config"])?)?);
                }
            }
            if path.starts_with("/api/") || point.is_some() && path.starts_with(&format!("/apps/{name}/api/")) {
                anyhow::ensure!(body.len() <= point.as_ref().map_or(16 * 1024 * 1024, |point| point.limit()), "Request too large");
                let backend = access
                    .backend
                    .ok_or_else(|| anyhow::anyhow!("This App has no backend"))?;
                let raw = format!("{path}{}", uri.query().map(|query| format!("?{query}")).unwrap_or_default());
                let local = point.as_ref().map(|point| point.target(&raw)).transpose()?.unwrap_or(raw);
                let target = format!("{}{local}", backend.url);
                let (auth_header, auth_value) = if point.is_some() {
                    let seconds = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)?.as_secs();
                    ("X-Point-App-Proxy", point::signature(&backend.token, method.as_str(), &local, body, seconds))
                } else { ("X-Pero-App-Token", backend.token) };
                let mut outgoing = self
                    .client
                    .request(
                        reqwest::Method::from_bytes(method.as_str().as_bytes())?,
                        target,
                    )
                    .header(auth_header, auth_value)
                    .header(
                        "Content-Type",
                        request
                            .headers()
                            .get("Content-Type")
                            .and_then(|value| value.to_str().ok())
                            .unwrap_or("application/json"),
                    )
                    .body(body.clone());
                if point.is_some() {
                    for (name, value) in request.headers() {
                        if name.as_str() != "content-type" && point::forward_header(name.as_str(), false) { outgoing = outgoing.header(name.as_str(), value.to_str()?); }
                    }
                }
                let response = outgoing.send()?;
                for (name, value) in response.headers() {
                    if point::forward_header(name.as_str(), true) { response_headers.push((name.as_str().to_string(), value.to_str()?.to_string())); }
                }
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
                let path = percent_encoding::percent_decode_str(path).decode_utf8()?;
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
        let mut response = Response::builder().status(status).header("Content-Type", content_type).header("Cache-Control", "no-store")
            .header("X-Content-Type-Options", "nosniff")
            .header("Content-Security-Policy", "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'")
            .body(data)?;
        for (name, value) in response_headers { response.headers_mut().insert(wry::http::header::HeaderName::from_bytes(name.as_bytes())?, value.parse()?); }
        Ok(response)
    }
}
