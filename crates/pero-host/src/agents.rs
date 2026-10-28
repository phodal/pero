use pero_contracts::{HostCommand, HostEvent};
use pero_runtime::acp::{self, AgentConfig, SessionCommand, SessionHandle};
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
                            | "session_ready"
                            | "model_changed"
                            | "configuration_changed"
                            | "turn_finished"
                            | "session_error"
                            | "session_closed"
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
        let agents = acp::registry(&root).unwrap_or_else(|error| {
            eprintln!("Agent config: {error}");
            vec![]
        });
        Self {
            workspace: root,
            agents,
            sessions: HashMap::new(),
            tx,
            history,
        }
    }
    fn send(&self, kind: &str, text: impl Into<String>, data: serde_json::Value) {
        let mut event = HostEvent::new(kind, None, text.into());
        event.data = data;
        let _ = self.tx.send(event);
    }
    pub fn workspace(&self) -> PathBuf {
        self.workspace.clone()
    }

    pub fn dispatch(&mut self, value: serde_json::Value) {
        let command = match serde_json::from_value::<HostCommand>(value) {
            Ok(c) => c,
            Err(_) => {
                self.send("error", "Invalid session request", serde_json::Value::Null);
                return;
            }
        };
        match command {
            HostCommand::ListAgents => {
                self.send(
                    "agents",
                    self.workspace.to_string_lossy(),
                    serde_json::json!(self.agents.iter().map(|a| a.public()).collect::<Vec<_>>()),
                );
                self.send("replay","",serde_json::json!({"events":*self.history.lock().unwrap(),"active":self.sessions.iter().filter(|(_,s)|!s.tx.is_closed()).map(|(id,_)|id).collect::<Vec<_>>() }));
            }
            HostCommand::Workspace { path } => match std::fs::canonicalize(path) {
                Ok(path) if path.is_dir() => {
                    self.workspace = path;
                    self.send(
                        "workspace",
                        self.workspace.to_string_lossy(),
                        serde_json::Value::Null,
                    );
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
            HostCommand::NewSession {
                thread_id,
                agent_id,
            } => {
                self.sessions.retain(|_, session| !session.tx.is_closed());
                if thread_id.is_empty()
                    || thread_id.len() > 128
                    || self.sessions.len() >= 16
                    || self.sessions.contains_key(&thread_id)
                {
                    let mut e = HostEvent::new(
                        "session_error",
                        None,
                        "Session exists or limit reached".into(),
                    );
                    e.thread_id = Some(thread_id);
                    let _ = self.tx.send(e);
                    return;
                }
                if let Some(agent) = self
                    .agents
                    .iter()
                    .find(|a| a.id == agent_id && a.available())
                {
                    let mut event = HostEvent::new("session_created", None, String::new());
                    event.thread_id = Some(thread_id.clone());
                    event.data = serde_json::json!({"agent":agent.id,"workspace":self.workspace});
                    let _ = self.tx.send(event);
                    self.sessions.insert(
                        thread_id.clone(),
                        acp::start(
                            agent.clone(),
                            self.workspace.clone(),
                            thread_id,
                            self.tx.clone(),
                        ),
                    );
                } else {
                    let mut e =
                        HostEvent::new("session_error", None, "Agent is not installed".into());
                    e.thread_id = Some(thread_id);
                    let _ = self.tx.send(e);
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
            command => {
                let (thread_id, command) = match command {
                    HostCommand::Prompt { thread_id, text }
                        if !text.trim().is_empty() && text.chars().count() <= 64000 =>
                    {
                        (thread_id, SessionCommand::Prompt(text))
                    }
                    HostCommand::Cancel { thread_id } => (thread_id, SessionCommand::Cancel),
                    HostCommand::Model {
                        thread_id,
                        model_id,
                    } => (thread_id, SessionCommand::Model(model_id)),
                    HostCommand::Configure { thread_id, config_id, value } =>
                        (thread_id, SessionCommand::Configure { id: config_id, value }),
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
