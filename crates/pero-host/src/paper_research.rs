//! Paper plans join the existing App Run, ACP owner and artifact catalog.
use super::Manager;
use pero_contracts::{
    content_document::ContentFormat,
    session_artifact::{ArtifactMethod, ArtifactRequest, ResearchArtifactSource},
    HostEvent,
};
use pero_runtime::{
    acp::AgentConfig,
    apps::{
        agent::AppSessionBinding, agent_plugin::AppPluginAssembly, AppSessionPlugins, BackendAccess,
    },
    session_artifacts::SessionArtifacts,
};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::PathBuf,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

const TOOLS: [&str; 4] = [
    "research-program",
    "research-search",
    "research-acquire",
    "research-deliver",
];

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ResearchContext {
    kind: String,
    program_id: String,
    protocol_digest: String,
}
impl ResearchContext {
    fn from_binding(binding: &AppSessionBinding) -> Result<Option<Self>, String> {
        let Some(value) = binding.run.as_ref().and_then(|run| run.context.as_ref()) else {
            return Ok(None);
        };
        if value["kind"] != "paper-autoresearch" {
            return Ok(None);
        }
        let context: Self =
            serde_json::from_value(value.clone()).map_err(|_| "Invalid research context")?;
        if binding.app.as_str() != "paper-agent"
            || binding.agent_id != "pero"
            || context.kind != "paper-autoresearch"
            || [&context.program_id, &context.protocol_digest]
                .iter()
                .any(|id| {
                    id.len() != 64
                        || !id
                            .bytes()
                            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
                })
        {
            return Err("Research requires the builtin Pero Agent and a saved Paper plan".into());
        }
        Ok(Some(context))
    }
}

fn backend_request(backend: &BackendAccess, body: &Value) -> Result<Value, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(12))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .post(format!("{}/internal/research-program", backend.url))
        .header("X-Pero-App-Token", &backend.token)
        .header("X-Pero-Research-Internal", "1")
        .json(body)
        .send()
        .map_err(|e| format!("Paper research backend unavailable: {e}"))?;
    let status = response.status();
    let mut bytes = Vec::new();
    response
        .take(2 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > 2 * 1024 * 1024 {
        return Err("Paper research response exceeds 2 MiB".into());
    }
    if !status.is_success() {
        return Err(String::from_utf8_lossy(&bytes).chars().take(1000).collect());
    }
    serde_json::from_slice(&bytes).map_err(|_| "Paper research returned invalid JSON".into())
}

impl Manager {
    /// Project existing ACP lifecycle observations on the Host owner, even with no UI attached.
    /// This does not drive research or issue model calls. Failed delivery is visible and can be retried by status/deliver.
    pub(crate) fn reconcile_paper_runs(&mut self) {
        let bindings: Vec<_> = self
            .app_bindings
            .iter()
            .filter(|(_, binding)| {
                ResearchContext::from_binding(binding)
                    .ok()
                    .flatten()
                    .is_some()
            })
            .map(|(id, binding)| (id.clone(), binding.clone()))
            .collect();
        for (id, binding) in bindings {
            let run = self
                .run_transcript(&id, binding.run.as_ref().unwrap(), 0)
                .run;
            let observed = (run.status.clone(), run.attempt as u64);
            if self.paper_run_projection.get(&id) == Some(&observed) {
                continue;
            }
            self.paper_run_projection.insert(id.clone(), observed);
            if let Err(error) = self.observe_paper_run(&id, &binding, &run.status) {
                let mut event = HostEvent::new("paper_research_delivery_error", None, error);
                event.thread_id = Some(id);
                let _ = self.tx.send(event);
            }
        }
    }

