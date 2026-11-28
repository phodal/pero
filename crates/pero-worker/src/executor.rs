use crate::{
    approval::{Gate, Policy, protected_path},
    model::{Outcome, RemoteGrant, Run},
    run_desktop::{HandoffMonitor, HandoffStatus},
};
use pero_contracts::{HostEvent, local_worker::BUILTIN_AGENT_KEY_ENV};
use pero_runtime::acp::{self, AgentConfig, SessionCommand};
use pero_runtime::workspace_lease::WorkspaceLease;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    io::{BufRead, Write},
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    time::{Duration, Instant},
};

pub(crate) const ACP_CANCEL_GRACE: Duration = Duration::from_secs(2);

pub fn execution_env_allowed(key: &std::ffi::OsStr) -> bool {
    !key.to_string_lossy().starts_with("PERO_")
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Config {
    #[serde(default)]
    pub workspaces: BTreeMap<String, PathBuf>,
    #[serde(default)]
    pub remote_bridge: Option<PathBuf>,
    pub agents_file: Option<PathBuf>,
    #[serde(default)]
    pub native_approvals: BTreeMap<String, Policy>,
    #[serde(default)]
    pub allowed_agents: BTreeMap<String, Vec<String>>,
}

#[derive(Deserialize, Serialize)]
pub struct Execution {
    workspace: PathBuf,
    agent: AgentConfig,
    prompt: String,
    run_id: String,
    approval: Option<Policy>,
    #[serde(default)]
    remote: bool,
    #[serde(default)]
    run_desktop: Option<HandoffMonitor>,
}

impl Execution {
    pub(crate) fn attach_desktop(&mut self, url: &str, access: &str, monitor: HandoffMonitor) -> Result<(), String> {
        let server = serde_json::from_value(json!({"type":"http", "name":"pero-run-desktop", "url":url,
            "headers":[{"name":"Authorization","value":format!("Bearer {access}")}]}))
            .map_err(|_| "Invalid desktop MCP configuration")?;
        self.agent.mcp_servers.push(server);
        self.run_desktop = Some(monitor);
        self.prompt.push_str("\n\nUse the Run's computer_use tool to work in the isolated Blender desktop. The Worker collects Blender models saved as /home/pero/result.blend and optional /home/pero/result.obj. Capture a final screenshot using the tool after saving. If you need the user to operate the desktop, call request_handoff with the specific reason. Once the tool returns requested, end the current turn. The Worker will resume this session after the user returns control.");
        Ok(())
    }

    pub fn inherit_environment(&self) -> bool {
        self.approval.is_none() && !self.remote
    }
}

impl Config {
    fn agents(&self) -> Result<Vec<AgentConfig>, String> {
        match &self.agents_file {
            Some(path) => serde_json::from_slice::<Vec<AgentConfig>>(
                &std::fs::read(path).map_err(|_| "Agent allowlist is unavailable")?,
            )
            .map_err(|_| "Invalid Agent allowlist".into()),
            None => acp::registry(&std::env::current_dir().map_err(|e| e.to_string())?),
        }
    }
    pub fn ready(&self) -> Result<(), String> {
        if let Some(bridge) = &self.remote_bridge {
            if !bridge.is_absolute() || !bridge.is_file() {
                return Err("Remote bridge must be an installed absolute executable".into());
            }
            if self.workspaces.is_empty() {
                return Ok(());
            }
        }
        if self.workspaces.is_empty() {
            return Err("No local workspaces are configured".into());
        }
        let agents = self.agents()?;
        if !agents.iter().any(|agent| {
            agent.available()
                && (self.allowed_agents.is_empty()
                    || self
                        .allowed_agents
                        .values()
                        .any(|ids| ids.contains(&agent.id)))
        }) {
            return Err(
                "No allowed Agent is installed; authenticate or configure a local Agent".into(),
            );
        }
        Ok(())
    }
    pub fn remote_execution(
        &self, run: &Run, grant: &RemoteGrant, origin: String, scratch: PathBuf,
    ) -> Result<Execution, String> {
        let remote = run.remote_execution.as_ref().ok_or("Missing remote execution binding")?;
        let bridge = self.remote_bridge.as_ref().ok_or(
            "Remote Run requires an operator-configured bridge; local fallback is forbidden",
        )?;
        if !bridge.is_absolute() || !bridge.is_file() || !self.native_approvals.is_empty() {
            return Err("Remote bridge unavailable or local native approval policy is incompatible".into());
        }
        if remote.working_directory != "/workspace/repo"
            || remote.session_id != grant.session_id
            || remote.session_id.is_empty()
            || remote.session_id.len() > 128
            || !remote.session_id.bytes().all(|c| c.is_ascii_alphanumeric() || b"_.-".contains(&c))
        {
            return Err("Invalid server remote execution binding".into());
        }
        // This SDK lease/cwd is private Worker state, never the Task checkout.
        let mut directories = std::fs::DirBuilder::new();
        directories.recursive(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            directories.mode(0o700);
        }
        directories.create(&scratch).map_err(|_| "Private remote bridge directory unavailable")?;
        let workspace = scratch.canonicalize().map_err(|_| "Private remote bridge directory unavailable")?;
        let mut env = BTreeMap::new();
        env.insert("PERO_REMOTE_CHANNEL_SECRET".into(), grant.secret.clone());
        let agent = AgentConfig {
            session_instructions: String::new(),
            memory_instructions: String::new(),
            required_mcp_servers: Default::default(),
            managed_mcp: None,
            id: run.spec.agent_id.clone(), name: "Remote ACP bridge".into(),
            command: bridge.to_string_lossy().into(),
            args: vec![
                "--control-url".into(), origin, "--run-id".into(), run.id.clone(),
                "--session-id".into(), remote.session_id.clone(),
                "--working-directory".into(), remote.working_directory.clone(),
            ],
            env, model: None, mcp_servers: vec![],
        };
        Ok(Execution {
            workspace, agent, prompt: prompt(run), run_id: run.id.clone(),
            approval: None, remote: true, run_desktop: None,
        })
    }
    pub fn execution(&self, run: &Run) -> Result<Execution, String> {
        if run.remote_execution.is_some() {
            return Err("Remote Run cannot fall back to local execution".into());
        }
        let workspace = self
            .workspaces
            .get(&run.spec.workspace_key)
            .ok_or("Workspace key is not allowed on this Worker")?
            .canonicalize()
            .map_err(|_| "Allowed workspace is unavailable")?;
        if !workspace.is_dir() {
            return Err("Allowed workspace is not a directory".into());
        }
        let agents = self.agents()?;
        if !self.allowed_agents.is_empty()
            && !self
                .allowed_agents
                .get(&run.spec.workspace_key)
                .is_some_and(|ids| ids.contains(&run.spec.agent_id))
        {
            return Err("Agent is not allowed for this workspace on this Worker".into());
        }
        let mut agent = agents
            .into_iter()
            .find(|agent| agent.id == run.spec.agent_id && agent.available())
            .ok_or("Agent is not allowed or installed on this Worker")?;
        let approval = self.native_approvals.get(&run.spec.workspace_key).cloned();
        if let Some(policy) = &approval {
            let roots = self
                .workspaces
                .values()
                .map(|p| {
                    p.canonicalize()
                        .map_err(|_| "Allowed workspace unavailable")
                })
                .collect::<Result<Vec<_>, _>>()?;
            let config_path = std::env::var_os("PERO_WORKER_CONFIG")
                .map(PathBuf::from)
                .ok_or("Native approvals require an explicit operator config")?;
            protected_path(&config_path, &roots)?;
            protected_path(
                self.agents_file
                    .as_deref()
                    .ok_or("Native approvals require an explicit agent allowlist")?,
                &roots,
            )?;
            policy.validate(&agent, &roots)?;
            if agent.env.keys().any(|key| key.starts_with("PERO_")) {
                return Err(
                    "Native approval agent environment cannot contain control-plane variables"
                        .into(),
                );
            }
        }
        agent.env.retain(|key, _| !key.starts_with("PERO_"));
        // Restore only the built-in Agent's credential in its private launch config.
        if agent.id == "pero"
            && approval.is_none()
            && let Ok(key) = std::env::var(BUILTIN_AGENT_KEY_ENV)
        {
            agent.env.insert("DEEPSEEK_API_KEY".into(), key);
        }
        let prompt = prompt(run);
        Ok(Execution {
            workspace,
            agent,
            prompt,
            run_id: run.id.clone(),
            approval,
            remote: false,
            run_desktop: None,
        })
    }
}

fn prompt(run: &Run) -> String {
    let acceptance = match &run.spec.acceptance {
        Value::String(text) => text.clone(),
        Value::Null => String::new(),
        value => value.to_string(),
    };
    if acceptance.is_empty() {
        run.spec.prompt.clone()
    } else {
        format!("{}\n\nAcceptance criteria:\n{}", run.spec.prompt, acceptance)
    }
}

pub fn bounded_line(reader: &mut impl BufRead, max: usize) -> Result<Option<Vec<u8>>, String> {
    let mut line = Vec::new();
    loop {
        let buffer = reader.fill_buf().map_err(|e| e.to_string())?;
        if buffer.is_empty() {
            return if line.is_empty() {
                Ok(None)
            } else {
                Err("Truncated child event".into())
            };
        }
        let take = buffer
            .iter()
            .position(|b| *b == b'\n')
            .map_or(buffer.len(), |n| n + 1);
        if line.len() + take > max {
            return Err("Child event exceeds output limit".into());
        }
        line.extend_from_slice(&buffer[..take]);
        reader.consume(take);
        if line.last() == Some(&b'\n') {
            return Ok(Some(line));
        }
    }
}

pub fn child_execute() -> Result<(), String> {
    #[cfg(not(unix))]
    {
        return Err("Worker process supervision currently requires Unix".into());
    }
    let mut input = std::io::stdin().lock();
    let mut execution: Execution = serde_json::from_slice(
        &bounded_line(&mut input, 512 * 1024)?.ok_or("Missing execution configuration")?,
    )
    .map_err(|_| "Invalid execution configuration")?;
    drop(input);
    // Never let an orphaned executor keep writing after its supervisor disappears.
    #[cfg(unix)]
    {
        let parent = unsafe { libc::getppid() };
        if parent <= 1 {
            return Err("Executor supervisor is unavailable".into());
        }
        std::thread::spawn(move || {
            loop {
                std::thread::sleep(Duration::from_millis(100));
                if unsafe { libc::getppid() } != parent {
                    crate::supervisor::kill_orphan_tree();
                    break;
                }
            }
        });
    }
    if let Some(policy) = &execution.approval {
        policy.validate(&execution.agent, std::slice::from_ref(&execution.workspace))?;
    }
    // The actual executor holds the lease until it exits, including orphan cleanup.
    // A supervisor dying must not release the checkout while its child still writes.
    let _workspace_lease = WorkspaceLease::acquire(&execution.workspace)?;
    let mut gate = Gate::new(execution.approval.clone(), execution.workspace.clone());
    let run_desktop = execution.run_desktop;
    let handoff_http = run_desktop.as_ref().map(|_| {
        reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(1))
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .build()
    }).transpose().map_err(|_| "Cannot connect to the Run desktop handoff endpoint")?;
    if run_desktop.is_some() {
        execution.agent.required_mcp_servers.insert("pero-run-desktop".into());
    }
    let (tx, rx) = mpsc::channel();
    let handle = acp::start_supervised(execution.agent, execution.workspace, execution.run_id, tx);
    let cancel = Arc::new(AtomicBool::new(false));
    let stdin_cancel = cancel.clone();
    std::thread::spawn(move || {
        let mut input = std::io::stdin().lock();
        // EOF also revokes execution authority.
        let _ = bounded_line(&mut input, 128);
        stdin_cancel.store(true, Ordering::SeqCst);
    });
    let mut cancelled_at = None;
    let mut result = None;
    let mut closing_at = None;
    let mut handoff_poll_at = None;
    let completed = || Outcome::new("succeeded", "Agent turn completed; independent verification remains pending");
    loop {
        if cancel.load(Ordering::SeqCst) && cancelled_at.is_none() {
            gate.revoke();
            let _ = handle.tx.send(SessionCommand::Cancel);
            cancelled_at = Some(Instant::now());
        }
        if cancelled_at.is_some_and(|at| at.elapsed() > ACP_CANCEL_GRACE) {
            result = Some(Outcome::new("cancelled", "Execution cancelled"));
            break;
        }
        if cancelled_at.is_none()
            && handoff_poll_at.is_some_and(|at| Instant::now() >= at)
            && let Some((monitor, http)) = run_desktop.as_ref().zip(handoff_http.as_ref())
        {
            handoff_poll_at = None;
            match monitor.poll(http) {
                Ok(HandoffStatus::Idle) => result = Some(completed()),
                Ok(HandoffStatus::Requested) => handoff_poll_at = Some(Instant::now() + Duration::from_millis(500)),
                Ok(HandoffStatus::Returned { request_id }) => {
                    emit("desktop_handoff_resumed", "Control returned to the Agent", json!({"request_id":request_id}))?;
                    handle.tx.send(SessionCommand::Prompt(
                        "The user returned control of this Run's desktop. Get fresh targets and observe the current desktop before sending any input. Continue the original task from what you see.".into(),
                    )).map_err(|_| "Agent closed before continuing after desktop handoff")?;
                }
                Err(_) => result = Some(Outcome::new("failed", "Run desktop handoff could not be read")),
            }
        }
        if result.is_some() && closing_at.is_none() {
            gate.revoke();
            let _ = handle.tx.send(SessionCommand::Close);
            closing_at = Some(Instant::now());
        }
        if closing_at.is_some_and(|at: Instant| at.elapsed() > Duration::from_secs(2)) {
            break;
        }
        let mut event = match rx.recv_timeout(Duration::from_millis(50)) {
            Ok(event) => event,
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(_) => break,
        };
        if run_desktop.is_some() && event.kind == "session_update" && event.data["sessionUpdate"] == "tool_call_update" {
            retain_tool_evidence_references(&mut event.data);
        }
        if event.kind == "permission" {
            // Only a live local responder can consume a decision. No remote action
            // or agent-supplied display text can create approval authority.
            let mut approved = false;
            if let Some(id) = event.data["permission_id"].as_str()
                && let Some(answer) = handle.permissions.lock().unwrap().remove(id)
            {
                if cancel.load(Ordering::SeqCst) || result.is_some() {
                    gate.revoke();
                }
                let selected = gate.select(&event.data);
                approved = selected.is_some();
                if answer.send(selected).is_err() {
                    approved = false;
                }
            }
            emit(
                if approved {
                    "permission_approved"
                } else {
                    "permission_denied"
                },
                if approved {
                    "Operator policy admitted one sandbox-required native shell call"
                } else {
                    "Worker denied an Agent permission request"
                },
                Value::Null,
            )?;
            continue;
        }
        if let Err(error) = emit(&event.kind, &event.text, event.data.clone()) {
            gate.revoke();
            let _ = handle.tx.send(SessionCommand::Close);
            result = Some(Outcome::new("failed", format!("{}: {error}", event.kind)));
            break;
        }
        match event.kind.as_str() {
            "session_ready" => {
                gate.ready(event.data["sessionId"].as_str());
                handle
                    .tx
                    .send(SessionCommand::Prompt(execution.prompt.clone()))
                    .map_err(|_| "Agent closed before prompt")?;
            }
            "session_auth_required" | "session_auth_error" => {
                result = Some(Outcome::blocked("Agent requires local authentication"));
            }
            "session_error" => {
                result = Some(Outcome::new("failed", "Agent execution failed; see events"));
            }
            "turn_finished" => {
                let reason = event.data["stopReason"].as_str().unwrap_or("");
                if cancelled_at.is_none() && reason == "end_turn" && run_desktop.is_some() {
                    handoff_poll_at = Some(Instant::now());
                    continue;
                }
                result = Some(if cancelled_at.is_some() || reason == "cancelled" {
                    Outcome::new("cancelled", "Execution cancelled")
                } else if reason == "end_turn" {
                    completed()
                } else {
                    Outcome::new("failed", format!("Agent stopped: {reason}"))
                });
            }
            "session_closed" => break,
            _ => {}
        }
    }
    let result =
        result.unwrap_or_else(|| Outcome::new("failed", "Agent closed without a completed turn"));
    emit("worker_result", "", json!(result))
}

