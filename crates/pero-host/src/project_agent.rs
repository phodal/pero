//! Project membership joins existing ACP conversations, history and permissions.
use super::Manager;
use pero_contracts::{
    project_agent::prompt::{ProjectAgentPrompt, ProjectAgentRole, ProjectPromptAgent},
    project_agent::{request_key, ProjectAgentAction, ProjectAgentRequest, ProjectAgentSession, ProjectAgentSnapshot, ProjectSessionBinding, ProjectAgentEvidence, ProjectAgentEvidenceUpdate, ProjectDelegationPolicy},
    research_project::ResearchProject,
    HostCommand, HostEvent,
};
use pero_runtime::{acp, apps::agent_run::{Binding, Run, Scope}};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{collections::HashMap, path::{Path, PathBuf}};

pub(crate) struct Launch {
    pub binding: ProjectSessionBinding,
    pub workspace: PathBuf,
    pub agent_prompt: ProjectAgentPrompt,
    pub server: Option<acp::sdk::schema::v1::McpServer>,
    pub origin: LaunchOrigin,
    pub initial_settings: Vec<pero_contracts::session_settings::SettingSelection>,
}

pub(crate) enum LaunchOrigin {
    Record(Option<String>),
    Retain,
}

enum ProjectResume {
    Load,
    RetryUnacknowledgedPrimary,
}

struct ProjectConversationHistory {
    binding: ProjectSessionBinding,
    agent_id: String,
    workspace: String,
    events: Vec<HostEvent>,
}

fn digest(value: &str) -> String { format!("{:x}", Sha256::digest(value.as_bytes()))[..24].into() }
fn prompt_valid(text: &str) -> Result<(), String> {
    if text.trim().is_empty() {return Err("Enter instructions for the Agent".into());}
    pero_contracts::context::validate_prompt_text(text).map_err(str::to_owned)
}

impl Manager {
    pub(crate) fn dispatch_project_agent(&mut self, value: Value) {
        let id = value["request_id"].as_str().map(str::to_owned);
        let result = serde_json::from_value::<ProjectAgentRequest>(value).map_err(|error| error.to_string())
            .and_then(|request| {
                if request.method != "project_agent" {return Err("Invalid Project request".into());}
                self.project_agent_request(&request.request_id, request.command)
            });
        let mut event = HostEvent::new("project_agent", id, String::new());
        match result {
            Ok(snapshot) => event.data = json!(snapshot),
            Err(error) => {event.kind = "project_agent_error".into(); event.text = error;}
        }
        let _ = self.tx.send(event);
    }

    pub(crate) fn poll_project_tools(&mut self) {
        let calls = self.project_tools.as_ref().map(|tools| tools.drain()).unwrap_or_default();
        for call in calls {
            let result = (|| {
                let primary = self.project_session(&call.thread_id)?;
                if primary.binding.parent_thread.is_some() {return Err("Only the Project's primary Agent can delegate work".into());}
                if let Some(target) = call.action.target() {
                    let child = self.project_session(target)?;
                    if !primary.binding.owns_child(&call.thread_id, &child.binding) {
                        return Err("This conversation is not a child of the calling Project Agent".into());
                    }
                }
                let command = call.action.command(&call.thread_id, &primary.agent_id)
                    .unwrap_or(ProjectAgentAction::Snapshot {project_id: primary.binding.project_id});
                let snapshot = self.project_agent_request(&call.request_id, command)?;
                let evidence = snapshot.child_evidence();
                Ok(json!({"project_id":snapshot.project_id,"selected_thread":snapshot.selected_thread,"sessions":evidence.sessions,"omitted_sessions":evidence.omitted_sessions}))
            })();
            let _ = call.reply.send(result);
        }
    }

    pub(super) fn saved_project(&self, id: &str) -> Result<ResearchProject, String> {
        request_key(id)?;
        let settings = self.settings_path.as_deref().ok_or("Projects need a persistent Host profile")?;
        pero_runtime::settings::load_research_projects(settings).map_err(|error| error.to_string())?
            .research_projects.into_iter().find(|project| project.id == id).ok_or("The saved Project is unavailable".into())
    }

