//! Project membership joins existing ACP conversations, history and permissions.
use super::Manager;
use pero_contracts::{
    project_agent::{request_key, ProjectAgentAction, ProjectAgentRequest, ProjectAgentSession, ProjectAgentSnapshot, ProjectSessionBinding, ProjectAgentEvidence, ProjectAgentEvidenceUpdate, ProjectDelegationPolicy},
    research_project::ResearchProject,
    HostCommand, HostEvent,
};
use pero_runtime::{acp, apps::agent_run::{Binding, Scope, Transcript}};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{collections::HashMap, path::{Path, PathBuf}};

pub(crate) struct Launch {
    pub binding: ProjectSessionBinding,
    pub workspace: PathBuf,
    pub instructions: String,
    pub server: Option<acp::sdk::schema::v1::McpServer>,
    pub initial_prompt: Option<String>,
    pub initial_settings: Vec<pero_contracts::session_settings::SettingSelection>,
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

    fn saved_agent_project(&self, id: &str) -> Result<ResearchProject, String> {
        request_key(id)?;
        let settings = self.settings_path.as_deref().ok_or("Project Agent needs a persistent Host profile")?;
        pero_runtime::settings::load_notebook_projects(settings).map_err(|error| error.to_string())?
            .research_projects.into_iter().find(|project| project.id == id).ok_or("Save the research Project before starting its Agent".into())
    }

