//! The primary Agent's MCP adapter into the existing Host conversation owner.
use pero_contracts::project_agent::ProjectAgentAction;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    hash::BuildHasher,
    io::{self, BufRead, BufReader, Read, Write},
    net::{TcpListener, TcpStream},
    sync::mpsc,
    time::Duration,
};

pub(crate) struct ToolCall {
    pub thread_id: String,
    pub request_id: String,
    pub action: Action,
    pub reply: mpsc::SyncSender<Result<Value, String>>,
}
pub(crate) struct Broker {
    address: String,
    token: String,
    receiver: mpsc::Receiver<ToolCall>,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum Action {
    List {},
    Delegate {#[serde(default)] agent_id: Option<String>, title: String, prompt: String},
    Followup {thread_id: String, prompt: String},
    Cancel {thread_id: String},
}
impl Action {
    pub fn command(self, primary: &str, default_agent: &str) -> Option<ProjectAgentAction> {
        match self {
            Self::List {} => None,
            Self::Delegate {agent_id, title, prompt} => Some(ProjectAgentAction::Delegate {
                thread_id: primary.into(), agent_id: agent_id.unwrap_or_else(|| default_agent.into()), title, prompt,
            }),
            Self::Followup {thread_id, prompt} => Some(ProjectAgentAction::Followup {thread_id, prompt}),
            Self::Cancel {thread_id} => Some(ProjectAgentAction::Cancel {thread_id}),
        }
    }
    pub fn target(&self) -> Option<&str> {
        match self {Self::Followup {thread_id,..} | Self::Cancel {thread_id} => Some(thread_id), _ => None}
    }
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Envelope {
    token: String,
    thread_id: String,
    request_id: String,
    action: Action,
}

impl Broker {
    pub fn start() -> io::Result<Self> {
        let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))?;
        let address = listener.local_addr()?.to_string();
        let seed = std::collections::hash_map::RandomState::new();
        let token = format!("{:016x}{:016x}", seed.hash_one("project-tools-a"), seed.hash_one("project-tools-b"));
        let expected = token.clone();
        let (sender, receiver) = mpsc::sync_channel::<ToolCall>(16);
        std::thread::spawn(move || {
            for connection in listener.incoming() {
                let Ok(mut stream) = connection else { break };
                let _ = stream.set_read_timeout(Some(Duration::from_secs(15)));
                let _ = stream.set_write_timeout(Some(Duration::from_secs(15)));
                let result = (|| -> Result<Value, String> {
                    let mut line = String::new();
                    BufReader::new((&mut stream).take(1_048_577)).read_line(&mut line).map_err(|e| e.to_string())?;
                    if line.len() > 1_048_576 { return Err("Project tool input exceeds 1 MiB".into()); }
                    let input: Envelope = serde_json::from_str(&line).map_err(|e| e.to_string())?;
                    if input.token != expected { return Err("Project tool connection expired".into()); }
                    let (reply, receive) = mpsc::sync_channel(1);
                    sender.send(ToolCall {thread_id: input.thread_id, request_id: input.request_id, action: input.action, reply})
                        .map_err(|_| "Project Host is unavailable")?;
                    receive.recv_timeout(Duration::from_secs(45)).map_err(|_| "Project Host request timed out; inspect the same request before retrying")?
                })();
                let response = match result {Ok(value) => json!({"ok":true,"value":value}), Err(error) => json!({"ok":false,"error":error})};
                if serde_json::to_writer(&mut stream, &response).is_ok() { let _ = writeln!(stream); }
            }
        });
        Ok(Self {address, token, receiver})
    }
    pub fn drain(&self) -> Vec<ToolCall> { self.receiver.try_iter().collect() }
    pub fn server(&self, thread: &str) -> Result<pero_runtime::acp::sdk::schema::v1::McpServer, String> {
        use pero_runtime::acp::sdk::schema::v1::{McpServer, McpServerStdio};
        let executable = std::env::current_exe().map_err(|e| e.to_string())?;
        Ok(McpServer::Stdio(McpServerStdio::new("pero-project", executable).args(vec![
            "--project-tools".into(), self.address.clone(), self.token.clone(), thread.into(),
        ])))
    }
}

/// A small MCP stdio process. It owns no sessions, task state, files or credentials.
pub(crate) fn serve(address: &str, token: &str, thread: &str) -> io::Result<()> {
    for line in io::stdin().lock().lines() {
        let input: Value = match serde_json::from_str(&line?) {Ok(value) => value, Err(_) => continue};
        let Some(id) = input.get("id").cloned() else { continue };
        let result = match input["method"].as_str() {
            Some("initialize") => Ok(json!({"protocolVersion": input["params"]["protocolVersion"].as_str().unwrap_or("2024-11-05"),
                "capabilities":{"tools":{}},"serverInfo":{"name":"pero-project","version":"1"}})),
            Some("ping") => Ok(json!({})),
            Some("tools/list") => Ok(json!({"tools":[{
                "name":"project_work",
                "description":"Delegate bounded work to a separate Agent conversation in this Project; list original session states and evidence, append instructions to a child, or request cancellation. Only the Project's primary Agent has this tool. Delegated work runs asynchronously in a retained isolated workspace. A completed turn is execution evidence, not verification. Use list to inspect results and cite the exact thread_id in your summary. Do not repeatedly poll or claim success before terminal evidence. Child changes remain in their workspace; no automatic merge.",
                "inputSchema":{"type":"object","additionalProperties":false,"required":["action"],"properties":{
                    "action":{"type":"string","enum":["list","delegate","followup","cancel"]},
                    "request_id":{"type":"string","description":"Stable identity for delegate retries. Use a new ID for new work."},
                    "thread_id":{"type":"string"},"agent_id":{"type":"string"},"title":{"type":"string"},"prompt":{"type":"string"}
                }}
            }]})),
            Some("tools/call") if input["params"]["name"] == "project_work" => {
                let outcome = forward(address, token, thread, input["params"]["arguments"].clone());
                Ok(match outcome {
                    Ok(value) => json!({"content":[{"type":"text","text":serde_json::to_string_pretty(&value)?}]}),
                    Err(error) => json!({"isError":true,"content":[{"type":"text","text":error}]}),
                })
            }
            _ => Err("Unknown Project MCP method".to_string()),
        };
        let response = match result {
            Ok(result) => json!({"jsonrpc":"2.0","id":id,"result":result}),
            Err(message) => json!({"jsonrpc":"2.0","id":id,"error":{"code":-32601,"message":message}}),
        };
        let mut stdout = io::stdout().lock();
        serde_json::to_writer(&mut stdout, &response)?;
        writeln!(stdout)?;
        stdout.flush()?;
    }
    Ok(())
}
fn forward(address: &str, token: &str, thread: &str, mut args: Value) -> Result<Value, String> {
    let request_id = args.as_object_mut().and_then(|args| args.remove("request_id"))
        .map(|value| value.as_str().map(str::to_owned).ok_or("request_id must be a string"))
        .transpose()?.unwrap_or_else(|| format!("tool-{:x}", std::collections::hash_map::RandomState::new().hash_one(thread)));
    let action: Action = serde_json::from_value(args).map_err(|error| error.to_string())?;
    let mut stream = TcpStream::connect(address).map_err(|e| e.to_string())?;
    stream.set_read_timeout(Some(Duration::from_secs(50))).map_err(|e| e.to_string())?;
    serde_json::to_writer(&mut stream, &Envelope {token: token.into(), thread_id: thread.into(), request_id, action}).map_err(|e| e.to_string())?;
    writeln!(stream).map_err(|e| e.to_string())?;
    let mut line = String::new();
    BufReader::new(stream.take(2_097_153)).read_line(&mut line).map_err(|e| e.to_string())?;
    let response: Value = serde_json::from_str(&line).map_err(|e| e.to_string())?;
    if response["ok"] == true {Ok(response["value"].clone())} else {Err(response["error"].as_str().unwrap_or("Project Host unavailable").into())}
}
