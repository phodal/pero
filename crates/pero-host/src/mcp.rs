//! Composition only: one Node provider presents Apps; existing sessions own MCP IO.
use pero_contracts::{
    HostEvent,
    mcp_source::{McpSourceMode, McpSourceRequest},
};
use std::{
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::mpsc::{self, Receiver, Sender},
};
struct Provider {
    child: Option<Child>,
    input: Sender<serde_json::Value>,
    output: Receiver<Result<serde_json::Value, String>>,
    replies: Receiver<HostEvent>,
    reply_tx: Sender<HostEvent>,
}
impl Provider {
    fn start(config: &Path) -> Result<Self, String> {
        let script = std::env::var_os("PERO_MCP_PROVIDER_SCRIPT")
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                Path::new(env!("CARGO_MANIFEST_DIR")).join("../../desktop/dist/mcp-provider.cjs")
            });
        if !script.is_file() {
            return Err("MCP Apps is unavailable: build the Node provider (node scripts/build/desktop.mjs), or configure PERO_MCP_PROVIDER_SCRIPT.".into());
        }
        let node = std::env::var_os("PERO_NODE_BINARY").unwrap_or_else(|| "node".into());
        let child = Command::new(node)
            .env("ELECTRON_RUN_AS_NODE", "1")
            .arg(script)
            .args(["--stdio", "--config"])
            .arg(config)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|error| {
                format!("MCP Apps is unavailable: Node runtime could not start ({error})")
            })?;
        Ok(Self::from_child(child))
    }
    fn from_child(mut child: Child) -> Self {
        let mut input = child.stdin.take().expect("piped provider input");
        let output = BufReader::new(child.stdout.take().expect("piped provider output"));
        let (tx, rx) = mpsc::channel();
        let (input_tx, input_rx) = mpsc::channel::<serde_json::Value>();
        let errors = tx.clone();
        std::thread::spawn(move || {
            for value in input_rx {
                if let Err(error) = writeln!(input, "{value}").and_then(|_| input.flush()) {
                    let _ = errors.send(Err(error.to_string()));
                    break;
                }
            }
        });
        // Never wait for a provider response on Host's command loop: approvals
        // arrive through that same loop while an App tool request is pending.
        std::thread::spawn(move || {
            for line in output.lines() {
                let value = line
                    .map_err(|e| e.to_string())
                    .and_then(|line| serde_json::from_str(&line).map_err(|e| e.to_string()));
                let failed = value.is_err();
                if tx.send(value).is_err() || failed {
                    return;
                }
            }
            let _ = tx.send(Err("MCP Apps provider stopped".into()));
        });
        let (reply_tx, replies) = mpsc::channel();
        Self {
            child: Some(child),
            input: input_tx,
            output: rx,
            replies,
            reply_tx,
        }
    }
    fn send(&mut self, value: &serde_json::Value) -> Result<(), String> {
        self.input
            .send(value.clone())
            .map_err(|_| "MCP Apps provider stopped".into())
    }
}
impl Drop for Provider {
    fn drop(&mut self) {
        // Give the provider time to close its independent clients, without
        // blocking Host's approval loop or waiting forever on a broken server.
        let _ = self.send(&serde_json::json!({"action":"shutdown"}));
        if let Some(mut child) = self.child.take() {
            std::thread::spawn(move || {
                let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
                loop {
                    if matches!(child.try_wait(), Ok(Some(_))) {
                        return;
                    }
                    if std::time::Instant::now() >= deadline {
                        break;
                    }
                    std::thread::sleep(std::time::Duration::from_millis(10));
                }
                let _ = child.kill();
                let _ = child.wait();
            });
        }
    }
}
pub struct Mcp {
    provider: Option<Provider>,
    config: PathBuf,
    sessions: std::collections::HashMap<String, u64>,
    observations: std::collections::HashMap<String, serde_json::Value>,
}
impl Mcp {
    pub fn new(settings: Option<&Path>) -> Self {
        Self {
            provider: None,
            sessions: Default::default(),
            observations: Default::default(),
            config: settings
                .and_then(Path::parent)
                .unwrap_or_else(|| Path::new("."))
                .join("mcp-servers.json"),
        }
    }
    pub fn poll(&mut self, agents: &mut super::agents::Manager) -> Vec<HostEvent> {
        let snapshots = self
            .sessions
            .keys()
            .filter_map(|thread| {
                agents
                    .mcp_session_snapshot(thread)
                    .map(|s| (thread.clone(), s))
            })
            .collect();
        self.poll_provider(&snapshots, |request, reply| {
            agents.dispatch_mcp_session_to(request, reply)
        })
    }
    fn poll_provider(
        &mut self,
        snapshots: &std::collections::HashMap<
            String,
            pero_contracts::mcp_runtime::McpRuntimeSession,
        >,
        mut dispatch: impl FnMut(serde_json::Value, Sender<HostEvent>),
    ) -> Vec<HostEvent> {
        let Some(provider) = self.provider.as_mut() else {
            return vec![];
        };
        let mut events = Vec::new();
        let result = (|| -> Result<(), String> {
            let expired: Vec<_> = self
                .sessions
                .iter()
                .filter(|(thread, incarnation)| {
                    snapshots
                        .get(*thread)
                        .is_none_or(|s| s.closed || s.incarnation != **incarnation)
                })
                .map(|(thread, _)| thread.clone())
                .collect();
            for thread in expired {
                provider.send(&serde_json::json!({"action":"forget_thread","thread_id":thread}))?;
                self.sessions.remove(&thread);
                self.observations.remove(&thread);
            }
            for (thread, snapshot) in snapshots {
                if !self.sessions.contains_key(thread) {
                    continue;
                }
                let data = serde_json::to_value(snapshot).map_err(|e| e.to_string())?;
                if self.observations.get(thread) != Some(&data) {
                    let mut event = HostEvent::new("mcp_runtime", None, String::new());
                    event.thread_id = Some(thread.clone());
                    event.data = data.clone();
                    provider.send(&serde_json::json!({"action":"session_event","event":event}))?;
                    self.observations.insert(thread.clone(), data);
                }
            }
            while let Ok(message) = provider.output.try_recv() {
                let message = message?;
                match message["kind"].as_str() {
                    Some("mcp_ready") => {}
                    Some("mcp_session_request") => {
                        dispatch(message["request"].clone(), provider.reply_tx.clone())
                    }
                    Some("mcp_resource_selected") => {
                        let event: HostEvent =
                            serde_json::from_value(message).map_err(|e| e.to_string())?;
                        let admitted = (|| {
                            let thread = event
                                .thread_id
                                .as_deref()
                                .ok_or("Missing resource conversation")?;
                            if !self.sessions.contains_key(thread) {
                                return Err("MCP resource conversation is no longer available");
                            }
                            let selection: pero_contracts::mcp_resource::McpResourceSelection =
                                serde_json::from_value(event.data.clone())
                                    .map_err(|_| "Invalid MCP resource selection")?;
                            let context = selection.into_context(thread)?;
                            pero_contracts::mcp_resource::admit_context(
                                &context,
                                snapshots.get(thread),
                            )
                        })();
                        match admitted {
                            Ok(()) => events.push(event),
                            Err(error) => {
                                let mut rejected =
                                    HostEvent::new("mcp_error", event.request_id, error.into());
                                rejected.thread_id = event.thread_id;
                                events.push(rejected);
                            }
                        }
                    }
                    Some("mcp_sources") | Some("mcp_app_view") | Some("mcp_error") => {
                        events.push(serde_json::from_value(message).map_err(|e| e.to_string())?)
                    }
                    _ => return Err("Invalid MCP provider response".into()),
                }
            }
            while let Ok(event) = provider.replies.try_recv() {
                provider.send(&serde_json::json!({"action":"session_result","event":event}))?;
            }
            Ok(())
        })();
        if let Err(error) = result {
            self.provider = None;
            self.sessions.clear();
            self.observations.clear();
            events.push(HostEvent::new("mcp_error", None, error));
        }
        events
    }
    pub fn dispatch(
        &mut self,
        value: serde_json::Value,
        agents: &super::agents::Manager,
        locale: &str,
    ) -> Option<HostEvent> {
        let request = match serde_json::from_value::<McpSourceRequest>(value) {
            Ok(request) if request.validate().is_ok() => {
                request
            }
            _ => {
                return Some(HostEvent::new(
                    "mcp_error",
                    None,
                    "Invalid MCP source request".into(),
                ));
            }
        };
        let mut event =
            HostEvent::new("mcp_error", Some(request.request_id.clone()), String::new());
        if request
            .thread_id
            .as_ref()
            .is_some_and(|thread| !agents.has_thread(thread))
        {
            event.text = "This conversation is unavailable".into();
            return Some(event);
        }
        let session = if matches!(request.mode, McpSourceMode::Session) {
            match request
                .thread_id
                .as_deref()
                .and_then(|thread| agents.mcp_session_snapshot(thread))
            {
                Some(session) if !session.closed => Some(
                    serde_json::json!({"thread_id":session.thread_id,"incarnation":session.incarnation,"revision":session.revision}),
                ),
                _ => {
                    event.text = "This conversation has no active MCP session".into();
                    return Some(event);
                }
            }
        } else {
            None
        };
        if std::env::var_os("PERO_MCP_EXTERNAL").is_some() {
            event.kind = "mcp_permitted".into();
            event.thread_id = request.thread_id;
            event.data = serde_json::json!({"locale":locale,"mode":request.mode,"session":session});
            if matches!(request.action,pero_contracts::mcp_source::McpAction::Adopt){
                event.data["action"]=serde_json::json!("adopt");event.data["server"]=serde_json::json!(request.server);event.data["generation"]=serde_json::json!(request.generation);event.data["tool_call"]=serde_json::json!(request.tool_call);
            }
            return Some(event);
        }
        let result = (|| {
            if self.provider.is_none() {
                self.provider = Some(Provider::start(&self.config)?);
            }
            self.provider.as_mut().expect("provider started").send(&serde_json::json!({
                "action":request.action,"thread_id":request.thread_id,"request_id":request.request_id,"locale":locale,"mode":request.mode,"session":session,"server":request.server,"generation":request.generation,"tool_call":request.tool_call
            }))
        })();
        match result {
            Ok(()) => {
                if let Some(session) = session {
                    self.sessions.insert(
                        session["thread_id"].as_str().unwrap().to_owned(),
                        session["incarnation"].as_u64().unwrap(),
                    );
                }
                None
            }
            Err(error) => {
                self.provider = None;
                self.sessions.clear();
                self.observations.clear();
                event.text = error;
                Some(event)
            }
        }
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    #[test]
    fn provider_poll_delivers_resource_selection_and_rejects_stale_without_disconnect() {
        use pero_contracts::mcp_runtime::{McpRuntimeSession, McpRuntimeStatus};
        let mut snapshot =
            McpRuntimeSession::new("agent".into(), "thread".into(), 2, 3, vec!["docs".into()]);
        snapshot.observable = true;
        snapshot.session_id = Some("session".into());
        snapshot.servers[0].generation = 4;
        snapshot.servers[0].status = McpRuntimeStatus::Connected;
        let mut selected = HostEvent::new("mcp_resource_selected", None, String::new());
        selected.thread_id = Some("thread".into());
        selected.data = serde_json::json!({"incarnation":2,"revision":3,"server":"docs","generation":4,"uri":"docs://a","contents":[{"uri":"docs://a","text":"resource text"}]});
        let mut stale = selected.clone();
        stale.data["generation"] = serde_json::json!(3);
        let mut binary = selected.clone();
        binary.data["contents"][0]["blob"] = serde_json::json!("YWJj");
        let frames = format!(
            "{}\n{}\n{}\n",
            serde_json::to_string(&selected).unwrap(),
            serde_json::to_string(&stale).unwrap(),
            serde_json::to_string(&binary).unwrap()
        );
        let child = Command::new("sh")
            .args(["-c", "printf '%s' \"$FRAMES\"; while read reply; do case \"$reply\" in *shutdown*) exit;; esac; done"])
            .env("FRAMES", frames)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        let mut mcp = Mcp::new(None);
        mcp.provider = Some(Provider::from_child(child));
        mcp.sessions.insert("thread".into(), 2);
        let snapshots = [("thread".into(), snapshot)].into_iter().collect();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        let mut events = Vec::new();
        while events.len() < 3 && std::time::Instant::now() < deadline {
            events.extend(mcp.poll_provider(&snapshots, |_, _| panic!("no RPC expected")));
            std::thread::yield_now();
        }
        assert_eq!(events.len(), 3);
        assert_eq!(events[0].kind, "mcp_resource_selected");
        assert_eq!(events[0].data, selected.data);
        assert_eq!(events[0].thread_id.as_deref(), Some("thread"));
        assert_eq!(events[1].kind, "mcp_error");
        assert_eq!(events[2].kind, "mcp_error");
        assert!(mcp.provider.is_some());
    }

    #[test]
    fn provider_transport_remains_duplex_while_request_is_pending() {
        // A provider announces an RPC before reading its answer. Host must be
        // free to process permission input before it sends that answer.
        let child = Command::new("sh").args(["-c", "printf '%s\\n' '{\"kind\":\"mcp_session_request\",\"request\":{\"request_id\":\"pending\"}}'; read reply; printf '%s\\n' \"$reply\""])
            .stdin(Stdio::piped()).stdout(Stdio::piped()).spawn().unwrap();
        let mut provider = Provider::from_child(child);
        let request = provider
            .output
            .recv_timeout(std::time::Duration::from_secs(5))
            .unwrap()
            .unwrap();
        assert_eq!(request["request"]["request_id"], "pending");
        let reply = serde_json::json!({"action":"session_result","event":{"request_id":"pending","kind":"mcp_session"}});
        provider.send(&reply).unwrap();
        assert_eq!(
            provider
                .output
                .recv_timeout(std::time::Duration::from_secs(5))
                .unwrap()
                .unwrap(),
            reply
        );
        assert_eq!(
            provider
                .output
                .recv_timeout(std::time::Duration::from_secs(5))
                .unwrap()
                .unwrap_err(),
            "MCP Apps provider stopped"
        );
    }
}