    pub(super) fn observe_paper_run(
        &self,
        thread: &str,
        binding: &AppSessionBinding,
        status: &str,
    ) -> Result<(), String> {
        let Some(context) = ResearchContext::from_binding(binding)? else {
            return Ok(());
        };
        let (backend, _) = self
            .apps
            .as_ref()
            .ok_or("Apps unavailable")?
            .paper_research_access()?;
        let directory = self.research_directory(&context.program_id)?;
        let count = |file: &str| -> Result<usize, String> {
            match fs::read_to_string(directory.join(file)) {
                Ok(text) => Ok(text.lines().count()),
                Err(error) => Err(error.to_string()),
            }
        };
        backend_request(
            &backend,
            &json!({"operation":"observe-run","programId":context.program_id,"threadId":thread,"status":status,
            "modelRequestsUsed":count("model-attempts.log")?,"appCallsUsed":count("app-calls.log")?}),
        )?;
        if matches!(status, "completed" | "failed" | "cancelled" | "interrupted") {
            let export = backend_request(
                &backend,
                &json!({"operation":"export-manifest","programId":context.program_id,"threadId":thread}),
            )?;
            self.deliver_paper_research(thread, &context.program_id, &backend, export)?;
        }
        Ok(())
    }

    pub(super) fn resume_paper_run(
        &self,
        thread: &str,
        binding: &AppSessionBinding,
    ) -> Result<(), String> {
        let Some(context) = ResearchContext::from_binding(binding)? else {
            return Ok(());
        };
        let (backend, _) = self
            .apps
            .as_ref()
            .ok_or("Apps unavailable")?
            .paper_research_access()?;
        backend_request(
            &backend,
            &json!({"operation":"resume","programId":context.program_id,"threadId":thread}),
        )?;
        Ok(())
    }

    fn research_directory(&self, program: &str) -> Result<PathBuf, String> {
        Ok(self
            .settings_path
            .as_ref()
            .ok_or("Research needs a persistent Host profile")?
            .with_extension("research")
            .join(program))
    }

    pub(super) fn prepare_paper_research(
        &self,
        thread: &str,
        binding: &AppSessionBinding,
        agent: &mut AgentConfig,
        plugins: Option<&AppSessionPlugins>,
    ) -> Result<Option<AppSessionPlugins>, String> {
        let Some(context) = ResearchContext::from_binding(binding)? else {
            return Ok(None);
        };
        let (backend, app) = self
            .apps
            .as_ref()
            .ok_or("Apps unavailable")?
            .paper_research_access()?;
        let descriptor = backend_request(
            &backend,
            &json!({"operation":"bind","programId":context.program_id,"protocolDigest":context.protocol_digest,"threadId":thread}),
        )?;
        let limits = &descriptor["protocol"]["limits"];
        let requests = limits["modelRequests"]
            .as_u64()
            .ok_or("Missing research request budget")?;
        let calls = limits["appCalls"]
            .as_u64()
            .ok_or("Missing research tool budget")?;
        let directory = self.research_directory(&context.program_id)?;
        fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
        let audit = directory.join("model-attempts.log");
        for path in [&audit, &directory.join("app-calls.log")] {
            if !path.exists() {
                if self.app_bindings.contains_key(thread) {
                    return Err(
                        "Research attempt audit is missing; allowance cannot be reset".into(),
                    );
                }
                fs::OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(path)
                    .and_then(|f| f.sync_all())
                    .map_err(|e| e.to_string())?;
            }
        }
        agent.env.insert("PERO_PAPER_RESEARCH".into(), json!({"programId":context.program_id,"deadline":descriptor["protocol"]["deadline"],"modelRequests":requests,"auditPath":audit}).to_string());
        agent.args.retain(|arg| arg != "--session-titles");
        let tools = TOOLS
            .iter()
            .map(|name| {
                app.writes
                    .iter()
                    .find(|route| route.name.as_str() == *name)
                    .cloned()
                    .ok_or_else(|| format!("Paper research tool is not installed: {name}"))
            })
            .collect::<Result<Vec<_>, _>>()?;
        let prompt = descriptor["prompt"]
            .as_str()
            .ok_or("Missing research instructions")?;
        let dependencies = plugins
            .ok_or("Paper research Skill is not installed")?
            .dependencies
            .clone();
        let skill = dependencies
            .skills
            .iter()
            .find(|skill| skill.plugin.as_str() == "paper-autoresearch")
            .ok_or("Paper research Skill is not installed")?;
        let instructions = format!(
            "Plugin paper-autoresearch Skill {}:\n{}\n\n{prompt}",
            skill.path.display(),
            skill.content
        );
        Ok(Some(AppSessionPlugins {
            app: app.name.clone(),
            dependencies,
            instructions: instructions.clone(),
            assembly: Some(AppPluginAssembly {
                app: app.name,
                revision: app.revision,
                instructions,
                tools,
                max_calls: calls as u32,
                host_budgeted: true,
            }),
        }))
    }

