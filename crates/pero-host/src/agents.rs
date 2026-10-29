use pero_contracts::{
    HostCommand, HostEvent,
    context::{ContextKind, ContextReference},
};
use pero_runtime::acp::{self, AgentConfig, SessionCommand, SessionHandle};
use pero_runtime::apps::agent::AppSessionBinding;
use pero_runtime::context::ContextSources;
#[path = "app_agent.rs"]
mod app_agent;
use std::{
    collections::HashMap,
    io::Write,
    path::PathBuf,
    sync::{
        Arc, Mutex,
        mpsc::{self, Sender},
    },
};

pub struct Manager {
    workspace: PathBuf,
    agents: Vec<AgentConfig>,
    sessions: HashMap<String, SessionHandle>,
    tx: Sender<HostEvent>,
    history: Arc<Mutex<Vec<HostEvent>>>,
    app_bindings: HashMap<String, AppSessionBinding>,
    app_use: Option<acp::AppUseEndpoint>,
    settings_path: Option<PathBuf>,
}
impl Manager {
    pub fn new(root: PathBuf) -> Self {
        let history_file = std::env::var_os("PERO_HISTORY_PATH")
            .map(PathBuf::from)
            .unwrap_or_else(|| root.join("target/sessions.jsonl"));
        let stored = std::fs::read_to_string(&history_file)
            .unwrap_or_default()
            .lines()
            .rev()
            .take(5000)
            .filter_map(|line| serde_json::from_str::<HostEvent>(line).ok())
            .collect::<Vec<_>>();
        let app_bindings = stored
            .iter()
            .filter_map(|event| {
                if event.kind != "session_created" {
                    return None;
                }
                let binding: AppSessionBinding =
                    serde_json::from_value(event.data.get("appBinding")?.clone()).ok()?;
                Some((event.thread_id.clone()?, binding))
            })
            .collect();
        let history = Arc::new(Mutex::new(stored.into_iter().rev().collect::<Vec<_>>()));
        let saved = history.clone();
        if let Some(parent) = history_file.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let mut journal = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(history_file)
            .ok();
        let (tx, rx) = mpsc::channel::<HostEvent>();
        std::thread::spawn(move || {
            for event in rx {
                if event.thread_id.is_some()
                    && matches!(
                        event.kind.as_str(),
                        "session_created"
                            | "user_message"
                            | "session_update"
                            | "session_usage"
                            | "session_ready"
                            | "model_changed"
                            | "configuration_changed"
                            | "turn_started"
                            | "turn_finished"
                            | "session_error"
                            | "session_closed"
                            | "session_deleted"
                            | "permission"
                            | "session_auth_required"
                            | "session_auth_error"
                            | "session_authenticated"
                    )
                {
                    saved.lock().unwrap().push(event.clone());
                    if !matches!(
                        event.kind.as_str(),
                        "permission"
                            | "session_auth_required"
                            | "session_auth_error"
                            | "session_authenticated"
                    ) {
                        if let Some(file) = journal.as_mut() {
                            let _ = serde_json::to_writer(&mut *file, &event);
                            let _ = writeln!(file);
                        }
                    }
                }
                if super::emit(event).is_err() {
                    break;
                }
            }
        });
        let mut agents = acp::registry(&root).unwrap_or_else(|error| {
            eprintln!("Agent config: {error}");
            vec![]
        });
        let settings_path = std::env::var_os("PERO_SETTINGS_PATH").map(PathBuf::from);
        if let Some(selected) = settings_path.as_deref().and_then(pero_runtime::settings::load_chat_agent) {
            if let Some(index) = agents.iter().position(|agent| agent.id == selected && agent.available()) {
                let preferred = agents.remove(index);
                agents.insert(0, preferred);
            }
        }
        Self {
            workspace: root,
            agents,
            sessions: HashMap::new(),
            tx,
            history,
            app_bindings,
            app_use: acp::AppUseEndpoint::from_environment(),
            settings_path,
        }
    }
    fn visible_history(&self) -> Vec<HostEvent> {
        HostEvent::without_deleted_threads(&self.history.lock().unwrap())
    }
    fn send(&self, kind: &str, text: impl Into<String>, data: serde_json::Value) {
        let mut event = HostEvent::new(kind, None, text.into());
        event.data = data;
        let _ = self.tx.send(event);
    }
    fn publish_workspace(&self) {
        self.send(
            "workspace",
            self.workspace.to_string_lossy(),
            serde_json::json!(workspace_identity(&self.workspace)),
        );
        self.publish_roadmap();
    }
    fn publish_roadmap(&self) {
        self.send(
            "local_roadmap",
            "",
            serde_json::json!(pero_runtime::roadmap::load(&self.workspace)),
        );
    }
    pub fn dispatch(&mut self, value: serde_json::Value) {
        let command = match serde_json::from_value::<HostCommand>(value) {
            Ok(c) => c,
            Err(_) => {
                self.send("error", "Invalid session request", serde_json::Value::Null);
                return;
            }
        };
        self.command(command);
    }