    fn project_sessions(&self, project: &str) -> Vec<ProjectAgentSession> {
        let history = self.visible_history();
        let mut created = HashMap::new();
        let mut order = Vec::new();
        for event in &history {
            if event.kind != "session_created" {continue;}
            let Some(thread) = event.thread_id.as_deref() else {continue};
            let Some(raw) = event.data.get("projectAgent") else {continue};
            let Ok(binding) = serde_json::from_value::<ProjectSessionBinding>(raw.clone()) else {continue};
            if binding.validate().is_err() || binding.project_id != project {continue;}
            if !created.contains_key(thread) {order.push(thread.to_owned());}
            created.insert(thread.to_owned(), (event, binding));
        }
        order.into_iter().filter_map(|thread| {
            let (created, binding) = created.remove(&thread)?;
            let active = self.sessions.get(&thread).is_some_and(|session| !session.tx.is_closed());
            let workspace = created.data["workspace"].as_str().unwrap_or_default().to_owned();
            let run_binding = Binding {
                scope: Scope {workspace_id: project.into()}, request_id: thread.clone(),
                harness_id: created.data["agent"].as_str().unwrap_or_default().into(),
                panel: String::new(), runtime_digest: String::new(), app_revision: None,
                created_at: String::new(), context: None,
            };
            let run = Transcript::project(&thread, &run_binding, &history, active, 0).run;
            let mut result = String::new();
            let mut evidence = Vec::new();
            let mut submitted = false;
            for event in history.iter().filter(|event| event.thread_id.as_deref() == Some(&thread)) {
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

    fn project_home(&self, project: &str) -> Result<PathBuf, String> {
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

    fn project_launch(&self, project: &ResearchProject, binding: ProjectSessionBinding, thread: &str, workspace: PathBuf, initial_prompt: Option<String>) -> Result<Launch, String> {
        let primary = binding.parent_thread.is_none();
        let agents: Vec<_> = self.agents.iter().filter(|agent| agent.available()).map(|agent| json!({"id":agent.id,"name":agent.name})).collect();
        let instructions = format!(
            "Project: {} ({})\nPersistent goal: {}\nProject source directory: {}\nThis conversation workspace: {}\nLinked context references (content remains with its original owner): {}\n\n{}\nAvailable Agents: {}\n\nReport evidence precisely. Cite exact conversation IDs and workspace paths, commands, checks, output files or linked App revisions. Separate completed execution, verified results and unverified claims. Do not invent results or treat Agent text as independent scientific acceptance. Child workspaces and Git changes are retained; no automatic merge or publication occurs.",
            project.title, project.id, project.goal, project.workspace.as_deref().unwrap_or("No source directory"), workspace.display(),
            serde_json::to_string(&project.resources).map_err(|error| error.to_string())?,
            if primary {"You are this Project's primary Agent. Break the user's request into bounded work, delegate with project_work using agent_id/title/prompt, then use project_work list to inspect original results. Work is asynchronous: return progress while children run and ask the user to request a summary later if needed; do not poll repeatedly. Use followup or cancel only for your child threads. Keep task-specific instructions in the prompt. The user can open every original conversation and resolve its existing permissions."}
            else {"You are working on one delegated task. Follow the supplied scope. Your workspace is isolated from the primary Agent. Git worktrees start from committed HEAD, so uncommitted source edits are not included. For a non-Git Project, this is an empty task workspace; the source path above is context, not a new filesystem grant. Return a concise result with evidence and explicit limitations."},
            serde_json::to_string(&agents).map_err(|error| error.to_string())?,
        );
        let server = if primary {Some(self.project_tools.as_ref().ok_or("Project delegation tools are unavailable")?.server(thread)?)} else {None};
        Ok(Launch {binding, workspace, instructions, server, initial_prompt, initial_settings: vec![]})
    }

    fn resume_project_session(&mut self, session: &ProjectAgentSession, project: &ResearchProject) -> Result<(), String> {
        if session.active {return Ok(());}
        let remote = self.visible_history().iter().rev()
            .find(|event| event.kind == "session_ready" && event.thread_id.as_deref() == Some(&session.thread_id))
            .and_then(|event| event.data["sessionId"].as_str().map(str::to_owned))
            .ok_or("Original ACP Session was never acknowledged; inspect its history before creating new work")?;
        let workspace = dunce::canonicalize(&session.workspace).map_err(|error| format!("Original workspace is unavailable; no work was replayed: {error}"))?;
        let launch = self.project_launch(project, session.binding.clone(), &session.thread_id, workspace, None)?;
        self.create_session_with_origin(session.thread_id.clone(), &session.agent_id, None, None, Some(remote), Some(launch))
    }

    pub(super) fn resume_project_prompt(&mut self, thread: &str) -> Result<(), String> {
        let Ok(session) = self.project_session(thread) else { return Ok(()); };
        let project = self.saved_agent_project(&session.binding.project_id)?;
        self.resume_project_session(&session, &project)
    }

    pub(crate) fn project_agent_request(&mut self, request: &str, command: ProjectAgentAction) -> Result<ProjectAgentSnapshot, String> {
        request_key(request)?;
        let (project, selected) = match command {
            ProjectAgentAction::Snapshot {project_id} => {self.saved_agent_project(&project_id)?; (project_id, None)},
            ProjectAgentAction::Start {project_id, agent_id, prompt} => {
                let project = self.saved_agent_project(&project_id)?;
                if let Some(text) = &prompt {prompt_valid(text)?;}
                let thread = format!("project-{}-primary-{}", digest(&project_id), &digest(request)[..12]);
                if let Some(existing) = self.project_sessions(&project_id).into_iter().find(|session| session.binding.parent_thread.is_none()) {
                    self.resume_project_session(&existing, &project)?;
                    (project_id, Some(existing.thread_id))
                } else {
                    self.project_agent_available(&agent_id)?;
                    let binding = ProjectSessionBinding::primary(project_id.clone(), "Project Agent".into())?;
                    let workspace = self.project_workspace(&project, &thread, false)?;
                    let launch = self.project_launch(&project, binding, &thread, workspace, prompt.clone())?;
                    self.create_session_with_origin(thread.clone(), &agent_id, None, None, None, Some(launch))?;
                    if let Some(text) = prompt {self.project_prompt(&thread, text)?;}
                    (project_id, Some(thread))
                }
            }
            ProjectAgentAction::Delegate {thread_id, agent_id, title, prompt} => {
                prompt_valid(&prompt)?;
                let primary = self.project_session(&thread_id)?;
                let binding = primary.binding.child(thread_id.clone(), title)?;
                let project = self.saved_agent_project(&binding.project_id)?;
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
                    let workspace = self.project_workspace(&project, &thread, true)?;
                    let mut launch = self.project_launch(&project, binding.clone(), &thread, workspace, Some(prompt.clone()))?;
                    launch.initial_settings = policy.initial_settings;
                    self.create_session_with_origin(thread.clone(), &agent_id, None, None, None, Some(launch))?;
                    self.project_prompt(&thread, prompt)?;
                }
                (binding.project_id, Some(thread))
            }
            ProjectAgentAction::Followup {thread_id, prompt} => {
                prompt_valid(&prompt)?;
                let session = self.project_session(&thread_id)?;
                let project = self.saved_agent_project(&session.binding.project_id)?;
                self.resume_project_session(&session, &project)?;
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
                let project = self.saved_agent_project(&primary.binding.project_id)?;
                self.resume_project_session(&primary, &project)?;
                let evidence = ProjectAgentSnapshot {project_id: project.id.clone(), selected_thread: None,
                    sessions: self.project_sessions(&project.id).into_iter().filter(|session| primary.binding.owns_child(&thread_id, &session.binding)).collect(),
                }.child_evidence();
                let context = pero_contracts::context::ContextReference {
                    id: format!("project-evidence-{request}"), kind: pero_contracts::context::ContextKind::Selection,
                    label: "Project execution evidence".into(), source: format!("project:{}", project.id),
                    content: pero_contracts::context::ContextContent::Text {text: serde_json::to_string_pretty(&evidence).map_err(|error| error.to_string())?},
                };
                if !self.command(HostCommand::Prompt {thread_id: thread_id.clone(),
                    text: "Summarize project progress using the attached execution evidence. Cite original conversations and concrete checks or files, and identify unfinished, failed, cancelled or unverified work. Report omitted_sessions when nonzero. Child Agent text is reported evidence, not independent verification.".into(), contexts: vec![context],
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
