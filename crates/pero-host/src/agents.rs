use pero_contracts::{
    context::{ContextKind, ContextReference},
    HostCommand, HostEvent,
};
use pero_runtime::acp::{self, AgentConfig, SessionCommand, SessionHandle};
use pero_runtime::apps::agent::AppSessionBinding;
use pero_runtime::context::ContextSources;
#[path = "app_agent.rs"]
mod app_agent;
#[path = "app_agent_run.rs"]
mod app_agent_run;
#[path = "paper_research.rs"]
mod paper_research;
#[path = "automation_agent.rs"]
pub mod automation_agent;
#[path = "mcp_settings.rs"]
mod mcp_settings;
#[path = "mcp_session.rs"]
mod mcp_session;
use std::{
    collections::HashMap,
    io::{BufRead, Write},
    path::PathBuf,
    sync::{
        mpsc::{self, Sender},
        Arc, Mutex,
    },
};

pub struct Manager {
    workspace: PathBuf,
    agents: Vec<AgentConfig>,
    sessions: HashMap<String, SessionHandle>,
    tx: Sender<HostEvent>,
    history: Arc<Mutex<pero_contracts::session_history::SessionHistory>>,
    app_bindings: HashMap<String, AppSessionBinding>,
    run_journal: app_agent_run::Journal,
    paper_worker: paper_research::io::ResearchWorker,
    app_use: Option<acp::AppUseEndpoint>,
    pub(crate) apps: Option<crate::apps::Apps>,
    app_plugins: HashMap<String, pero_runtime::apps::AppSessionPlugins>,
    connectors: Option<acp::ConnectorsEndpoint>,
    settings_path: Option<PathBuf>,
    history_path: PathBuf,
    automation_threads: std::collections::HashSet<String>,
    automation_tx: mpsc::SyncSender<automation_agent::AutomationReceipt>,
    automation_rx: Option<mpsc::Receiver<automation_agent::AutomationReceipt>>,
}
impl Manager {
    pub(crate) fn workspace(&self) -> &std::path::Path {
        &self.workspace
    }