    fn project_sessions(&self, project: &str) -> Vec<ProjectAgentSession> {
        let history = self.history.lock().unwrap();
        let mut created = HashMap::new();
        let mut order = Vec::new();
        for event in history.events() {
            if event.kind != "session_created" {continue;}
            let Some(thread) = event.thread_id.as_deref() else {continue};
            let Some(raw) = event.data.get("projectAgent") else {continue};
            let Ok(binding) = serde_json::from_value::<ProjectSessionBinding>(raw.clone()) else {continue};
            if binding.validate().is_err() || binding.project_id != project {continue;}
            if !created.contains_key(thread) {order.push(thread.to_owned());}
            created.insert(thread.to_owned(), ProjectConversationHistory {
                binding,
                agent_id: event.data["agent"].as_str().unwrap_or_default().into(),
                workspace: event.data["workspace"].as_str().unwrap_or_default().into(),
                events: Vec::new(),
            });
        }
        if created.is_empty() { return Vec::new(); }
        // Find the origins first to preserve any earlier events on the same threads.
        for event in history.events() {
            if let Some(conversation) = event.thread_id.as_deref().and_then(|thread| created.get_mut(thread)) {
                conversation.events.push(event.clone());
            }
        }
        drop(history);
        order.into_iter().filter_map(|thread| {
            let ProjectConversationHistory { binding, agent_id, workspace, events } = created.remove(&thread)?;
            let active = self.sessions.get(&thread).is_some_and(|session| !session.tx.is_closed());
            let run_binding = Binding {
                scope: Scope {workspace_id: project.into()}, request_id: thread.clone(),
                harness_id: agent_id,
                panel: String::new(), runtime_digest: String::new(), app_revision: None,
                created_at: String::new(), context: None,
            };
            let run = Run::project(&thread, &run_binding, &events, active);
            let mut result = String::new();
            let mut evidence = Vec::new();
            let mut submitted = false;
            for event in &events {
                if event.kind == "user_message" {submitted = true;}
                if event.kind == "turn_started" {result.clear(); evidence.clear();}
                if event.kind == "session_update" && event.data["sessionUpdate"] == "agent_message_chunk" {
                    if let Some(text) = event.data["content"]["text"].as_str() {result.push_str(text);}
                }
                if event.kind == "session_update" && matches!(event.data["sessionUpdate"].as_str(), Some("tool_call" | "tool_call_update")) {
                    let output = event.data["content"].as_array().map(|items| items.iter().filter_map(|item| {
                        item["content"]["text"].as_str().or_else(|| item["text"].as_str())
                    }).collect::<Vec<_>>().join("\n")).filter(|text| !text.is_empty())
                        .or_else(|| event.data.get("rawOutput").filter(|value| !value.is_null()).map(|value| {
                            value.as_str().map(str::to_owned).unwrap_or_else(|| value.to_string())
                        }));
                    ProjectAgentEvidence::observe(&mut evidence, ProjectAgentEvidenceUpdate {
                        tool_call_id: event.data["toolCallId"].as_str().unwrap_or_default().into(),
                        title: event.data["title"].as_str().map(str::to_owned),
                        status: event.data["status"].as_str().map(str::to_owned), output,
                    });
                }
            }
            if result.chars().count() > 12_000 {
                result = result.chars().take(12_000).collect();
                result.push_str("\n[Excerpt truncated. Open the original conversation for the complete evidence.]");
            }
            Some(ProjectAgentSession {
                thread_id: thread, binding, agent_id: run_binding.harness_id, workspace, active,
                status: if !submitted && active {"ready".into()} else {run.status},
                result, error: run.error, evidence,
            })
        }).collect()
    }

    fn project_session(&self, thread: &str) -> Result<ProjectAgentSession, String> {
        request_key(thread)?;
        let history = self.visible_history();
        let project = history.iter().rev().filter(|event| event.kind == "session_created" && event.thread_id.as_deref() == Some(thread))
            .find_map(|event| event.data["projectAgent"]["project_id"].as_str()).ok_or("Project conversation is unavailable")?;
        self.project_sessions(project).into_iter().find(|session| session.thread_id == thread)
            .ok_or("Project conversation is unavailable".into())
    }

