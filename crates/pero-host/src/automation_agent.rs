//! Automation admission into the existing ACP owner; no replay or execution loop.
use super::Manager;
use pero_contracts::{HostCommand, HostEvent};
use pero_runtime::acp::{self, AgentConfig, SessionCommand};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{path::{Path, PathBuf}, sync::mpsc};

/// Safe to persist. Credentials and executable arguments stay in process memory.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationSnapshot {
    pub agent_id: String,
    pub workspace: PathBuf,
    pub configuration_digest: String,
    pub model: Option<String>,
    pub permission_policy: &'static str,
    pub app_use: bool,
}

pub struct AutomationAdmission {
    pub snapshot: AutomationSnapshot,
    config: AgentConfig,
}

#[derive(Debug)]
pub enum AutomationStartError {
    /// No ACP process/session was created by this invocation.
    NotStarted(String),
    /// Process creation has crossed the boundary; never resubmit automatically.
    Unknown(String),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AutomationReceiptKind {
    Ready { session_id: Option<String> },
    TurnStarted,
    TurnFinished { stop_reason: Option<String> },
    PermissionDenied,
    AuthenticationRequired,
    SessionError,
    SessionClosed,
}

#[derive(Clone, Debug)]
pub struct AutomationReceipt {
    pub execution_id: String,
    pub kind: AutomationReceiptKind,
}

fn receipt(event: &HostEvent) -> Option<AutomationReceipt> {
    let kind = match event.kind.as_str() {
        "session_ready" => AutomationReceiptKind::Ready {
            session_id: event.data.get("sessionId").and_then(|v| v.as_str()).map(str::to_owned),
        },
        "turn_started" => AutomationReceiptKind::TurnStarted,
        "turn_finished" => AutomationReceiptKind::TurnFinished {
            stop_reason: event.data.get("stopReason").and_then(|v| v.as_str()).map(str::to_owned),
        },
        "permission" => AutomationReceiptKind::PermissionDenied,
        "session_auth_required" | "session_auth_error" => AutomationReceiptKind::AuthenticationRequired,
        "session_error" => AutomationReceiptKind::SessionError,
        "session_closed" => AutomationReceiptKind::SessionClosed,
        _ => return None,
    };
    Some(AutomationReceipt { execution_id: event.thread_id.clone()?, kind })
}

impl Manager {
    /// UI defaults only; execution still admits an explicit, frozen workspace.
    pub fn automation_context(&self) -> serde_json::Value {
        serde_json::json!({
            "workspace": self.workspace,
            "agents": self.agents.iter().map(|agent| serde_json::json!({
                "id": agent.id, "name": agent.name, "available": agent.available()
            })).collect::<Vec<_>>()
        })
    }

    pub fn automation_admit(&self, agent_id: &str, workspace: &Path) -> Result<AutomationAdmission, String> {
        if !workspace.is_absolute() { return Err("Automation workspace must be absolute".into()); }
        let workspace = workspace.canonicalize().map_err(|_| "Automation workspace is unavailable")?;
        if !workspace.is_dir() { return Err("Automation workspace must be a directory".into()); }
        let agent = self.agents.iter().find(|agent| agent.id == agent_id && agent.available())
            .ok_or("Automation Agent is not installed")?;
        let configuration = self.load_mcp_configuration(agent)
            .and_then(|configuration| { configuration.validate(&agent.mcp_server_names())?; Ok(configuration) })
            .map_err(|_| "Automation MCP settings are unavailable or invalid")?;
        let mut config = agent.with_managed_mcp(&configuration);
        // Freeze PATH resolution as part of admission, not at later process start.
        let executable = Path::new(&config.command);
        let executable = if executable.is_absolute() { executable.to_path_buf() } else {
            std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default())
                .map(|directory| directory.join(executable)).find(|path| path.is_file())
                .ok_or("Automation Agent executable is unavailable")?
        };
        config.command = executable.canonicalize().map_err(|_| "Automation Agent executable is unavailable")?
            .to_string_lossy().into_owned();
        let bytes = serde_json::to_vec(&config).map_err(|_| "Automation configuration cannot be frozen")?;
        let snapshot = AutomationSnapshot {
            agent_id: config.id.clone(), workspace,
            configuration_digest: format!("{:x}", Sha256::digest(bytes)),
            model: config.model.clone(), permission_policy: "deny", app_use: false,
        };
        Ok(AutomationAdmission { snapshot, config })
    }