    /// A delivery uses the original conversation workspace, including after restart.
    pub(crate) fn artifact_workspace(&self, thread_id: &str) -> Option<PathBuf> {
        self.history.lock().unwrap().events().iter().rev().find_map(|event| {
            if event.kind != "session_created" || event.thread_id.as_deref() != Some(thread_id) { return None; }
            event.data.get("workspace").and_then(serde_json::Value::as_str).map(PathBuf::from)
                .filter(|path| path.is_absolute())
        })
    }
    pub fn new(root: PathBuf) -> Self {
        let history_file = std::env::var_os("PERO_HISTORY_PATH")
            .map(PathBuf::from)
            .unwrap_or_else(|| root.join("target/sessions.jsonl"));
        let mut stored = pero_contracts::session_history::SessionHistory::default();
        if let Ok(file) = std::fs::File::open(&history_file) {
            for line in std::io::BufReader::new(file).split(b'\n').map_while(Result::ok) {
                if let Ok(event) = serde_json::from_slice::<HostEvent>(&line) { stored.record(event); }
            }
        }
        let app_bindings = stored
            .events()
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
        let run_journal=app_agent_run::Journal::default();
        run_journal.restore(&app_bindings);
        let run_writer=run_journal.clone();
        let history = Arc::new(Mutex::new(stored));
        let saved = history.clone();
        if let Some(parent) = history_file.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let history_path = history_file.clone();
        let mut journal = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(history_file)
            .ok();
        let (tx, rx) = mpsc::channel::<HostEvent>();
        std::thread::spawn(move || {
            for mut event in rx {
                run_writer.stamp(&mut event);
                let ack_id=event.request_id.clone();
                let mut persistence=None;
                if event.thread_id.is_some()
                    && matches!(
                        event.kind.as_str(),
                        "app_agent_attempt"
                            | "app_agent_cancel"
                            | "session_created"
                            | "user_message"
                            | "session_update"
                            | "session_usage"
                            | "session_ready"
                            | "model_changed"
                            | "configuration_changed"
                            | "turn_started"
                            | "turn_finished"
                            | "workspace_changes"
                            | "session_error"
                            | "session_closed"
                            | "session_deleted"
                            | "permission"
                            | "user_questions"
                            | "user_questions_resolved"
                            | "user_questions_error"
                            | "session_auth_required"
                            | "session_auth_error"
                            | "session_authenticated"
                    )
                {
                    saved.lock().unwrap().record(event.clone());
                    let mut persisted=Err("Session journal is unavailable".to_string());
                    if !matches!(
                        event.kind.as_str(),
                        "permission"
                            | "user_questions"
                            | "user_questions_resolved"
                            | "user_questions_error"
                            | "session_auth_required"
                            | "session_auth_error"
                            | "session_authenticated"
                    ) {
                        if let Some(file) = journal.as_mut() {
                            persisted=serde_json::to_writer(&mut *file, &event).map_err(|e|e.to_string()).and_then(|_|writeln!(file).map_err(|e|e.to_string()));
                        }
                    }
                    persistence=Some(persisted);
                }
                if super::emit(event).is_err() {
                    break;
                }
                if let Some(result)=persistence {run_writer.recorded(ack_id.as_deref(),result);}
            }
        });
        let mut agents = acp::registry(&root).unwrap_or_else(|error| {
            eprintln!("Agent config: {error}");
            vec![]
        });
        let settings_path = std::env::var_os("PERO_SETTINGS_PATH").map(PathBuf::from);
        if let Some(selected) = settings_path
            .as_deref()
            .and_then(pero_runtime::settings::load_chat_agent)
        {
            if let Some(index) = agents
                .iter()
                .position(|agent| agent.id == selected && agent.available())
            {
                let preferred = agents.remove(index);
                agents.insert(0, preferred);
            }
        }
        let (automation_tx, automation_rx) = mpsc::sync_channel(64);
        Self {
            automation_threads: Default::default(), automation_tx, automation_rx: Some(automation_rx),
            workspace: root,
            agents,
            sessions: HashMap::new(),
            tx,
            history,
            app_bindings,
            run_journal,
            paper_worker: Default::default(),
            app_use: acp::AppUseEndpoint::from_environment(),
            apps: None,
            app_plugins: HashMap::new(),
            connectors: acp::ConnectorsEndpoint::from_environment(),
            settings_path,
            history_path,
        }
    }
    pub fn configure_harness(
        &mut self,
        settings: &pero_contracts::harness_settings::HarnessSettings,
        api_key: String,
    ) {
        if let Some(agent) = self.agents.iter_mut().find(|agent| agent.id == "pero") {
            for (flag, value) in [
                ("--endpoint", &settings.endpoint),
                ("--model", &settings.model),
            ] {
                if let Some(index) = agent.args.iter().position(|arg| arg == flag) {
                    if let Some(argument) = agent.args.get_mut(index + 1) {
                        *argument = value.clone();
                    }
                }
            }
            agent.env.insert("DEEPSEEK_API_KEY".into(), api_key);
        }
    }
    fn visible_history(&self) -> Vec<HostEvent> {
        self.history.lock().unwrap().events().to_vec()
    }
    pub fn insights_value(&self, thread_id: &str) -> Result<serde_json::Value, String> {
        if !super::insights::session_id_ok(thread_id) {
            return Err("Invalid session request".into());
        }
        let report = super::insights::analyze_history(
            &self.visible_history(),
            thread_id,
            &self.history_path,
            super::insights::now_ms(),
            32,
        )
        .map_err(|error| error.to_string())?;
        let mut value = report.to_json();
        value["threadId"] = serde_json::json!(thread_id);
        Ok(value)
    }

    pub fn insights_catalog(&self) -> Vec<serde_json::Value> {
        let mut ids = Vec::new();
        let mut activity = HashMap::new();
        for (index, event) in self.visible_history().into_iter().enumerate() {
            let Some(id) = event.thread_id else { continue };
            if super::insights::session_id_ok(&id) && !ids.contains(&id) {
                ids.push(id.clone());
            }
            if matches!(event.kind.as_str(), "user_message" | "turn_finished" | "session_error")
                || (event.kind == "session_update" && matches!(event.data["sessionUpdate"].as_str(),
                    Some("user_message_chunk" | "agent_message_chunk" | "tool_call" | "tool_call_update"))) {
                activity.insert(id, index);
            }
        }
        // Oldest activity first; consumers can take the tail or reverse for recovery.
        ids.sort_by_key(|id| activity.get(id).copied());
        ids.into_iter()
            .filter_map(|id| {
                let mut value = self.insights_value(&id).ok()?;
                if let Some(binding) = self.app_bindings.get(&id).filter(|binding| binding.run.is_none()) {
                    value["app"] = serde_json::json!(binding.app.as_str());
                }
                Some(value)
            })
            .filter(|value| {
                value
                    .get("turn_count")
                    .and_then(|count| count.as_u64())
                    .unwrap_or(0)
                    > 0
            })
            .collect()
    }

    pub fn repository_snapshot(&self) -> (Vec<serde_json::Value>, Vec<serde_json::Value>) {
        let repositories = super::local_repo::read_directories(&[self.workspace.clone()]);
        let conflicts = super::local_repo::conflicts(&repositories, &self.visible_history());
        (repositories, conflicts)
    }

