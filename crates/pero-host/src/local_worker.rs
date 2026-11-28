//! Own one independent local Worker process; credentials never enter public events.
use pero_contracts::{
    HostEvent,
    local_worker::{
        BUILTIN_AGENT_KEY_ENV, LocalWorkerConfig, LocalWorkerRequest, LocalWorkerState, LocalWorkerStatus,
        LocalWorkerSummary, WorkerProgress,
    },
};
use pero_runtime::acp;
use serde_json::json;
use std::{
    collections::BTreeMap,
    fs,
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex, mpsc},
    time::{Duration, Instant},
};

pub struct LocalWorkers {
    commands: mpsc::Sender<Message>,
    state: Arc<Mutex<LocalWorkerState>>,
    thread: Option<std::thread::JoinHandle<()>>,
}
enum Message {
    Start {
        config: LocalWorkerConfig,
        request_id: String,
        settings: Option<PathBuf>,
        catalog: Vec<acp::AgentConfig>,
    },
    Stop(String),
    Progress(u64, WorkerProgress),
    Shutdown,
}
struct Launch {
    config: LocalWorkerConfig,
    executable: PathBuf,
    directory: PathBuf,
    builtin_api_key: Option<String>,
}

fn publish(state: &Arc<Mutex<LocalWorkerState>>, request_id: Option<String>) {
    let snapshot = state.lock().unwrap().clone();
    let mut event = HostEvent::new("local_worker_state", request_id, String::new());
    event.data = serde_json::to_value(snapshot).unwrap_or_default();
    let _ = super::emit(event);
}

impl LocalWorkers {
    pub fn new(settings: Option<&Path>) -> Self {
        let directory = settings
            .and_then(Path::parent)
            .map(|p| p.join("workers"))
            .unwrap_or_else(|| {
                std::env::current_dir()
                    .unwrap_or_default()
                    .join("target/local-workers")
            });
        let summary = fs::read(directory.join("last_worker.json"))
            .ok()
            .and_then(|bytes| serde_json::from_slice::<LocalWorkerSummary>(&bytes).ok());
        let state = Arc::new(Mutex::new(LocalWorkerState {
            configuration: summary,
            ..Default::default()
        }));
        let (commands, received) = mpsc::channel();
        let events = commands.clone();
        let shared = state.clone();
        let thread = std::thread::spawn(move || supervise(received, events, shared));
        Self {
            commands,
            state,
            thread: Some(thread),
        }
    }
    pub fn dispatch(
        &self,
        value: serde_json::Value,
        settings: Option<&Path>,
        catalog: &[acp::AgentConfig],
    ) {
        let request_id = value["request_id"].as_str().map(str::to_string);
        let result = match serde_json::from_value::<LocalWorkerRequest>(value) {
            Ok(LocalWorkerRequest::Get { request_id }) => {
                publish(&self.state, Some(request_id));
                return;
            }
            Ok(LocalWorkerRequest::Stop { request_id }) => self
                .commands
                .send(Message::Stop(request_id))
                .map_err(|_| "Local Worker supervisor is unavailable".into()),
            Ok(LocalWorkerRequest::Start { request_id, worker }) => self
                .commands
                .send(Message::Start {
                    config: worker,
                    request_id,
                    settings: settings.map(Path::to_path_buf),
                    catalog: catalog.to_vec(),
                })
                .map_err(|_| "Local Worker supervisor is unavailable".into()),
            Err(_) => Err("Invalid local Worker request".into()),
        };
        if let Err(error) = result {
            self.state.lock().unwrap().message = error;
            publish(&self.state, request_id);
        }
    }
}
impl Drop for LocalWorkers {
    fn drop(&mut self) {
        let _ = self.commands.send(Message::Shutdown);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

fn private_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut options = fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.set_permissions(fs::Permissions::from_mode(0o600))
            .map_err(|e| e.to_string())?;
    }
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|e| e.to_string())
}
fn prepare(
    mut config: LocalWorkerConfig,
    settings: Option<&Path>,
    catalog: &[acp::AgentConfig],
) -> Result<Launch, String> {
    config.validate().map_err(str::to_string)?;
    #[cfg(not(unix))]
    {
        return Err("Local Worker supervision currently requires Unix".into());
    }
    let url = reqwest_origin(&config.url)?;
    config.url = url;
    let root = std::env::current_dir().map_err(|e| e.to_string())?;
    let mut selected = Vec::new();
    let mut workspaces = BTreeMap::new();
    let mut allowed_agents = BTreeMap::new();
    for binding in &mut config.bindings {
        let path = fs::canonicalize(&binding.path)
            .map_err(|_| format!("Workspace {} is unavailable", binding.workspace_key))?;
        if !path.is_dir() {
            return Err("Allowed workspace is not a directory".into());
        }
        binding.path = path.to_string_lossy().into();
        workspaces.insert(binding.workspace_key.clone(), path);
        allowed_agents.insert(binding.workspace_key.clone(), binding.agent_ids.clone());
        for id in &binding.agent_ids {
            let agent = catalog
                .iter()
                .find(|agent| agent.id == *id && agent.available())
                .ok_or_else(|| format!("Agent {id} is not installed locally"))?;
            if !selected.iter().any(|a: &acp::AgentConfig| a.id == *id) {
                selected.push(agent.clone());
            }
        }
    }
    // Keep the current provider credential out of the Worker allowlist on disk.
    let builtin_api_key = selected
        .iter_mut()
        .find(|agent| agent.id == "pero")
        .and_then(|agent| agent.env.remove("DEEPSEEK_API_KEY"));
    let data = settings
        .and_then(Path::parent)
        .map(|p| p.join("workers"))
        .unwrap_or_else(|| root.join("target/local-workers"));
    let directory = data.join(&config.id);
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&directory, fs::Permissions::from_mode(0o700))
            .map_err(|e| e.to_string())?;
    }
    let agents_file = directory.join("agents.json");
    private_write(
        &agents_file,
        &serde_json::to_vec_pretty(&selected).map_err(|e| e.to_string())?,
    )?;
    private_write(&directory.join("config.json"),&serde_json::to_vec_pretty(&json!({"workspaces":workspaces,"agents_file":agents_file,"allowed_agents":allowed_agents})).map_err(|e|e.to_string())?)?;
    private_write(
        &data.join("last_worker.json"),
        &serde_json::to_vec_pretty(&LocalWorkerSummary::from(&config))
            .map_err(|e| e.to_string())?,
    )?;
    let executable = std::env::var_os("PERO_WORKER_BIN")
        .map(PathBuf::from)
        .unwrap_or(
            std::env::current_exe()
                .map_err(|e| e.to_string())?
                .with_file_name("pero-worker"),
        );
    if !executable.is_file() {
        return Err("Local Worker executable is unavailable; build or reinstall Pero".into());
    }
    Ok(Launch {
        config,
        executable,
        directory,
        builtin_api_key,
    })
}
fn reqwest_origin(value: &str) -> Result<String, String> {
    // Reuse the runtime URL boundary rather than accept a credential-bearing endpoint.
    let url = pero_runtime::local_worker::WorkerOrigin::parse(value)?;
    Ok(url.as_str().trim_end_matches('/').into())
}