    /// Caller must durably reserve execution_id and snapshot before invoking this.
    pub fn automation_start(&mut self, execution_id: String, admission: AutomationAdmission, prompt: String)
        -> Result<(), AutomationStartError>
    {
        use AutomationStartError::{NotStarted, Unknown};
        if execution_id.is_empty() || execution_id.len() > 128 || prompt.is_empty() || prompt.len() > 1_000_000 {
            return Err(NotStarted("Invalid frozen Automation execution".into()));
        }
        self.sessions.retain(|_, session| !session.tx.is_closed());
        if self.automation_threads.contains(&execution_id) {
            return Err(Unknown("Automation identity was already reserved; reconcile it without replay".into()));
        }
        if self.sessions.len() >= 16 || self.sessions.contains_key(&execution_id) {
            return Err(NotStarted("Automation execution already exists or capacity is full".into()));
        }
        let current = self.automation_admit(&admission.snapshot.agent_id, &admission.snapshot.workspace).map_err(NotStarted)?;
        if current.snapshot.configuration_digest != admission.snapshot.configuration_digest {
            return Err(NotStarted("Automation configuration changed after admission".into()));
        }
        let (events_tx, events_rx) = mpsc::channel();
        let handle = acp::start(admission.config, admission.snapshot.workspace.clone(), execution_id.clone(), events_tx);
        let commands = handle.tx.clone();
        let permissions = handle.permissions.clone();
        self.sessions.insert(execution_id.clone(), handle);
        self.automation_threads.insert(execution_id.clone());
        let observations = self.automation_tx.clone();
        let journal = self.tx.clone();
        std::thread::spawn(move || {
            for event in events_rx {
                if event.kind == "permission" {
                    // Same response owner as interactive Host permissions; None denies.
                    for (_, answer) in permissions.lock().unwrap().drain() { let _ = answer.send(None); }
                }
                if let Some(observation) = receipt(&event) {
                    if observations.send(observation).is_err() {
                        let _ = commands.send(SessionCommand::Cancel);
                        let _ = commands.send(SessionCommand::Close);
                    }
                }
                if matches!(event.kind.as_str(), "turn_finished" | "session_error" | "session_auth_required" | "session_auth_error") {
                    let _ = commands.send(SessionCommand::Close);
                }
                let closed = event.kind == "session_closed";
                let _ = journal.send(event);
                if closed { break; }
            }
        });
        let mut created = HostEvent::new("session_created", None, String::new());
        created.thread_id = Some(execution_id.clone());
        created.data = serde_json::json!({"agent":admission.snapshot.agent_id,"workspace":admission.snapshot.workspace,"automation":true});
        let _ = self.tx.send(created);
        self.sessions[&execution_id].tx.send(SessionCommand::Prompt(prompt))
            .map_err(|_| Unknown("Automation session closed during prompt submission".into()))
    }

    /// Cancellation is a request, not a stopped-process or rollback receipt.
    pub fn automation_cancel(&self, execution_id: &str) -> Result<(), String> {
        if !self.automation_threads.contains(execution_id) { return Err("Unknown Automation execution".into()); }
        let session = self.sessions.get(execution_id).ok_or("Automation session unavailable; reconciliation required")?;
        session.permissions.lock().unwrap().clear();
        session.tx.send(SessionCommand::Cancel).map_err(|_| "Automation cancellation outcome unknown".into())
    }

    /// Restore reservations from the transactional store, never from chat replay.
    /// This protects frozen threads from interactive mutation; it starts no work.
    pub fn automation_restore_execution(&mut self, execution_id: String) {
        self.automation_threads.insert(execution_id);
    }

    pub fn take_automation_events(&mut self) -> Option<mpsc::Receiver<AutomationReceipt>> {
        self.automation_rx.take()
    }