    pub(super) fn project_home(&self, project: &str) -> Result<PathBuf, String> {
        Ok(self.settings_path.as_deref().and_then(Path::parent)
            .ok_or("Project Agent needs a persistent Host profile")?.join("project-agents").join(digest(project)))
    }

    fn project_agent_available(&self, id: &str) -> Result<(), String> {
        let agent = self.agents.iter().find(|agent| agent.id == id && agent.available()).ok_or("Agent is not installed")?;
        if agent.provider_credential_missing(|name| std::env::var(name).unwrap_or_default()) {return Err(acp::CREDENTIAL_REQUIRED.into());}
        let configuration = self.load_mcp_configuration(agent).map_err(|_| "MCP settings are unavailable or invalid")?;
        configuration.validate(&agent.mcp_server_names()).map_err(|_| "MCP settings are unavailable or invalid")?;
        Ok(())
    }

    fn project_workspace(&self, project: &ResearchProject, thread: &str, child: bool) -> Result<PathBuf, String> {
        if !child {
            if let Some(source) = &project.workspace {
                return dunce::canonicalize(source).map_err(|error| format!("Project workspace unavailable: {error}"));
            }
        }
        let workspace = self.project_home(&project.id)?.join(thread);
        if workspace.exists() {return Err(format!("Inspect the retained workspace before retrying: {}", workspace.display()));}
        std::fs::create_dir_all(workspace.parent().unwrap()).map_err(|error| error.to_string())?;
        if child {
            if let Some(source) = &project.workspace {
                let output = std::process::Command::new("git").args(["-C", source, "rev-parse", "--show-toplevel"]).output().map_err(|error| error.to_string())?;
                if output.status.success() {
                    let source = String::from_utf8(output.stdout).map_err(|error| error.to_string())?;
                    let output = std::process::Command::new("git").arg("-C").arg(source.trim())
                        .args(["worktree", "add", "--detach"]).arg(&workspace).arg("HEAD").output().map_err(|error| error.to_string())?;
                    if !output.status.success() {return Err(format!("Cannot create retained child worktree: {}", String::from_utf8_lossy(&output.stderr)));}
                    return dunce::canonicalize(workspace).map_err(|error| error.to_string());
                }
            }
        }
        std::fs::create_dir(&workspace).map_err(|error| error.to_string())?;
        dunce::canonicalize(workspace).map_err(|error| error.to_string())
    }

    fn project_launch(&self, project: &ResearchProject, binding: ProjectSessionBinding, thread: &str, workspace: PathBuf, origin: LaunchOrigin) -> Result<Launch, String> {
        let (role, server) = if binding.parent_thread.is_none() {
            let server = self.project_tools.as_ref().ok_or("Project delegation tools are unavailable")?.server(thread)?;
            let available_agents = self.agents.iter().filter(|agent| agent.available())
                .map(|agent| ProjectPromptAgent { id: agent.id.clone(), name: agent.name.clone() })
                .collect();
            (ProjectAgentRole::Coordinator { available_agents }, Some(server))
        } else {
            (ProjectAgentRole::Child, None)
        };
        let agent_prompt = ProjectAgentPrompt::new(role, project.clone(), workspace.display().to_string());
        Ok(Launch {binding, workspace, agent_prompt, server, origin, initial_settings: vec![]})
    }

