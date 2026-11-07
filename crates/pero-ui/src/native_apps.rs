//! Native App transport. The stdio Host remains the catalog/backend authority.
use pero_contracts::HostEvent;
use serde::{Deserialize, de::DeserializeOwned};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc,
    },
    time::Duration,
};
use wry::http::{Request, Response};

#[derive(Deserialize)]
struct Access {
    root: PathBuf,
    entry: String,
    #[serde(default, rename = "frameOrigins")]
    frame_origins: Vec<String>,
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
    pub(super) docling: Arc<crate::native_docling::NativeDocling>,
    connectors: Option<std::sync::Weak<crate::native_connectors::NativeConnectors>>,
    host: mpsc::Sender<String>,
    pending: Arc<Mutex<BTreeMap<String, mpsc::Sender<Reply>>>>,
    disconnected: Arc<AtomicBool>,
    next: Arc<AtomicU64>,
    events: async_channel::Sender<HostEvent>,
    client: reqwest::blocking::Client,
    #[cfg(feature = "native-probe")]
    docling_probe_origins: Arc<Mutex<Vec<Value>>>,
}
impl NativeApps {
    pub fn new(host: mpsc::Sender<String>, events: async_channel::Sender<HostEvent>, connectors: Option<std::sync::Weak<crate::native_connectors::NativeConnectors>>) -> Self {
        Self {
            docling: Default::default(),
            #[cfg(feature = "native-probe")]
            docling_probe_origins: Default::default(),
            connectors,
            host,
            events,
            pending: Default::default(),
            disconnected: Default::default(),
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
    fn dismiss_docling(&self, id: u64) {
        let mut event = HostEvent::new("native_docling_dismiss", None, String::new());
        event.data = json!({"id":id});
        let _ = self.events.send_blocking(event);
    }
    pub(super) fn cancel_docling_confirmation(&self) {
        if let Some(id) = self.docling.cancel() {
            self.dismiss_docling(id);
        }
    }
    pub(super) fn disconnect(&self) {
        self.disconnected.store(true, Ordering::Release);
        self.pending.lock().unwrap().clear();
        self.cancel_docling_confirmation();
    }
    pub fn accept(&self, event: &HostEvent) -> bool {
        if event.kind == "artifact_snapshot_result" {
            if let Some(sender)=self.pending.lock().unwrap().remove(event.request_id.as_deref().unwrap_or("")) {
                let reply=serde_json::from_value(event.data.clone()).unwrap_or(Reply {ok:false,value:None,error:Some("Invalid artifact snapshot reply".into())});
                let _=sender.send(reply);
            }
            return true; // Snapshot filesystem paths are private to the shell.
        }
        if matches!(event.kind.as_str(), "artifact_registered" | "artifact_presented" | "artifact_error")
            && event.request_id.as_deref().is_some_and(|id| id.starts_with("native-artifact-")) {
            if let Some(sender) = self.pending.lock().unwrap().remove(event.request_id.as_deref().unwrap_or("")) {
                let _ = sender.send(Reply { ok: event.kind != "artifact_error", value: Some(event.data.clone()), error: Some(event.text.clone()) });
            }
            return false; // The same receipt also updates the conversation's artifact list.
        }
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
    pub(super) fn deliver_artifact(&self, command: Value) -> anyhow::Result<Value> {
        let action = if command["action"] == "present" { "present" } else { "register_file" };
        self.artifact_request(action, command)
    }
    pub(super) fn artifact_request(&self, action: &str, mut command: Value) -> anyhow::Result<Value> {
        let id = format!("native-artifact-{}", self.next.fetch_add(1, Ordering::Relaxed));
        command["method"] = json!("artifacts");
        command["action"] = json!(action);
        command["request_id"] = json!(id);
        let (sender, receiver) = mpsc::channel();
        self.pending.lock().unwrap().insert(id.clone(), sender);
        let result = self.host.send(command.to_string()).map_err(anyhow::Error::from)
            .and_then(|_| Ok(receiver.recv_timeout(Duration::from_secs(30))?));
        self.pending.lock().unwrap().remove(&id);
        let reply = result?;
        anyhow::ensure!(reply.ok, "{}", reply.error.unwrap_or_else(|| "Artifact delivery failed".into()));
        Ok(reply.value.unwrap_or(Value::Null))
    }
    pub(super) fn request<T: DeserializeOwned>(&self, action: &str, fields: Value) -> anyhow::Result<T> {
        let id = format!("native-app-{}", self.next.fetch_add(1, Ordering::Relaxed));
        let mut command = fields;
        command["method"] = json!("apps");
        command["action"] = json!(action);
        command["id"] = json!(id);
        let (sender, receiver) = mpsc::channel();
        {
            let mut pending = self.pending.lock().unwrap();
            anyhow::ensure!(!self.disconnected.load(Ordering::Acquire), "Native Host is unavailable");
            pending.insert(id.clone(), sender);
        }
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
        {
            let mut pending = self.pending.lock().unwrap();
            anyhow::ensure!(!self.disconnected.load(Ordering::Acquire), "Native Host is unavailable");
            pending.insert(id.clone(), sender);
        }
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
                    event.data = json!({"name":value["name"],"panel":value["panel"],"entry":entry,"frameOrigins":access.frame_origins});
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
    // WKURLSchemeTask does not supply reliable frame provenance. macOS IPC does:
    // Wry derives request.uri from WKScriptMessage.frameInfo().request().URL.
    // Never use a page-supplied origin/name, or this fallback on Linux/Android,
    // where Wry documents that iframe IPC instead carries the main-frame URL.
    #[cfg(any(target_os = "macos", test))]
    pub(super) fn docling_from_frame(&self, owner: &str, request: Request<String>, is_live: impl Fn() -> bool, cancel_queued: impl Fn()) -> Option<Value> {
        if request.body().len() > 16000 { return None; }
        let value: Value = serde_json::from_str(request.body()).ok()?;
        let id = value["id"].as_str().filter(|id| !id.is_empty() && id.len() <= 80 && id.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-'))?.to_owned();
        let result = (|| -> anyhow::Result<Response<Vec<u8>>> {
            let uri = url::Url::parse(&request.uri().to_string())?;
            if owner != "paper-agent" || uri.scheme() != "pero-app" || uri.host_str() != Some("paper-agent")
                || !uri.username().is_empty() || uri.password().is_some() || uri.port().is_some() {
                return Ok(Response::builder().status(403).body(b"Paper frame required".to_vec())?);
            }
            #[derive(Deserialize)]
            #[serde(tag = "type", deny_unknown_fields)]
            enum Call {
                #[serde(rename = "pero:docling:request")]
                Request { #[serde(rename = "id")] _id: String, body: String },
            }
            let Ok(Call::Request { _id: _, body }) = serde_json::from_value::<Call>(value) else {
                return Ok(Response::builder().status(400).body(b"Invalid Docling request".to_vec())?);
            };
            self.docling_response("POST", body.as_bytes(), is_live, cancel_queued)
        })();
        let response = result.unwrap_or_else(|_| Response::builder().status(503).body(b"Optional OCR setup unavailable".to_vec()).unwrap());
        Some(json!({"type":"pero:docling:result","id":id,"status":response.status().as_u16(),"body":String::from_utf8_lossy(response.body())}))
    }
    #[cfg(feature = "native-probe")]
    pub(super) fn docling_probe_origins(&self) -> Value {
        json!(self.docling_probe_origins.lock().unwrap().clone())
    }
    fn docling_response(&self, method: &str, body: &[u8], is_live: impl Fn() -> bool, cancel_queued: impl Fn()) -> anyhow::Result<Response<Vec<u8>>> {
        if method != "POST" { return Ok(Response::builder().status(405).body(b"Method refused".to_vec())?); }
        if body.len() > 4096 { return Ok(Response::builder().status(413).body(b"Request too large".to_vec())?); }
        let input = match serde_json::from_slice::<crate::native_docling::Input>(body) {
            Ok(input) => input,
            Err(_) => return Ok(Response::builder().status(400).body(b"Invalid Docling component request".to_vec())?),
        };
        if matches!(input, crate::native_docling::Input::Cancel {}) {
            cancel_queued();
        } else if !is_live() {
            return Ok(Response::builder().status(410).body(b"Paper document closed".to_vec())?);
        }
        let result = self.docling.apply(input,
            |operation| self.request::<Value>("doclingruntime", json!({"name":"paper-agent","request":operation})).map_err(|error| error.to_string()),
            |prompt| {
                if !is_live() { return Err("Paper document closed".into()); }
                let mut event = HostEvent::new("native_docling_confirmation", None, String::new());
                event.data = serde_json::to_value(prompt).expect("Native confirmation");
                self.events.send_blocking(event).map_err(|error| error.to_string())
            },
            |id| self.dismiss_docling(id),
        );
        return Ok(match result {
            Ok(value) => Response::builder().header("Content-Type", "application/json").header("Cache-Control", "no-store").body(serde_json::to_vec(&value)?)?,
            Err(_) => Response::builder().status(503).body(b"Optional OCR setup unavailable. Check status or continue manually.".to_vec())?,
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
        if path.starts_with("/api/") {self.request::<Value>("apiaccess",json!({"name":name,"path":path}))?;}
        let method = request.method();
        let body = request.body();
        if path.starts_with("/host/artifacts/") {
            return self.artifact_response(name, &request, &uri);
        }
        if path == "/host/docling-runtime" {
            #[cfg(feature = "native-probe")]
            {
                let origin = request.headers().get("Origin");
                let mut observations = self.docling_probe_origins.lock().unwrap();
                if observations.len() < 8 {
                    observations.push(json!({"present":origin.is_some(),"value":origin.and_then(|value| value.to_str().ok())}));
                }
            }
            if name != "paper-agent" || request.headers().get("Origin").is_none_or(|origin| origin != "pero-app://paper-agent") {
                return Ok(Response::builder().status(403).body(b"Paper origin required".to_vec())?);
            }
            return self.docling_response(method.as_str(), body, || true, || {});
        }
        if path == "/host/environment/profiles" {
            if method != "POST" { return Ok(Response::builder().status(405).body(b"Method refused".to_vec())?); }
            if body.len()>4096 { return Ok(Response::builder().status(413).body(b"Request too large".to_vec())?); }
            let input: Value=match serde_json::from_slice(body) {Ok(v)=>v,Err(_)=>return Ok(Response::builder().status(400).body(b"Invalid request".to_vec())?)};
            let value:Value=self.request("localenvironment",json!({"name":name,"request":input}))?;
            return Ok(Response::builder().header("Content-Type","application/json").header("Cache-Control","no-store").body(serde_json::to_vec(&value)?)?);
        }
        if path == "/host/environment" {
            if method != "POST" {
                return Ok(Response::builder().status(405).body(b"Method refused".to_vec())?);
            }
            if body.len() > 4096 {
                return Ok(Response::builder().status(413).body(b"Request too large".to_vec())?);
            }
            #[derive(Deserialize)]
            #[serde(deny_unknown_fields)]
            struct EnvironmentInput { target: String }
            let input: EnvironmentInput = match serde_json::from_slice(body) {
                Ok(value) => value,
                Err(_) => return Ok(Response::builder().status(400).body(b"Expected only a scientific method".to_vec())?),
            };
            if input.target.len() > 128 {
                return Ok(Response::builder().status(400).body(b"Invalid scientific method".to_vec())?);
            }
            let value: Value = self.request("environment", json!({"name":name,"target":input.target}))?;
            return Ok(Response::builder().header("Content-Type", "application/json")
                .header("Cache-Control", "no-store").body(serde_json::to_vec(&value)?)?);
        }
        if path == "/host/sdk" {
            anyhow::ensure!(method == "GET", "Method refused");
            let mut info: Value = self.request("sdkcontext", json!({"name":name}))?;
            info["slots"] = json!([]);
            return Ok(Response::builder().header("Content-Type","application/json").header("Cache-Control","no-store").body(serde_json::to_vec(&info)?)?);
        }
        if path == "/host/capability" {
            anyhow::ensure!(method == "POST" && body.len() <= 256000, "Invalid Host request");
            let call: Value = serde_json::from_slice(body)?;
            let target = match call["capability"].as_str() {
                Some("agent") => "app-agent", Some("insights") => "insights", Some("connectors") => "connectors",
                Some("automation") => "automation", Some("research-assets") => "research-assets", _ => anyhow::bail!("Host capability unavailable"),
            };
            let mut input = call["input"].as_object().cloned().ok_or_else(|| anyhow::anyhow!("Host input must be an object"))?;
            let operation = call["operation"].as_str().ok_or_else(|| anyhow::anyhow!("Host operation is required"))?;
            input.insert("operation".into(),json!(operation));
            let forwarded = Request::builder().method("POST").uri(format!("pero-app://{name}/host/{target}"))
                .header("Content-Type","application/json").body(serde_json::to_vec(&input)?)?;
            return self.respond(name,forwarded);
        }
        if path == "/host/research-assets" {
            if method != "POST" {
                return Ok(Response::builder().status(405).body(b"Method refused".to_vec())?);
            }
            if body.len() > 64 * 1024 {
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
        let mut frame_sources = String::from("'self'");
        let (status, content_type, data) = if matches!(path, "/host/agent" | "/host/app-agent" | "/host/insights") {
            anyhow::ensure!(
                method == "POST" && body.len() <= 256_000,
                "Invalid App Host request"
            );
            let operation: Value = serde_json::from_slice(body)?;
            let preparing = path == "/host/app-agent" && operation["operation"] == "prepare";
            let (action, fields) = if path == "/host/app-agent" {
                ("agentrun", json!({"name":name,"request":operation}))
            } else if path == "/host/agent" {
                ("agent", json!({"name":name,"request":operation}))
            } else {
                let mut fields = json!({"name":name});
                if let Some(thread) = operation.get("threadId") {
                    fields["threadId"] = thread.clone();
                }
                ("insights", fields)
            };
            let mut value: Value = self.request(action, fields)?;
            if preparing {value=value["context"].take();}
            (
                200,
                "application/json".to_string(),
                serde_json::to_vec(&value)?,
            )
        } else {
            let access: Access = self.request(if path.starts_with("/api/") {"resolve"} else {"resolve_static"}, json!({"name":name}))?;
            for origin in &access.frame_origins { frame_sources.push(' '); frame_sources.push_str(origin); }
            if matches!(path,"/api/workspaces"|"/api/harnesses") {
                anyhow::ensure!(method == "GET" && uri.query().is_none(),"Method refused");
                let value:Value=self.request("agentcatalog",json!({"name":name,"path":path}))?;
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
                let mut backend_request = self
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
                    .body(body.clone());
                // The isolated page converter has a 180-second deadline. Keep
                // the transport alive until it can return its persisted result
                // or error, rather than reporting a 503 after only 30 seconds.
                if name == "paper-agent" && method == "POST" && path == "/api/numeric/layout" {
                    backend_request = backend_request.timeout(Duration::from_secs(210));
                }
                let response = backend_request.send()?;
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
            .header("Content-Security-Policy", format!("default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-src {frame_sources}; object-src 'none'; base-uri 'none'"))
            .body(data)?)
    }
}

#[cfg(test)]
mod docling_tests {
    use super::*;

    fn reply(apps: &NativeApps, request: &Value, value: Value) {
        let mut event = HostEvent::new("apps_result", request["id"].as_str().map(str::to_owned), String::new());
        event.data = json!({"ok":true,"value":value});
        assert!(apps.accept(&event));
    }

    #[test]
    fn selected_page_layout_outlives_default_proxy_deadline_only_on_its_route() {
        use std::io::{Read, Write};
        for (name, method, path, extended) in [
            ("paper-agent", "POST", "/api/numeric/layout", true),
            ("paper-agent", "GET", "/api/numeric/layout", false),
            ("paper-agent", "POST", "/api/numeric/extract", false),
            ("other-app", "POST", "/api/numeric/layout", false),
        ] {
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            let address = listener.local_addr().unwrap();
            let (received, incoming) = mpsc::channel();
            let (release, finish) = mpsc::channel();
            let backend = std::thread::spawn(move || {
                let (mut socket, _) = listener.accept().unwrap();
                socket.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
                let mut bytes = [0; 4096];
                assert!(socket.read(&mut bytes).unwrap() > 0);
                received.send(()).unwrap();
                finish.recv_timeout(Duration::from_secs(2)).unwrap();
                // Ordinary routes may already have closed their timed-out socket.
                let _ = socket.write_all(b"HTTP/1.1 201 Created\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}");
            });
            let (host, requests) = mpsc::channel();
            let (events, _) = async_channel::unbounded();
            let mut apps = NativeApps::new(host, events, None);
            apps.client = reqwest::blocking::Client::builder().no_proxy()
                .timeout(Duration::from_millis(50)).build().unwrap();
            let worker = apps.clone();
            let (completed, outcome) = mpsc::channel();
            let request = std::thread::spawn(move || {
                let result = worker.serve(name, Request::builder().method(method)
                    .uri(format!("pero-app://{name}{path}")).body(b"{}".to_vec()).unwrap());
                completed.send(result.status()).unwrap();
            });
            let access: Value = serde_json::from_str(&requests.recv_timeout(Duration::from_secs(2)).unwrap()).unwrap();
            assert_eq!(access["action"], "apiaccess");
            reply(&apps, &access, json!({}));
            let resolve: Value = serde_json::from_str(&requests.recv_timeout(Duration::from_secs(2)).unwrap()).unwrap();
            reply(&apps, &resolve, json!({"root":"/unused","entry":"dist/index.html",
                "backend":{"url":format!("http://{address}"),"token":"test-token"}}));
            incoming.recv_timeout(Duration::from_secs(2)).unwrap();
            if extended {
                // Observe the request across the default deadline, without
                // relying on a sleep to arrange the server/client ordering.
                assert!(matches!(outcome.recv_timeout(Duration::from_millis(100)), Err(mpsc::RecvTimeoutError::Timeout)));
                release.send(()).unwrap();
                assert_eq!(outcome.recv_timeout(Duration::from_secs(2)).unwrap(), 201);
            } else {
                assert_eq!(outcome.recv_timeout(Duration::from_secs(2)).unwrap(), 503);
                release.send(()).unwrap();
            }
            request.join().unwrap();
            backend.join().unwrap();
        }
    }

    #[test]
    fn docling_route_admits_only_bounded_paper_intent() {
        let (host, requests) = mpsc::channel();
        let (events, _) = async_channel::unbounded();
        let apps = NativeApps::new(host, events, None);
        for (name, method, origin, body, status) in [
            ("other-app", "POST", Some("pero-app://other-app"), br#"{"operation":"status"}"#.to_vec(), 403),
            ("paper-agent", "POST", None, br#"{"operation":"status"}"#.to_vec(), 403),
            ("paper-agent", "POST", Some("null"), br#"{"operation":"status"}"#.to_vec(), 403),
            ("paper-agent", "GET", Some("pero-app://paper-agent"), b"{}".to_vec(), 405),
            ("paper-agent", "POST", Some("pero-app://paper-agent"), vec![b' '; 4097], 413),
            ("paper-agent", "POST", Some("pero-app://paper-agent"), br#"{"operation":"install","ticket":"forged"}"#.to_vec(), 400),
            ("paper-agent", "POST", Some("pero-app://paper-agent"), br#"{"operation":"request","component":"software","approved":true}"#.to_vec(), 400),
        ] {
            let mut request = Request::builder().method(method).uri(format!("pero-app://{name}/host/docling-runtime"));
            if let Some(origin) = origin { request = request.header("Origin", origin); }
            assert_eq!(apps.serve(name, request.body(body).unwrap()).status(), status);
            assert!(requests.try_recv().is_err());
        }
    }

    fn ipc_request(uri: &str, body: Value) -> Request<String> {
        Request::builder().uri(uri).body(json!({"type":"pero:docling:request","id":"request-1","body":body.to_string()}).to_string()).unwrap()
    }

    #[test]
    fn frame_transport_checks_native_owner_and_webkit_frame_not_body_claims() {
        let (host, requests) = mpsc::channel();
        let (events, _) = async_channel::unbounded();
        let apps = NativeApps::new(host, events, None);
        let live = AtomicBool::new(true);
        for (owner, uri, body, status) in [
            ("other-app", "pero-app://paper-agent/dist/index.html", json!({"operation":"status"}), 403),
            ("paper-agent", "https://arxiv.org/", json!({"operation":"status"}), 403),
            ("paper-agent", "about:blank", json!({"operation":"status"}), 403),
            ("paper-agent", "pero-app://other-app/index.html", json!({"operation":"status"}), 403),
            ("paper-agent", "pero-app://paper-agent.evil/index.html", json!({"operation":"status"}), 403),
            ("paper-agent", "pero-app://paper-agent/dist/index.html", json!({"operation":"install","ticket":"forged"}), 400),
            ("paper-agent", "pero-app://paper-agent/dist/index.html", json!({"operation":"request","component":"software","approved":true}), 400),
            ("paper-agent", "pero-app://paper-agent/dist/index.html", json!({"operation":"status","origin":"pero-app://paper-agent"}), 400),
        ] {
            assert_eq!(apps.docling_from_frame(owner, ipc_request(uri, body), || live.load(Ordering::Acquire), || {}).unwrap()["status"], status);
            assert!(requests.try_recv().is_err());
        }
        let mut forged = ipc_request("pero-app://paper-agent/dist/index.html", json!({"operation":"status"}));
        let mut envelope: Value = serde_json::from_str(forged.body()).unwrap();
        envelope["approved"] = json!(true);
        *forged.body_mut() = envelope.to_string();
        assert_eq!(apps.docling_from_frame("paper-agent", forged, || live.load(Ordering::Acquire), || {}).unwrap()["status"], 400);
        live.store(false, Ordering::Release);
        assert_eq!(apps.docling_from_frame("paper-agent", ipc_request("pero-app://paper-agent/dist/index.html", json!({"operation":"status"})), || live.load(Ordering::Acquire), || {}).unwrap()["status"], 410);
        assert!(requests.try_recv().is_err());
    }

    #[test]
    fn frame_cancel_invalidates_an_earlier_request_that_has_not_started_yet() {
        let (host, requests) = mpsc::channel();
        let (events, _) = async_channel::unbounded();
        let apps = NativeApps::new(host, events, None);
        let generation = Arc::new(AtomicU64::new(0));
        let received_before_cancel = generation.load(Ordering::Acquire);
        let serving = apps.clone();
        let cancelling = generation.clone();
        let response = std::thread::spawn(move || serving.docling_from_frame("paper-agent",
            ipc_request("pero-app://paper-agent/dist/index.html", json!({"operation":"cancel"})),
            || true, || { cancelling.fetch_add(1, Ordering::AcqRel); }).unwrap());
        let cancel: Value = serde_json::from_str(&requests.recv_timeout(Duration::from_secs(2)).unwrap()).unwrap();
        assert_eq!(cancel["request"], json!({"operation":"cancel"}));
        reply(&apps, &cancel, json!({"state":"cancelled"}));
        assert_eq!(response.join().unwrap()["status"], 200);
        let queued = apps.docling_from_frame("paper-agent",
            ipc_request("pero-app://paper-agent/dist/index.html", json!({"operation":"request","component":"software"})),
            || generation.load(Ordering::Acquire) == received_before_cancel, || {}).unwrap();
        assert_eq!(queued["status"], 410);
        assert!(requests.try_recv().is_err());
        assert!(!apps.docling.pending(1));
    }

    #[test]
    fn frame_transport_uses_native_consent_and_refuses_a_closed_owner_after_prepare() {
        for closed in [false, true] {
            let (host, requests) = mpsc::channel();
            let (events, prompts) = async_channel::unbounded();
            let apps = NativeApps::new(host, events, None);
            let serving = apps.clone();
            let live = Arc::new(AtomicBool::new(true));
            let request_live = live.clone();
            let response = std::thread::spawn(move || serving.docling_from_frame("paper-agent",
                ipc_request("pero-app://paper-agent/dist/index.html", json!({"operation":"request","component":"software"})), || request_live.load(Ordering::Acquire), || {}).unwrap());
            let prepare: Value = serde_json::from_str(&requests.recv_timeout(Duration::from_secs(2)).unwrap()).unwrap();
            assert_eq!(prepare["request"], json!({"operation":"prepare","component":"software"}));
            if closed { live.store(false, Ordering::Release); }
            reply(&apps, &prepare, json!({"state":"requires-approval","component":"software","ticket":"private-ticket","summary":"Fixed software download"}));
            if !closed {
                let prompt = prompts.recv_blocking().unwrap();
                assert_eq!(prompt.kind, "native_docling_confirmation");
                assert!(!prompt.data.to_string().contains("private-ticket"));
                apps.docling.answer(prompt.data["id"].as_u64().unwrap(), false);
            }
            let cancel: Value = serde_json::from_str(&requests.recv_timeout(Duration::from_secs(2)).unwrap()).unwrap();
            assert_eq!(cancel["request"], json!({"operation":"cancel"}));
            reply(&apps, &cancel, json!({"software":"missing","ticket":"private-ticket"}));
            let response = response.join().unwrap();
            assert_eq!(response["status"], 200);
            assert_eq!(serde_json::from_str::<Value>(response["body"].as_str().unwrap()).unwrap(), json!({"software":"missing"}));
            assert!(requests.try_recv().is_err());
            if closed { assert!(prompts.try_recv().is_ok_and(|event| event.kind == "native_docling_dismiss")); }
        }
    }

    #[test]
    fn private_native_confirmation_connects_the_app_route_to_host_install() {
        for component in ["software", "model"] {
            for allowed in [false, true] {
                let (host, requests) = mpsc::channel();
                let (events, prompts) = async_channel::unbounded();
                let apps = NativeApps::new(host, events, None);
                let serving = apps.clone();
                let response = std::thread::spawn(move || serving.serve("paper-agent", Request::builder()
                    .method("POST").uri("pero-app://paper-agent/host/docling-runtime")
                    .header("Origin", "pero-app://paper-agent")
                    .body(serde_json::to_vec(&json!({"operation":"request","component":component})).unwrap()).unwrap()));
                let prepare: Value = serde_json::from_str(&requests.recv_timeout(Duration::from_secs(2)).unwrap()).unwrap();
                assert_eq!(prepare["action"], "doclingruntime");
                assert_eq!(prepare["name"], "paper-agent");
                assert_eq!(prepare["request"], json!({"operation":"prepare","component":component}));
                reply(&apps, &prepare, json!({"state":"requires-approval","component":component,"summary":"Fixed software or model download","ticket":"private-host-ticket"}));
                let prompt = prompts.recv_blocking().unwrap();
                assert_eq!(prompt.kind, "native_docling_confirmation");
                assert!(!prompt.data.to_string().contains("private-host-ticket"));
                assert!(requests.try_recv().is_err());
                apps.docling.answer(prompt.data["id"].as_u64().unwrap(), allowed);
                let decision: Value = serde_json::from_str(&requests.recv_timeout(Duration::from_secs(2)).unwrap()).unwrap();
                assert_eq!(decision["request"], if allowed { json!({"operation":"install","ticket":"private-host-ticket"}) } else { json!({"operation":"cancel"}) });
                reply(&apps, &decision, json!({"state":"idle","softwareApproved":false,"ticket":"private-host-ticket","root":"private-path"}));
                let response = response.join().unwrap();
                assert_eq!(response.status(), 200);
                assert_eq!(response.headers()["Cache-Control"], "no-store");
                assert_eq!(serde_json::from_slice::<Value>(response.body()).unwrap(), json!({"state":"idle","softwareApproved":false}));
            }
        }
    }

    #[test]
    fn host_disconnect_releases_pending_confirmation_without_waiting_for_the_host_timeout() {
        let (host, requests) = mpsc::channel();
        let (events, _) = async_channel::unbounded();
        let apps = NativeApps::new(host, events, None);
        let serving = apps.clone();
        let response = std::thread::spawn(move || serving.serve("paper-agent", Request::builder()
            .method("POST").uri("pero-app://paper-agent/host/docling-runtime")
            .header("Origin", "pero-app://paper-agent")
            .body(br#"{"operation":"request","component":"software"}"#.to_vec()).unwrap()));
        let prepare: Value = serde_json::from_str(&requests.recv_timeout(Duration::from_secs(2)).unwrap()).unwrap();
        assert_eq!(prepare["request"]["operation"], "prepare");
        apps.disconnect();
        assert_eq!(response.join().unwrap().status(), 503);
        assert!(!apps.docling.pending(1));
        assert!(apps.request::<Value>("doclingruntime", json!({"name":"paper-agent","request":{"operation":"status"}})).is_err());
        assert!(requests.try_recv().is_err());
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
            ("POST", "pero-app://paper-agent", vec![b' '; 64 * 1024 + 1], 413),
            ("POST", "pero-app://other-app", vec![], 503),
        ] {
            let response = apps.serve("paper-agent", Request::builder().uri("pero-app://paper-agent/host/research-assets")
                .method(method).header("Origin", origin).body(body).unwrap());
            assert_eq!(response.status(), status);
            assert!(requests.try_recv().is_err());
        }
    }
}

#[cfg(test)]
mod environment_tests {
    use super::*;

    #[test]
    fn environment_route_keeps_origin_and_method_in_the_host_request() {
        let (host, requests) = mpsc::channel();
        let (events, _) = async_channel::unbounded();
        let apps = NativeApps::new(host, events, None);
        let serving = apps.clone();
        let response = std::thread::spawn(move || serving.serve("control-lab", Request::builder()
            .uri("pero-app://control-lab/host/environment").method("POST")
            .header("Origin", "pero-app://control-lab")
            .body(br#"{"target":"control-lab.python-control"}"#.to_vec()).unwrap()));
        let command: Value = serde_json::from_str(&requests.recv_timeout(Duration::from_secs(2)).unwrap()).unwrap();
        assert_eq!(command["method"], "apps");
        assert_eq!(command["action"], "environment");
        assert_eq!(command["name"], "control-lab");
        assert_eq!(command["target"], "control-lab.python-control");
        let value = json!({"schema":"pero.environment.inspection.v1","evidence":"metadata_only"});
        let mut reply = HostEvent::new("apps_result", command["id"].as_str().map(str::to_owned), String::new());
        reply.data = json!({"ok":true,"value":value});
        assert!(apps.accept(&reply));
        let response = response.join().unwrap();
        assert_eq!(response.status(), 200);
        assert_eq!(response.headers()["Cache-Control"], "no-store");
        assert_eq!(serde_json::from_slice::<Value>(response.body()).unwrap(), value);

        let serving=apps.clone();
        let response=std::thread::spawn(move || serving.serve("environments",Request::builder()
            .uri("pero-app://environments/host/environment/profiles").method("POST")
            .header("Origin","pero-app://environments").body(br#"{"operation":"list"}"#.to_vec()).unwrap()));
        let command:Value=serde_json::from_str(&requests.recv_timeout(Duration::from_secs(2)).unwrap()).unwrap();
        assert_eq!(command["action"],"localenvironment");
        assert_eq!(command["name"],"environments");
        assert_eq!(command["request"],json!({"operation":"list"}));
        let mut reply=HostEvent::new("apps_result",command["id"].as_str().map(str::to_owned),String::new());
        reply.data=json!({"ok":true,"value":[]});assert!(apps.accept(&reply));
        assert_eq!(response.join().unwrap().status(),200);

        for (method, origin, body, status) in [
            ("GET", "pero-app://control-lab", vec![], 405),
            ("POST", "pero-app://control-lab", vec![b' '; 4097], 413),
            ("POST", "pero-app://control-lab", br#"{"target":"control-lab.ngspice","name":"environments"}"#.to_vec(), 400),
            ("POST", "pero-app://control-lab", b"not JSON".to_vec(), 400),
            ("POST", "pero-app://other-app", b"{}".to_vec(), 503),
        ] {
            let response = apps.serve("control-lab", Request::builder()
                .uri("pero-app://control-lab/host/environment").method(method).header("Origin", origin)
                .body(body).unwrap());
            assert_eq!(response.status(), status);
            assert!(requests.try_recv().is_err());
        }
    }
}