fn spawn(
    launch: &Launch,
    generation: u64,
    events: &mpsc::Sender<Message>,
) -> Result<Child, String> {
    let mut command = Command::new(&launch.executable);
    command.env_remove(BUILTIN_AGENT_KEY_ENV);
    if let Some(key) = &launch.builtin_api_key {
        command.env(BUILTIN_AGENT_KEY_ENV, key);
    }
    let mut child = command
        .env("PERO_CLOUD_URL", &launch.config.url)
        .env("PERO_WORKER_TOKEN", &launch.config.token)
        .env("PERO_WORKER_CONFIG", launch.directory.join("config.json"))
        .env("PERO_WORKER_STATE", launch.directory.join("journal.json"))
        .env("PERO_LOCAL_WORKER_SUPERVISED", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "Could not start the local Worker".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or("Worker progress stream is unavailable")?;
    let events = events.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            let Ok(line) = line else {
                break;
            };
            if line.len() > 8192 {
                continue;
            }
            if let Ok(progress) = serde_json::from_str::<WorkerProgress>(&line) {
                let _ = events.send(Message::Progress(generation, progress));
            }
        }
    });
    Ok(child)
}
fn stop(child: &mut Option<Child>) {
    if let Some(mut process) = child.take() {
        let _ = process.kill();
        let _ = process.wait();
    }
}
fn supervise(
    received: mpsc::Receiver<Message>,
    events: mpsc::Sender<Message>,
    state: Arc<Mutex<LocalWorkerState>>,
) {
    let mut child = None;
    let mut launch: Option<Launch> = None;
    let mut generation = 0;
    let mut restart: Option<Instant> = None;
    loop {
        match received.recv_timeout(Duration::from_millis(200)) {
            Ok(Message::Start {
                config,
                request_id,
                settings,
                catalog,
            }) => {
                if child.is_some() {
                    state.lock().unwrap().message =
                        "Stop the active local Worker before changing its configuration".into();
                    publish(&state, Some(request_id));
                    continue;
                }
                let next = match prepare(config, settings.as_deref(), &catalog) {
                    Ok(launch) => launch,
                    Err(error) => {
                        let mut snapshot = state.lock().unwrap();
                        snapshot.status = LocalWorkerStatus::NeedsAttention;
                        snapshot.message = error;
                        snapshot.enabled = false;
                        drop(snapshot);
                        publish(&state, Some(request_id));
                        continue;
                    }
                };
                generation += 1;
                restart = None;
                *state.lock().unwrap() = LocalWorkerState {
                    status: LocalWorkerStatus::Starting,
                    enabled: true,
                    configuration: Some(LocalWorkerSummary::from(&next.config)),
                    worker_id: next.config.id.clone(),
                    name: next.config.name.clone(),
                    url: next.config.url.clone(),
                    message: "Starting local execution".into(),
                    run_id: None,
                    attempt: 0,
                };
                match spawn(&next, generation, &events) {
                    Ok(process) => child = Some(process),
                    Err(error) => {
                        let mut state = state.lock().unwrap();
                        state.status = LocalWorkerStatus::Unavailable;
                        state.message = error;
                        state.enabled = false;
                    }
                }
                launch = Some(next);
                publish(&state, Some(request_id));
            }
            Ok(Message::Stop(request_id)) => {
                generation += 1;
                restart = None;
                {
                    let mut snapshot = state.lock().unwrap();
                    snapshot.enabled = false;
                    snapshot.status = LocalWorkerStatus::Stopping;
                    snapshot.message = "Stopping local execution".into();
                }
                publish(&state, Some(request_id.clone()));
                stop(&mut child);
                launch = None;
                {
                    let mut snapshot = state.lock().unwrap();
                    snapshot.status = LocalWorkerStatus::Stopped;
                    snapshot.run_id = None;
                    snapshot.message = "Local execution stopped".into();
                }
                publish(&state, Some(request_id));
            }
            Ok(Message::Progress(id, progress)) if id == generation => {
                if matches!(
                    progress.status,
                    LocalWorkerStatus::NeedsAttention | LocalWorkerStatus::Unavailable
                ) {
                    restart = None;
                }
                let mut snapshot = state.lock().unwrap();
                snapshot.status = progress.status;
                if matches!(
                    snapshot.status,
                    LocalWorkerStatus::NeedsAttention | LocalWorkerStatus::Unavailable
                ) {
                    snapshot.enabled = false;
                }
                snapshot.message = progress.message;
                snapshot.run_id = progress.run_id;
                drop(snapshot);
                publish(&state, None);
            }
            Ok(Message::Shutdown) | Err(mpsc::RecvTimeoutError::Disconnected) => {
                stop(&mut child);
                break;
            }
            _ => {}
        }
        if child
            .as_mut()
            .is_some_and(|process| process.try_wait().ok().flatten().is_some())
        {
            child = None;
            let mut snapshot = state.lock().unwrap();
            match pero_runtime::local_worker::RestartPlan::after_exit(
                snapshot.status,
                snapshot.attempt,
            ) {
                pero_runtime::local_worker::RestartPlan::Halt => {
                    snapshot.status = LocalWorkerStatus::NeedsAttention;
                    snapshot.enabled = false;
                    if snapshot.message.is_empty() {
                        snapshot.message =
                            "Worker stopped; review execution and retry explicitly".into();
                    }
                }
                pero_runtime::local_worker::RestartPlan::Retry { attempt, delay } => {
                    snapshot.attempt = attempt;
                    snapshot.status = LocalWorkerStatus::Offline;
                    snapshot.message = "Worker disconnected; restarting".into();
                    restart = Some(Instant::now() + delay);
                }
            }
            drop(snapshot);
            publish(&state, None);
        }
        if restart.is_some_and(|at| Instant::now() >= at) {
            restart = None;
            generation += 1;
            if let Some(launch) = &launch {
                match spawn(launch, generation, &events) {
                    Ok(process) => child = Some(process),
                    Err(error) => {
                        let mut snapshot = state.lock().unwrap();
                        snapshot.status = LocalWorkerStatus::Unavailable;
                        snapshot.message = error;
                        drop(snapshot);
                        publish(&state, None);
                    }
                }
            }
        }
    }
}