    fn resume_project_session(&mut self, session: &ProjectAgentSession, project: &ResearchProject, resume: ProjectResume) -> Result<(), String> {
        if session.active {return Ok(());}
        let (remote, origin) = {
            let history = self.history.lock().unwrap();
            let mut events = history.events().iter().rev()
                .filter(|event| event.thread_id.as_deref() == Some(&session.thread_id));
            let ready = events.clone().find(|event| event.kind == "session_ready");
            const UNACKNOWLEDGED: &str = "Original ACP Session was never acknowledged; inspect its history before creating new work";
            if let Some(event) = ready {
                let id = event.data["sessionId"].as_str().filter(|id| !id.is_empty()).ok_or(UNACKNOWLEDGED)?;
                (Some(id.to_owned()), LaunchOrigin::Record(None))
            } else if matches!(resume, ProjectResume::RetryUnacknowledgedPrimary)
                && session.binding.parent_thread.is_none()
                && !events.any(|event| matches!(event.kind.as_str(), "turn_started" | "turn_finished"))
            {
                (None, LaunchOrigin::Retain)
            } else {
                return Err(UNACKNOWLEDGED.into());
            }
        };
        let workspace = dunce::canonicalize(&session.workspace).map_err(|error| format!("Original workspace is unavailable; no work was replayed: {error}"))?;
        let launch = self.project_launch(project, session.binding.clone(), &session.thread_id, workspace, origin)?;
        self.create_session_with_origin(session.thread_id.clone(), &session.agent_id, None, None, remote, Some(launch))
    }

    pub(super) fn resume_project_prompt(&mut self, thread: &str) -> Result<(), String> {
        let Ok(session) = self.project_session(thread) else { return Ok(()); };
        let project = self.saved_project(&session.binding.project_id)?;
        self.resume_project_session(&session, &project, ProjectResume::Load)
    }