    fn publish_insights(&self, thread_id: String) {
        match self.insights_value(&thread_id) {
            Ok(value) => {
                let mut event = HostEvent::new("insights", None, String::new());
                event.thread_id = Some(thread_id);
                event.data = value;
                let _ = self.tx.send(event);
            }
            Err(error) => {
                let mut event = HostEvent::new("error", None, error);
                event.thread_id = Some(thread_id);
                event.message_key = Some("insights.failed".into());
                let _ = self.tx.send(event);
            }
        }
    }
    pub fn has_thread(&self, thread: &str) -> bool {
        self.sessions.contains_key(thread)
            || self
                .visible_history()
                .iter()
                .any(|event| event.thread_id.as_deref() == Some(thread))
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
                let _ = self
                    .tx
                    .send(HostEvent::message("error", None, "error.invalid_session"));
                return;
            }
        };
        self.command(command);
    }

    fn command(&mut self, command: HostCommand) {
        if self.automation_owns_command(&command) {
            self.send("error", "Automation executions are controlled through Automation", serde_json::Value::Null);
            return;
        }
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
                // Readiness is historical; reconnecting renderers need the live
                // session owner's current observations after replay completes.
                for session in self.sessions.values().filter(|session| !session.tx.is_closed()) {
                    let snapshot = session.mcp_runtime.lock().unwrap();
                    let mut event = HostEvent::new("mcp_runtime", None, String::new());
                    event.thread_id = Some(snapshot.thread_id.clone());
                    event.data = serde_json::json!(&*snapshot);
                    let _ = self.tx.send(event);
                }
            }
            HostCommand::Workspace { path } => match dunce::canonicalize(path) {
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
                let result = sources.search(kind, &query).and_then(|mut items| {
                    if kind == ContextKind::Skill {
                        if let Some(apps) = &self.apps {
                            let mut installed = apps.market_context_candidates(&query)?;
                            installed.append(&mut items);
                            installed.truncate(pero_runtime::context::MAX_RESULTS);
                            return Ok(installed);
                        }
                    }
                    Ok(items)
                });
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
                let resolved = if kind == ContextKind::Skill && source.starts_with(pero_runtime::skill_market::CONTEXT_SOURCE_PREFIX) {
                    self.apps.as_ref().ok_or_else(|| "Skills market is unavailable".to_string())
                        .and_then(|apps| apps.resolve_market_context(&source))
                } else { sources.resolve(kind, &source, start_line, end_line) };
                let event = match resolved {
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
                    let mut event = if error == crate::apps::APP_PREPARING {
                        HostEvent::message("session_preparing", None, "chat.preparing_app")
                    } else if error == acp::CREDENTIAL_REQUIRED {
                        HostEvent::message("session_error", None, acp::CREDENTIAL_REQUIRED)
                    } else if let Some(key) = error.strip_prefix("engram.") {
                        let mut event = HostEvent::message("session_error", None, &format!("engram.{key}"));
                        event.thread_id = Some(thread_id);
                        let _ = self.tx.send(event);
                        return;
                    } else {
                        HostEvent::new("session_error", None, error)
                    };
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
            HostCommand::AnswerUserQuestions {thread_id,request_id,reply} => {
                let result = self.sessions.get(&thread_id).ok_or("Session is unavailable".to_owned())
                    .and_then(|session|session.user_questions.finish(&request_id,reply));
                if let Err(error)=result {
                    let mut event=HostEvent::new("user_questions_error",None,error.clone());
                    event.thread_id=Some(thread_id);
                    event.data=serde_json::json!({"request_id":request_id,"error":error});
                    let _=self.tx.send(event);
                }
            }
            HostCommand::Insights { thread_id } => self.publish_insights(thread_id),
            HostCommand::Delete { thread_id } => {
                self.app_plugins.remove(&thread_id);
                if thread_id.is_empty() || thread_id.len() > 128 {
                    let _ = self
                        .tx
                        .send(HostEvent::message("error", None, "error.invalid_session"));
                    return;
                }
                if let Some(session) = self.sessions.remove(&thread_id) {
                    session.user_questions.clear();
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
                        && pero_contracts::context::validate_prompt_text(&text).is_ok() =>
                    {
                        let snapshot = self.mcp_session_snapshot(&thread_id);
                        let admission = ContextReference::validate_all(&contexts).and_then(|_| {
                            contexts.iter().try_for_each(|reference|
                                pero_contracts::mcp_resource::admit_context(reference, snapshot.as_ref()))
                        });
                        if let Err(error) = admission {
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
                        self.app_plugins.remove(&thread_id);
                        if let Some(session) = self.sessions.remove(&thread_id) {
                            session.user_questions.clear();
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
                        session.user_questions.clear();
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
            session.user_questions.clear();
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
            assert!(std::process::Command::new("git")
                .current_dir(&workspace)
                .args(args)
                .status()
                .unwrap()
                .success());
        }
        let identity = workspace_identity(&workspace).repository.unwrap();
        assert_eq!(
            (&*identity.host, &*identity.owner, &*identity.name),
            ("github.com", "phodal", "pero")
        );
        std::fs::remove_dir_all(workspace).unwrap();
    }
}
