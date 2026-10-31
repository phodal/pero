//! Native shell adapter for the shared connector owner. Private stdio only.
use crate::{native_apps::NativeApps, native_secrets::SecretStore};
use pero_contracts::HostEvent;
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
        mpsc,
    },
    time::Duration,
};

#[derive(Deserialize)]
struct Message {
    id: u64,
    #[serde(default)]
    effect: Option<String>,
    #[serde(default)]
    key: String,
    #[serde(default)]
    url: String,
    #[serde(default)]
    value: Value,
}

pub(crate) struct NativeConnectors {
    input: Mutex<ChildStdin>,
    child: Mutex<Child>,
    pending: Mutex<BTreeMap<u64, mpsc::Sender<Value>>>,
    next: AtomicU64,
    apps: Mutex<Option<NativeApps>>,
    data: PathBuf,
}
impl NativeConnectors {
    pub fn start(
        root: &Path,
        data: &Path,
        host: &Path,
    ) -> anyhow::Result<(Arc<Self>, BTreeMap<String, String>)> {
        let helpers = root.join("packages/connectors/helpers");
        let mut child =
            Command::new(std::env::var_os("PERO_ADAPTER_NODE").unwrap_or_else(|| "node".into()))
                .arg(helpers.join("pero-connectors-host.mjs"))
                .arg(data.join("connectors"))
                .arg(host.parent().unwrap().join("pero-connector-worker"))
                .arg(helpers)
                .current_dir(root)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::inherit())
                .spawn()?;
        let input = child.stdin.take().unwrap();
        let mut output = BufReader::new(child.stdout.take().unwrap());
        let (ready, startup) = mpsc::channel();
        let owner = Arc::new(Self {
            input: Mutex::new(input),
            child: Mutex::new(child),
            pending: Default::default(),
            next: AtomicU64::new(1),
            apps: Default::default(),
            data: data.to_owned(),
        });
        let reader = owner.clone();
        std::thread::spawn(move || {
            let mut first = String::new();
            let result = output
                .read_line(&mut first)
                .map_err(anyhow::Error::from)
                .and_then(|_| Ok(serde_json::from_str::<Value>(&first)?["ready"].clone()))
                .and_then(|value| Ok(serde_json::from_value::<BTreeMap<String, String>>(value)?));
            let _ = ready.send(result);
            for line in output.lines() {
                let Ok(line) = line else { break };
                let Ok(message) = serde_json::from_str::<Message>(&line) else {
                    continue;
                };
                if message.effect.is_some() {
                    let result = reader.effect(&message);
                    let reply = match result {
                        Ok(value) => json!({"reply":message.id,"ok":true,"value":value}),
                        Err(code) => json!({"reply":message.id,"ok":false,"code":code}),
                    };
                    let _ = reader.send(reply);
                } else if let Some(sender) = reader.pending.lock().unwrap().remove(&message.id) {
                    let _ = sender.send(message.value);
                }
            }
            reader.pending.lock().unwrap().clear();
        });
        match startup.recv_timeout(Duration::from_secs(15)) {
            Ok(Ok(environment)) => Ok((owner, environment)),
            result => {
                let _ = owner.child.lock().unwrap().kill();
                let _ = owner.child.lock().unwrap().wait();
                anyhow::bail!("Connectors startup failed: {result:?}")
            }
        }
    }
    pub fn bind(&self, apps: NativeApps) {
        *self.apps.lock().unwrap() = Some(apps);
    }
    fn send(&self, value: Value) -> anyhow::Result<()> {
        let mut input = self.input.lock().unwrap();
        writeln!(input, "{value}")?;
        Ok(input.flush()?)
    }
    pub fn request(&self, request: Value) -> anyhow::Result<Value> {
        let id = self.next.fetch_add(1, Ordering::Relaxed);
        let (sender, receiver) = mpsc::channel();
        self.pending.lock().unwrap().insert(id, sender);
        let result = self
            .send(json!({"id":id,"request":request}))
            .and_then(|_| Ok(receiver.recv_timeout(Duration::from_secs(65))?));
        self.pending.lock().unwrap().remove(&id);
        result
    }
    pub fn accept(&self, event: &HostEvent) {
        if matches!(
            event.kind.as_str(),
            "session_created" | "session_deleted" | "session_closed"
        ) {
            let _ = self.send(json!({"event":{"kind":event.kind,"thread_id":event.thread_id}}));
        }
    }
    fn effect(&self, message: &Message) -> Result<Value, &'static str> {
        let store = || {
            SecretStore::new(
                &self.data.join(format!(
                    "connector-{:x}",
                    Sha256::digest(message.key.as_bytes())
                )),
                "connectors",
            )
        };
        match message.effect.as_deref() {
            Some("authorize") => {
                self.apps
                    .lock()
                    .unwrap()
                    .as_ref()
                    .ok_or("MCP_HOST_UNAVAILABLE")?
                    .require_connectors()
                    .map_err(|_| "MCP_HOST_FORBIDDEN")?;
                Ok(Value::Null)
            }
            Some("secret.read") => store()
                .load::<String>()
                .map(|value| json!(value))
                .map_err(|_| "MCP_CREDENTIAL_STORE_UNAVAILABLE"),
            Some("secret.write") => {
                store()
                    .save(&message.value)
                    .map_err(|_| "MCP_CREDENTIAL_STORE_UNAVAILABLE")?;
                Ok(Value::Null)
            }
            Some("secret.remove") => {
                store()
                    .clear()
                    .map_err(|_| "MCP_CREDENTIAL_STORE_UNAVAILABLE")?;
                Ok(Value::Null)
            }
            Some("open") => {
                let url = url::Url::parse(&message.url).map_err(|_| "MCP_AUTH_URL")?;
                if url.scheme() != "https"
                    && !(url.scheme() == "http" && url.host_str() == Some("127.0.0.1"))
                {
                    return Err("MCP_AUTH_URL");
                }
                let status = Command::new(if cfg!(target_os = "macos") {
                    "/usr/bin/open"
                } else {
                    "xdg-open"
                })
                .arg(url.as_str())
                .status()
                .map_err(|_| "MCP_AUTH_URL")?;
                if !status.success() {
                    return Err("MCP_AUTH_URL");
                }
                Ok(Value::Null)
            }
            _ => Err("MCP_ARGUMENT"),
        }
    }
    pub fn close(&self) {
        let _ = self.send(json!({"shutdown":true}));
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        let mut child = self.child.lock().unwrap();
        while child.try_wait().ok().flatten().is_none() {
            if std::time::Instant::now() >= deadline {
                let _ = child.kill();
                break;
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        let _ = child.wait();
    }
}