    fn command(&mut self, command: HostCommand) {
        match command {
            HostCommand::LoadRoadmap => self.publish_roadmap(),
            HostCommand::ListAgents => {
                self.send(
                    "agents",
                    self.workspace.to_string_lossy(),
                    serde_json::json!(self.agents.iter().map(|a| a.public()).collect::<Vec<_>>()),
                );
                self.publish_workspace();
                let events = self.visible_history();
                let active: Vec<_> = self
                    .sessions
                    .iter()
                    .filter(|(_, session)| !session.tx.is_closed())
                    .map(|(id, _)| id.clone())
                    .collect();
                self.send(
                    "replay",
                    "",
                    serde_json::json!({"events":events,"active":active}),
                );
            }
            HostCommand::Workspace { path } => match std::fs::canonicalize(path) {
                Ok(path) if path.is_dir() => {
                    self.workspace = path;
                    self.publish_workspace();
                }
                _ => self.send("error", "Workspace is unavailable", serde_json::Value::Null),
            },
            HostCommand::AttachFiles { paths } => {
                let mut files = vec![];
                let mut total = 0;
                for path in paths.into_iter().take(8) {
                    let Ok(path) = std::fs::canonicalize(path) else {
                        continue;
                    };
                    if !std::fs::metadata(&path).is_ok_and(|m| m.is_file() && m.len() <= 128000) {
                        continue;
                    }
                    if let Ok(text) = std::fs::read_to_string(&path) {
                        total += text.chars().count();
                        if total > 32000 || text.contains('\0') {
                            continue;
                        }
                        files.push(serde_json::json!({"path":path,"name":path.file_name().unwrap_or_default().to_string_lossy(),"text":text}));
                    }
                }
                if files.is_empty() {
                    self.send(
                        "error",
                        "Choose text files up to 32,000 characters in total",
                        serde_json::Value::Null,
                    );
                } else {
                    self.send("context_files", "", serde_json::json!(files));
                }
            }
            HostCommand::SearchContext {
                request_id,
                kind,
                query,
            } => {
                let history = if kind == ContextKind::Thread {
                    self.visible_history()
                } else {
                    vec![]
                };
                let sources = ContextSources {
                    workspace: &self.workspace,
                    history: &history,
                    home: std::env::var_os("HOME").map(PathBuf::from),
                };
                let result = sources.search(kind, &query);
                let event = match result {
                    Ok(items) => {
                        let mut event =
                            HostEvent::new("context_candidates", Some(request_id), String::new());
                        event.data = serde_json::json!(items);
                        event
                    }
                    Err(error) => HostEvent::new("context_error", Some(request_id), error),
                };
                let _ = self.tx.send(event);
            }
            HostCommand::ResolveContext {
                request_id,
                kind,
                source,
                start_line,
                end_line,
            } => {
                let history = if kind == ContextKind::Thread {
                    self.visible_history()
                } else {
                    vec![]
                };
                let sources = ContextSources {
                    workspace: &self.workspace,
                    history: &history,
                    home: std::env::var_os("HOME").map(PathBuf::from),
                };
                let event = match sources.resolve(kind, &source, start_line, end_line) {
                    Ok(reference) => {
                        let mut event =
                            HostEvent::new("context_resolved", Some(request_id), String::new());
                        event.data = serde_json::json!(reference);
                        event
                    }
                    Err(error) => HostEvent::new("context_error", Some(request_id), error),
                };
                let _ = self.tx.send(event);
            }
            HostCommand::NewSession {
                thread_id,
                agent_id,
                scope,
            } => {
                if let Err(error) = self.create_session(thread_id.clone(), &agent_id, None, scope) {
                    let mut event = HostEvent::new("session_error", None, error);
                    event.thread_id = Some(thread_id);
                    let _ = self.tx.send(event);
                }
            }
            HostCommand::Permission {
                thread_id,
                request_id,
                option_id,
            } => {
                if let Some(session) = self.sessions.get(&thread_id) {
                    if let Some(reply) = session.permissions.lock().unwrap().remove(&request_id) {
                        let _ = reply.send(option_id);
                    }
                }
            }
            HostCommand::Delete { thread_id } => {
                if thread_id.is_empty() || thread_id.len() > 128 {
                    self.send("error", "Invalid session request", serde_json::Value::Null);
                    return;
                }
                if let Some(session) = self.sessions.remove(&thread_id) {
                    session.permissions.lock().unwrap().clear();
                    let _ = session.tx.send(SessionCommand::Close);
                }
                let mut event = HostEvent::new("session_deleted", None, String::new());
                event.thread_id = Some(thread_id);
                let _ = self.tx.send(event);
            }
            command => {
                let (thread_id, command) = match command {
                    HostCommand::Prompt {
                        thread_id,
                        text,
                        contexts,
                    } if (!text.trim().is_empty() || !contexts.is_empty())
                        && text.chars().count() <= 64000 =>
                    {
                        if let Err(error) = ContextReference::validate_all(&contexts) {
                            let mut event = HostEvent::new("session_error", None, error.into());
                            event.thread_id = Some(thread_id);
                            let _ = self.tx.send(event);
                            return;
                        }
                        (
                            thread_id,
                            if contexts.is_empty() {
                                SessionCommand::Prompt(text)
                            } else {
                                SessionCommand::PromptWithContext {
                                    text,
                                    context: contexts,
                                }
                            },
                        )
                    }
                    HostCommand::Cancel { thread_id } => (thread_id, SessionCommand::Cancel),
                    HostCommand::Model {
                        thread_id,
                        model_id,
                    } => (thread_id, SessionCommand::Model(model_id)),
                    HostCommand::Configure {
                        thread_id,
                        config_id,
                        value,
                    } => (
                        thread_id,
                        SessionCommand::Configure {
                            id: config_id,
                            value,
                        },
                    ),
                    HostCommand::Authenticate {
                        thread_id,
                        method_id,
                    } => (thread_id, SessionCommand::Authenticate(method_id)),
                    HostCommand::Close { thread_id } => {
                        if let Some(session) = self.sessions.remove(&thread_id) {
                            session.permissions.lock().unwrap().clear();
                            let _ = session.tx.send(SessionCommand::Close);
                        }
                        return;
                    }
                    _ => {
                        self.send(
                            "error",
                            "Message is empty or too long",
                            serde_json::Value::Null,
                        );
                        return;
                    }
                };
                if let Some(session) = self.sessions.get(&thread_id) {
                    if let SessionCommand::Prompt(text) = &command {
                        let mut e = HostEvent::new("user_message", None, text.clone());
                        e.thread_id = Some(thread_id.clone());
                        let _ = self.tx.send(e);
                    }
                    if let SessionCommand::PromptWithContext { text, context } = &command {
                        let mut event = HostEvent::new("user_message", None, text.clone());
                        event.thread_id = Some(thread_id.clone());
                        event.data = serde_json::json!({"contexts":context});
                        let _ = self.tx.send(event);
                    }
                    if matches!(command, SessionCommand::Cancel) {
                        session.permissions.lock().unwrap().clear();
                    }
                    if session.tx.send(command).is_ok() {
                        return;
                    }
                }
                let mut event = HostEvent::new(
                    "session_error",
                    None,
                    "Session is unavailable; start a new session".into(),
                );
                event.thread_id = Some(thread_id);
                let _ = self.tx.send(event);
            }
        }
    }
}
impl Drop for Manager {
    fn drop(&mut self) {
        for session in self.sessions.values() {
            session.permissions.lock().unwrap().clear();
            let _ = session.tx.send(SessionCommand::Close);
        }
    }
}

