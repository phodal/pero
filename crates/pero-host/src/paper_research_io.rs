//! Serialized research backend I/O, outside the Host command loop.
use super::{backend_request, ResearchContext};
use pero_contracts::{
    content_document::ContentFormat,
    session_artifact::{ArtifactMethod, ArtifactRequest, ResearchArtifactSource},
    HostEvent,
};
use pero_runtime::{
    apps::{agent_run::Run, BackendAccess},
    session_artifacts::SessionArtifacts,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs,
    io::Write,
    path::PathBuf,
    sync::mpsc,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

pub(super) struct ResearchIo {
    pub apps: crate::apps::Apps,
    pub settings_path: Option<PathBuf>,
    pub tx: mpsc::Sender<HostEvent>,
}

/// One queue owns cumulative tool accounting and orders lifecycle delivery after tools.
enum Job {
    Tool {
        id: String,
        thread: String,
        context: ResearchContext,
        tool: String,
        value: Value,
        transport_id: String,
    },
    Observe {
        run: Run,
        context: ResearchContext,
    },
}
struct Receipt {
    thread: String,
    observed: (String, u64),
    result: Result<(), String>,
}
struct Projection {
    applied: Option<(String, u64)>,
    pending: bool,
    retry_at: Instant,
    error: Option<String>,
}
#[derive(Default)]
pub(in crate::agents) struct ResearchWorker {
    queue: Option<mpsc::Sender<Job>>,
    receipts: Option<mpsc::Receiver<Receipt>>,
    projections: HashMap<String, Projection>,
    pub history_len: Option<usize>,
}
impl ResearchWorker {
    pub(super) fn start(&mut self, io: ResearchIo) {
        if self.queue.is_some() {
            return;
        }
        let (send, receive) = mpsc::channel();
        let (completed, receipts) = mpsc::channel();
        self.queue = Some(send);
        self.receipts = Some(receipts);
        std::thread::spawn(move || {
            for job in receive {
                match job {
                    Job::Tool {
                        id,
                        thread,
                        context,
                        tool,
                        value,
                        transport_id,
                    } => {
                        let mut event = HostEvent::new("apps_result", Some(id), String::new());
                        match io.request(&thread, &context, &tool, value, &transport_id) {
                            Ok(value) => event.data = json!({"ok":true,"value":value}),
                            Err(error) => {
                                event.text = error.clone();
                                event.data = json!({"ok":false,"error":error});
                            }
                        }
                        let _ = crate::emit(event);
                    }
                    Job::Observe { run, context } => {
                        let result = io.observe(&run.id, &context, &run.status);
                        if let Err(error) = &result {
                            let mut event = HostEvent::new(
                                "paper_research_delivery_error",
                                None,
                                error.clone(),
                            );
                            event.thread_id = Some(run.id.clone());
                            let _ = io.tx.send(event);
                        }
                        let _ = completed.send(Receipt {
                            thread: run.id,
                            observed: (run.status, run.attempt as u64),
                            result,
                        });
                    }
                }
            }
        });
    }
    pub fn drain(&mut self) -> bool {
        let mut changed = false;
        if let Some(receipts) = &self.receipts {
            while let Ok(receipt) = receipts.try_recv() {
                changed = true;
                if let Some(projection) = self.projections.get_mut(&receipt.thread) {
                    projection.pending = false;
                    match receipt.result {
                        Ok(()) => {
                            projection.applied = Some(receipt.observed);
                            projection.error = None;
                        }
                        Err(error) => {
                            projection.error = Some(error);
                            projection.retry_at = Instant::now() + Duration::from_secs(2);
                        }
                    }
                }
            }
        }
        changed
    }
    pub fn needs_retry(&self) -> bool {
        self.projections
            .values()
            .any(|p| !p.pending && p.error.is_some() && Instant::now() >= p.retry_at)
    }
    pub(super) fn observe(&mut self, run: Run, context: ResearchContext) -> Result<(), String> {
        let observed = (run.status.clone(), run.attempt as u64);
        let projection = self
            .projections
            .entry(run.id.clone())
            .or_insert(Projection {
                applied: None,
                pending: false,
                retry_at: Instant::now(),
                error: None,
            });
        if projection.pending
            || projection.applied.as_ref() == Some(&observed)
            || Instant::now() < projection.retry_at
        {
            return Ok(());
        }
        self.queue
            .as_ref()
            .ok_or("Research worker unavailable")?
            .send(Job::Observe { run, context })
            .map_err(|e| e.to_string())?;
        projection.pending = true;
        Ok(())
    }
    pub fn error(&self, thread: &str) -> Option<&str> {
        self.projections
            .get(thread)
            .and_then(|p| p.error.as_deref())
    }
    pub(super) fn request(
        &self,
        id: String,
        thread: String,
        context: ResearchContext,
        tool: String,
        value: Value,
        transport_id: String,
    ) -> Result<(), String> {
        self.queue
            .as_ref()
            .ok_or("Research worker unavailable")?
            .send(Job::Tool {
                id,
                thread,
                context,
                tool,
                value,
                transport_id,
            })
            .map_err(|e| e.to_string())
    }
}
impl ResearchIo {
    fn research_directory(&self, program: &str) -> Result<PathBuf, String> {
        Ok(self
            .settings_path
            .as_ref()
            .ok_or("Research needs a persistent Host profile")?
            .with_extension("research")
            .join(program))
    }

    pub(super) fn observe(
        &self,
        thread: &str,
        context: &ResearchContext,
        status: &str,
    ) -> Result<(), String> {
        let (backend, _) = self.apps.paper_research_access()?;
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

    pub(super) fn request(
        &self,
        thread: &str,
        context: &ResearchContext,
        tool: &str,
        value: Value,
        transport_id: &str,
    ) -> Result<Value, String> {
        let (backend, _) = self.apps.paper_research_access()?;
        let operation = value["operation"].as_str().unwrap_or("read");
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