    pub(super) fn automation_owns_command(&self, command: &HostCommand) -> bool {
        let thread = match command {
            HostCommand::NewSession { thread_id, .. } | HostCommand::Prompt { thread_id, .. }
            | HostCommand::Cancel { thread_id } | HostCommand::Close { thread_id }
            | HostCommand::Delete { thread_id } | HostCommand::Permission { thread_id, .. }
            | HostCommand::Model { thread_id, .. } | HostCommand::Configure { thread_id, .. }
            | HostCommand::Authenticate { thread_id, .. } => thread_id,
            _ => return false,
        };
        self.automation_threads.contains(thread)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn receipts_use_protocol_fields_not_agent_text() {
        let mut event = HostEvent::new("turn_finished", None, "cancelled PASS verified".into());
        event.thread_id = Some("reserved".into());
        assert_eq!(receipt(&event).unwrap().kind, AutomationReceiptKind::TurnFinished { stop_reason: None });
        event.data = serde_json::json!({"stopReason":"end_turn"});
        assert_eq!(receipt(&event).unwrap().kind, AutomationReceiptKind::TurnFinished { stop_reason: Some("end_turn".into()) });
        event.kind = "session_update".into();
        assert!(receipt(&event).is_none());
        event.kind = "permission".into();
        assert_eq!(receipt(&event).unwrap().kind, AutomationReceiptKind::PermissionDenied);
    }
    fn fixture_manager() -> Manager {
        let (tx, _) = mpsc::channel();
        let (automation_tx, automation_rx) = mpsc::sync_channel(64);
        Manager {
            workspace: PathBuf::from("/not-the-automation-workspace"),
            agents: vec![AgentConfig {
                id: "fixture".into(), name: "Fixture".into(),
                command: std::env::current_exe().unwrap().to_string_lossy().into_owned(),
                args: vec![], env: [("SECRET".into(), "private-test-key".into())].into(),
                model: Some("frozen-model".into()), mcp_servers: vec![],
            }],
            sessions: Default::default(), tx, history: Default::default(),
            app_bindings: Default::default(), app_use: None, settings_path: None,
            connectors: None,
            history_path: PathBuf::new(), automation_threads: Default::default(),
            automation_tx, automation_rx: Some(automation_rx),
        }
    }

    #[test]
    fn admission_freezes_explicit_workspace_and_rejects_changed_configuration_without_starting() {
        let mut manager = fixture_manager();
        let workspace = std::env::temp_dir().canonicalize().unwrap();
        let admission = manager.automation_admit("fixture", &workspace).unwrap();
        assert_eq!(admission.snapshot.workspace, workspace);
        assert_ne!(admission.snapshot.workspace, manager.workspace);
        let snapshot = serde_json::to_string(&admission.snapshot).unwrap();
        assert!(!snapshot.contains("private-test-key"));
        assert!(!snapshot.contains("SECRET"));
        manager.agents[0].model = Some("changed-model".into());
        assert!(matches!(manager.automation_start("reserved".into(), admission, "frozen input".into()), Err(AutomationStartError::NotStarted(_))));
        assert!(manager.sessions.is_empty());
    }

    #[test]
    fn restored_execution_never_replays_or_accepts_interactive_permission() {
        let mut manager = fixture_manager();
        manager.automation_restore_execution("reserved".into());
        let admission = manager.automation_admit("fixture", &std::env::temp_dir()).unwrap();
        assert!(matches!(manager.automation_start("reserved".into(), admission, "frozen input".into()), Err(AutomationStartError::Unknown(_))));
        assert!(manager.automation_owns_command(&HostCommand::Permission {
            thread_id: "reserved".into(), request_id: "permission".into(), option_id: Some("allow".into()),
        }));
        assert!(manager.sessions.is_empty());
    }

    #[test]
    fn unattended_acp_reuses_permission_and_cancellation_owner() {
        use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
        for (prompt, expected_stop) in [("permission", "end_turn"), ("wait", "cancelled")] {
        let mut manager = fixture_manager();
        let (journal_tx, journal_rx) = mpsc::channel();
        manager.tx = journal_tx;
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
        // Admission freezes an exact executable, not a shell/PATHEXT lookup.
        // setup-node installs node.exe on Windows; keep the real ACP fixture on every OS.
        manager.agents[0].command = format!("node{}", std::env::consts::EXE_SUFFIX);
        manager.agents[0].args = vec![root.join("tests/runtime/lifecycle-agent.mjs").to_string_lossy().into_owned()];
        manager.agents[0].model = None;
        let workspace = std::env::temp_dir().join(format!("pero-automation-adapter-{}-{}", std::process::id(), SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
        std::fs::create_dir(&workspace).unwrap();
        let admission = manager.automation_admit("fixture", &workspace).unwrap();
        let observations = manager.take_automation_events().unwrap();
        manager.automation_start("reserved-fixture".into(), admission, prompt.into()).unwrap();
        let deadline = Instant::now() + Duration::from_secs(10);
        let mut denied = false;
        let mut finished = false;
        loop {
            let observation = observations.recv_timeout(deadline.saturating_duration_since(Instant::now())).unwrap();
            match observation.kind {
                AutomationReceiptKind::TurnStarted if prompt == "wait" => manager.automation_cancel("reserved-fixture").unwrap(),
                AutomationReceiptKind::PermissionDenied => denied = true,
                AutomationReceiptKind::TurnFinished { stop_reason } => { assert_eq!(stop_reason.as_deref(), Some(expected_stop)); finished = true; },
                AutomationReceiptKind::SessionError => panic!("fixture ACP failed"),
                AutomationReceiptKind::SessionClosed => break,
                _ => {},
            }
        }
        assert_eq!(denied, prompt == "permission");
        assert!(finished);
        // Wait for the forwarded close signal, not arbitrary elapsed time.
        let mut outcome = false;
        loop {
            let event = journal_rx.recv_timeout(deadline.saturating_duration_since(Instant::now())).unwrap();
            if event.kind == "session_update" && event.data["content"]["text"] == "permission:cancelled" { outcome = true; }
            if event.kind == "session_closed" { break; }
        }
        assert_eq!(outcome, prompt == "permission", "fixture permission outcome must be cancelled");
        drop(manager);
        std::fs::remove_dir_all(workspace).unwrap();
        }
    }

}