    pub(crate) fn paper_research_request(
        &mut self,
        thread: &str,
        tool: &str,
        mut document: Value,
        transport_id: &str,
    ) -> Result<Value, String> {
        let binding = self
            .app_bindings
            .get(thread)
            .ok_or("Research requires a bound App Run")?;
        let context = ResearchContext::from_binding(binding)?
            .ok_or("Start a research plan before using autonomous tools")?;
        if !TOOLS.contains(&tool) || !self.sessions.get(thread).is_some_and(|s| !s.tx.is_closed()) {
            return Err("Research session or tool unavailable".into());
        }
        let (backend, _) = self
            .apps
            .as_ref()
            .ok_or("Apps unavailable")?
            .paper_research_access()?;
        if !document.is_object() {
            return Err("Research document must be an object".into());
        }
        document.as_object_mut().unwrap().remove("threadId");
        let mut value = document;
        if value
            .get("programId")
            .is_some_and(|id| id != &context.program_id)
        {
            return Err("Tool references another research program".into());
        }
        value["programId"] = json!(context.program_id);
        value["threadId"] = json!(thread);
        let operation = value["operation"].as_str().unwrap_or("read").to_owned();
        if !match tool {
            "research-program" => [
                "read",
                "feedback",
                "screen",
                "prepare-study",
                "study-step",
                "source-step",
                "source-report",
                "commit-round",
                "finish",
            ]
            .contains(&operation.as_str()),
            "research-search" => ["search", "discover", "poll"].contains(&operation.as_str()),
            "research-acquire" => ["acquire", "poll"].contains(&operation.as_str()),
            "research-deliver" => true,
            _ => false,
        } {
            return Err("Operation is outside this research tool".into());
        }
        value["operation"] = json!(operation);
        if tool == "research-deliver" {
            value["operation"] = json!("export-manifest");
        }
        if !matches!(operation.as_str(), "read" | "feedback" | "export")
            && tool != "research-deliver"
        {
            let operation_id = value["operationId"]
                .as_str()
                .unwrap_or(transport_id)
                .to_owned();
            value["operationId"] = json!(format!("{}:{}", thread, operation_id));
        }
        // These are actual tool invocations, recorded before dispatch and retained across retries.
        if operation != "feedback" && tool != "research-deliver" {
            let descriptor = backend_request(
                &backend,
                &json!({"operation":"launch","programId":context.program_id}),
            )?;
            let cap = descriptor["protocol"]["limits"]["appCalls"]
                .as_u64()
                .ok_or("Missing tool budget")?;
            let path = self
                .research_directory(&context.program_id)?
                .join("app-calls.log");
            let previous = fs::read_to_string(&path).map_err(|e| {
                format!("Research App audit unavailable; allowance cannot be reset: {e}")
            })?;
            if previous.lines().count() as u64 >= cap {
                return Err(
                    "Research cumulative App call budget exhausted; deliver the saved checkpoint"
                        .into(),
                );
            }
            let mut file = fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(path)
                .map_err(|e| e.to_string())?;
            writeln!(
                file,
                "{}",
                format!("{:x}", Sha256::digest(transport_id.as_bytes()))
            )
            .and_then(|_| file.sync_all())
            .map_err(|e| e.to_string())?;
        }
        let mut result = backend_request(&backend, &value)?;
        if operation == "feedback" && result["continueResearch"] == true {
            let descriptor = backend_request(
                &backend,
                &json!({"operation":"launch","programId":context.program_id}),
            )?;
            let directory = self.research_directory(&context.program_id)?;
            let calls = fs::read_to_string(directory.join("app-calls.log"))
                .map_err(|e| e.to_string())?
                .lines()
                .count() as u64;
            let attempts = fs::read_to_string(directory.join("model-attempts.log"))
                .map_err(|e| e.to_string())?
                .lines()
                .count() as u64;
            if calls
                >= descriptor["protocol"]["limits"]["appCalls"]
                    .as_u64()
                    .unwrap_or(0)
                || attempts
                    >= descriptor["protocol"]["limits"]["modelRequests"]
                        .as_u64()
                        .unwrap_or(0)
            {
                backend_request(
                    &backend,
                    &json!({"operation":"finish","programId":context.program_id,"threadId":thread,
                    "expectedCheckpoint":result["checkpoint"],"operationId":format!("{thread}:budget-exhausted"),"reason":"budget_exhausted"}),
                )?;
                result["continueResearch"] = json!(false);
                result["stopReason"] = json!("budget_exhausted");
            }
        }
        if tool == "research-deliver" {
            return self.deliver_paper_research(thread, &context.program_id, &backend, result);
        }
        Ok(result)
    }