fn emit(kind: &str, text: &str, data: Value) -> Result<(), String> {
    let mut output = std::io::stdout().lock();
    let mut event = HostEvent::new(kind, None, text.to_owned());
    event.data = data;
    let bytes = serde_json::to_vec(&event).map_err(|e| e.to_string())?;
    if bytes.len() > 65536 {
        return Err("Agent event exceeds output limit".into());
    }
    output
        .write_all(&bytes)
        .and_then(|_| output.write_all(b"\n"))
        .and_then(|_| output.flush())
        .map_err(|e| e.to_string())
}

// ACP forwards MCP results both to the model and to the event journal. Keep
// images in the model path and Run artifact storage, outside the JSON event cap.
fn retain_tool_evidence_references(data: &mut Value) {
    const EVIDENCE: &str = "See Run desktop evidence for the saved tool output.";
    fn strip_images(value: &mut Value) {
        if value["type"] == "image" && value["data"].is_string() {
            *value = json!({"type":"text","text":EVIDENCE});
            return;
        }
        match value {
            Value::Array(items) => items.iter_mut().for_each(strip_images),
            Value::Object(fields) => fields.values_mut().for_each(strip_images),
            _ => {}
        }
    }
    strip_images(data);
    if serde_json::to_vec(data).is_ok_and(|wire| wire.len() > 60_000) {
        *data = json!({"sessionUpdate":"tool_call_update","toolCallId":data["toolCallId"],
            "status":data["status"],"content":[{"type":"content","content":{"type":"text","text":EVIDENCE}}]});
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn desktop_tool_event_retains_receipt_without_inline_image_bytes() {
        let mut event = json!({"toolCallId":"tool-1", "rawOutput":{"result":{"content":[
            {"type":"text","text":"observation 1"}, {"type":"image","data":"a".repeat(90_000),"mimeType":"image/jpeg"}
        ]}}});
        retain_tool_evidence_references(&mut event);
        assert_eq!(event["rawOutput"]["result"]["content"][0]["text"], "observation 1");
        assert!(serde_json::to_vec(&event).unwrap().len() < 1024);
    }
    #[test]
    fn lines_are_bounded_and_truncation_rejected() {
        assert!(bounded_line(&mut std::io::Cursor::new(b"long\n"), 3).is_err());
        assert!(bounded_line(&mut std::io::Cursor::new(b"partial"), 32).is_err());
        assert_eq!(
            bounded_line(&mut std::io::Cursor::new(b"ok\n"), 32)
                .unwrap()
                .unwrap(),
            b"ok\n"
        );
    }
    #[test]
    fn cloud_paths_and_commands_never_select_an_execution() {
        let config = Config {
            remote_bridge: None,
            workspaces: BTreeMap::new(),
            agents_file: None,
            native_approvals: BTreeMap::new(),
            allowed_agents: BTreeMap::new(),
        };
        let run = Run {
            desktop_profile: None,
            remote_execution: None,
            id: "r".into(),
            generation: 1,
            instance_id: "i".into(),
            status: "running".into(),
            lease_expires_at: String::new(),
            spec: crate::model::Spec {
                title: String::new(),
                prompt: String::new(),
                workspace_key: "/tmp".into(),
                agent_id: "/bin/sh".into(),
                acceptance: Value::Null,
            },
        };
        assert_eq!(
            config.execution(&run).err().unwrap(),
            "Workspace key is not allowed on this Worker"
        );
    }
}