    pub(crate) fn project_agent_request(&mut self, request: &str, command: ProjectAgentAction) -> Result<ProjectAgentSnapshot, String> {
        request_key(request)?;
        let (project, selected) = match command {
            ProjectAgentAction::Snapshot {project_id} => {self.saved_project(&project_id)?; (project_id, None)},
            ProjectAgentAction::Start {project_id, agent_id, prompt} => {
                let project = self.saved_project(&project_id)?;
                if let Some(text) = &prompt {prompt_valid(text)?;}
                let thread = format!("project-{}-primary-{}", digest(&project_id), &digest(request)[..12]);
                if let Some(existing) = self.project_sessions(&project_id).into_iter().find(|session| session.binding.parent_thread.is_none()) {
                    if prompt.is_some() && existing.thread_id != thread {
                        return Err("Project Agent already exists; send these instructions with Followup".into());
                    }
                    if let Some(text) = &prompt {
                        let history = self.visible_history();
                        let original = history.iter().find(|event| event.kind == "session_created"
                            && event.thread_id.as_deref() == Some(&thread));
                        if original.and_then(|event| event.data["projectPrompt"].as_str()) != Some(text.as_str()) {
                            return Err("This request already belongs to different Project instructions".into());
                        }
                    }
                    let resume = if prompt.is_none() { ProjectResume::RetryUnacknowledgedPrimary } else { ProjectResume::Load };
                    self.resume_project_session(&existing, &project, resume)?;
                    (project_id, Some(existing.thread_id))
                } else {
                    self.project_agent_available(&agent_id)?;
                    let binding = ProjectSessionBinding::primary(project_id.clone(), "Project Agent".into())?;
                    self.admit_session(&thread)?;
                    let workspace = self.project_workspace(&project, &thread, false)?;
                    let launch = self.project_launch(&project, binding, &thread, workspace, LaunchOrigin::Record(prompt.clone()))?;
                    self.create_session_with_origin(thread.clone(), &agent_id, None, None, None, Some(launch))?;
                    if let Some(text) = prompt {self.project_prompt(&thread, text)?;}
                    (project_id, Some(thread))
                }
            }
            ProjectAgentAction::Delegate {thread_id, agent_id, title, prompt} => {
                prompt_valid(&prompt)?;
                let primary = self.project_session(&thread_id)?;
                let binding = primary.binding.child(thread_id.clone(), title)?;
                let project = self.saved_project(&binding.project_id)?;
                let thread = format!("project-{}-{}", digest(&binding.project_id), digest(request));
                if let Ok(existing) = self.project_session(&thread) {
                    let original = self.visible_history().into_iter().find(|event| event.kind == "session_created"
                        && event.thread_id.as_deref() == Some(&thread) && event.data["projectPrompt"].is_string())
                        .and_then(|event| event.data["projectPrompt"].as_str().map(str::to_owned));
                    if existing.binding != binding || existing.agent_id != agent_id || original.as_deref() != Some(prompt.as_str()) {
                        return Err("This request already belongs to different delegated work".into());
                    }
                } else {
                    self.project_agent_available(&agent_id)?;
                    let settings = self.visible_history().iter().rev()
                        .filter(|event| event.thread_id.as_deref() == Some(&thread_id))
                        .find_map(|event| match event.kind.as_str() {
                            "configuration_changed" => serde_json::from_value::<pero_contracts::session_settings::SessionSettings>(event.data.clone()).ok(),
                            "session_ready" => serde_json::from_value::<pero_contracts::session_settings::SessionSettings>(event.data["peroSettings"].clone()).ok(),
                            _ => None,
                        }).unwrap_or_default();
                    let policy = ProjectDelegationPolicy::inherit(&primary.agent_id, &agent_id, &settings)?;
                    self.admit_session(&thread)?;
                    let workspace = self.project_workspace(&project, &thread, true)?;
                    let mut launch = self.project_launch(&project, binding.clone(), &thread, workspace, LaunchOrigin::Record(Some(prompt.clone())))?;
                    launch.initial_settings = policy.initial_settings;
                    self.create_session_with_origin(thread.clone(), &agent_id, None, None, None, Some(launch))?;
                    self.project_prompt(&thread, prompt)?;
                }
                (binding.project_id, Some(thread))
            }
            ProjectAgentAction::Followup {thread_id, prompt} => {
                prompt_valid(&prompt)?;
                let session = self.project_session(&thread_id)?;
                let project = self.saved_project(&session.binding.project_id)?;
                self.resume_project_session(&session, &project, ProjectResume::Load)?;
                self.project_prompt(&thread_id, prompt)?;
                (project.id, Some(thread_id))
            }
            ProjectAgentAction::Cancel {thread_id} => {
                let session = self.project_session(&thread_id)?;
                if !session.active {return Err("Original Session is inactive; cancellation cannot claim its effects were stopped".into());}
                let mut event = HostEvent::new("app_agent_cancel", None, String::new());
                event.thread_id = Some(thread_id.clone()); event.data = json!({});
                self.run_journal.append(&self.tx, event)?;
                if !self.command(HostCommand::Cancel {thread_id: thread_id.clone()}) {return Err("Cancellation request could not reach the original Session".into());}
                (session.binding.project_id, Some(thread_id))
            }
            ProjectAgentAction::Summarize {thread_id} => {
                let primary = self.project_session(&thread_id)?;
                if primary.binding.parent_thread.is_some() {return Err("Open the primary Agent to summarize this Project".into());}
                let project = self.saved_project(&primary.binding.project_id)?;
                self.resume_project_session(&primary, &project, ProjectResume::Load)?;
                let evidence = ProjectAgentSnapshot {project_id: project.id.clone(), selected_thread: None,
                    sessions: self.project_sessions(&project.id).into_iter().filter(|session| primary.binding.owns_child(&thread_id, &session.binding)).collect(),
                }.child_evidence();
                let context = pero_contracts::context::ContextReference {
                    id: format!("project-evidence-{request}"), kind: pero_contracts::context::ContextKind::Selection,
                    label: "Project execution evidence".into(), source: format!("project:{}", project.id),
                    content: pero_contracts::context::ContextContent::Text {text: serde_json::to_string_pretty(&evidence).map_err(|error| error.to_string())?},
                };
                if !self.command(HostCommand::Prompt {thread_id: thread_id.clone(),
                    text: "Summarize project progress using the attached execution evidence. Identify unfinished, failed, cancelled or unverified work and report omitted_sessions when nonzero.".into(), contexts: vec![context],
                }) {return Err("The summary request could not reach the original Session".into());}
                (project.id, Some(thread_id))
            }
        };
        Ok(ProjectAgentSnapshot {sessions: self.project_sessions(&project), project_id: project, selected_thread: selected})
    }

    fn project_prompt(&mut self, thread: &str, text: String) -> Result<(), String> {
        if self.command(HostCommand::Prompt {thread_id: thread.into(), text, contexts: vec![]}) {Ok(())}
        else {Err("Instructions could not reach the original Session".into())}
    }
}