    fn deliver_paper_research(
        &self,
        thread: &str,
        program: &str,
        backend: &BackendAccess,
        export: Value,
    ) -> Result<Value, String> {
        let checkpoint = export["checkpoint"]
            .as_str()
            .ok_or("Export checkpoint missing")?;
        let store = SessionArtifacts::new(
            self.settings_path
                .as_ref()
                .ok_or("Artifact profile unavailable")?,
        );
        let mut delivered = Vec::new();
        for document in export["documents"]
            .as_array()
            .ok_or("Export documents missing")?
        {
            let slot = document["slot"].as_str().ok_or("Export slot missing")?;
            let filename = document["filename"]
                .as_str()
                .ok_or("Export filename missing")?;
            let part = backend_request(
                backend,
                &json!({"operation":"export","programId":program,"threadId":thread,"checkpoint":checkpoint,"slot":slot}),
            )?;
            let text = part["documents"][0]["content"]
                .as_str()
                .ok_or("Export content missing")?;
            let source = ResearchArtifactSource {
                program_id: program.into(),
                checkpoint_id: checkpoint.into(),
                slot: slot.into(),
                export_digest: document["sha256"]
                    .as_str()
                    .ok_or("Export digest missing")?
                    .into(),
            };
            let artifact = store
                .register_research(
                    ArtifactRequest::RegisterText {
                        method: ArtifactMethod::Artifacts,
                        request_id: format!("research-{checkpoint}-{slot}"),
                        thread_id: thread.into(),
                        artifact_id: None,
                        title: filename.into(),
                        text: text.into(),
                        format: Some(if filename.ends_with(".jsonl") {
                            ContentFormat::JsonLines
                        } else if filename.ends_with(".json") {
                            ContentFormat::Json
                        } else {
                            ContentFormat::Markdown
                        }),
                        source_message_id: None,
                        source_tool_call_id: None,
                    },
                    source,
                    SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_secs(),
                )
                .map_err(|e| e.to_string())?;
            let version = artifact.versions.iter().find(|v| matches!(&v.source, pero_contracts::session_artifact::ArtifactSource::Research{provenance} if provenance.checkpoint_id == checkpoint)).ok_or("Export version missing")?.version;
            delivered.push(json!({"slot":slot,"artifactId":artifact.id,"version":version,"checkpoint":checkpoint}));
            let mut event = HostEvent::new("artifact_registered", None, String::new());
            event.thread_id = Some(thread.into());
            event.data = json!({"artifact":artifact});
            let _ = self.tx.send(event);
        }
        Ok(json!({"checkpoint":checkpoint,"artifacts":delivered,"acceptance":"needs_review"}))
    }
}
