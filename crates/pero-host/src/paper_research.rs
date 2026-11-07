//! Paper plans join the existing App Run, ACP owner and artifact catalog.
use super::Manager;

use pero_runtime::{
    acp::AgentConfig,
    apps::{
        agent::AppSessionBinding, agent_plugin::AppPluginAssembly, AppSessionPlugins, BackendAccess,
    },
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{fs, io::Read, path::PathBuf, time::Duration};

#[path = "paper_research_io.rs"]
pub(super) mod io;

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
    fn start_research_worker(&mut self) -> Result<(), String> {
        self.paper_worker.start(io::ResearchIo {
            apps: self.apps.clone().ok_or("Apps unavailable")?,
            settings_path: self.settings_path.clone(),
            tx: self.tx.clone(),
        });
        Ok(())
    }
    pub(crate) fn reconcile_paper_runs(&mut self) {
        let completed = self.paper_worker.drain();
        let history = self.history.lock().unwrap();
        if !completed
            && self.paper_worker.history_len == Some(history.events().len())
            && !self.paper_worker.needs_retry()
        {
            return;
        }
        self.paper_worker.history_len = Some(history.events().len());
        let runs: Vec<_> = self
            .app_bindings
            .iter()
            .filter_map(|(id, binding)| {
                let context = ResearchContext::from_binding(binding).ok().flatten()?;
                let run = pero_runtime::apps::agent_run::Transcript::project(
                    id,
                    binding.run.as_ref()?,
                    history.events(),
                    self.sessions.get(id).is_some_and(|s| !s.tx.is_closed()),
                    0,
                )
                .run;
                Some((run, context))
            })
            .collect();
        drop(history);
        if runs.is_empty() {
            return;
        }
        if self.start_research_worker().is_err() {
            self.paper_worker.history_len = None;
            return;
        }
        for (run, context) in runs {
            let _ = self.paper_worker.observe(run, context);
        }
    }
    pub(super) fn observe_paper_run(
        &mut self,
        binding: &AppSessionBinding,
        run: pero_runtime::apps::agent_run::Run,
    ) -> Result<(), String> {
        let Some(context) = ResearchContext::from_binding(binding)? else {
            return Ok(());
        };
        self.start_research_worker()?;
        self.paper_worker.observe(run, context)
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
        id: String,
        thread: &str,
        tool: &str,
        mut document: Value,
        transport_id: &str,
    ) -> Result<(), String> {
        let binding = self
            .app_bindings
            .get(thread)
            .ok_or("Research requires a bound App Run")?;
        let context = ResearchContext::from_binding(binding)?
            .ok_or("Start a research plan before using autonomous tools")?;
        if !TOOLS.contains(&tool) || !self.sessions.get(thread).is_some_and(|s| !s.tx.is_closed()) {
            return Err("Research session or tool unavailable".into());
        }
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
        if !matches!(operation.as_str(), "read" | "feedback" | "poll" | "export")
            && tool != "research-deliver"
        {
            let operation_id = value["operationId"]
                .as_str()
                .filter(|id| !id.trim().is_empty() && id.len() <= 200)
                .ok_or("Research mutations require a stable operationId of 1–200 bytes")?;
            value["operationId"] = json!(format!("{}:{}", thread, operation_id));
        }
        self.start_research_worker()?;
        self.paper_worker.request(
            id,
            thread.into(),
            context,
            tool.into(),
            value,
            transport_id.into(),
        )
    }
}