fn workspace_identity(workspace: &std::path::Path) -> pero_contracts::workbench::WorkspaceIdentity {
    use pero_contracts::workbench::{RepositoryIdentity, WorkspaceIdentity};
    let repository = std::process::Command::new("git")
        .current_dir(workspace)
        .args(["config", "--local", "--get", "remote.origin.url"])
        .output()
        .ok()
        .filter(|output| output.status.success())
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .and_then(|remote| RepositoryIdentity::from_git_remote(&remote));
    WorkspaceIdentity { repository }
}

#[cfg(test)]
mod workspace_tests {
    use super::*;
    #[test]
    fn workspace_metadata_observes_the_actual_checkout_origin() {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let workspace = std::env::temp_dir().join(format!(
            "pero-project-origin-{}-{nonce}",
            std::process::id()
        ));
        std::fs::create_dir(&workspace).unwrap();
        assert!(workspace_identity(&workspace).repository.is_none());
        for args in [
            vec!["init", "--quiet"],
            vec![
                "config",
                "remote.origin.url",
                "git@github.com:Phodal/Pero.git",
            ],
        ] {
            assert!(
                std::process::Command::new("git")
                    .current_dir(&workspace)
                    .args(args)
                    .status()
                    .unwrap()
                    .success()
            );
        }
        let identity = workspace_identity(&workspace).repository.unwrap();
        assert_eq!(
            (&*identity.host, &*identity.owner, &*identity.name),
            ("github.com", "phodal", "pero")
        );
        std::fs::remove_dir_all(workspace).unwrap();
    }
}
