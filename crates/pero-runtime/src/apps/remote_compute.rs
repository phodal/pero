//! Compute's private Host capability. App requests select a bundled method;
//! existing EnvironmentUses and external owners retain execution authority.
use crate::{compute::*, environment_use_store::EnvironmentUses, environments::*};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs,
    io::{BufRead, BufReader, Read, Write},
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    thread::JoinHandle,
};

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Cluster {
    id: Identity,
    name: String,
    host: String,
    account: String,
    partition: String,
    workdir: PathBuf,
    scheduler: Scheduler,
}
#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum Scheduler {
    Ssh,
    Slurm,
}
#[derive(Deserialize)]
#[serde(tag = "operation", rename_all = "snake_case", deny_unknown_fields)]
enum Request {
    State,
    Probe { cluster: Cluster },
    Prepare { cluster: Cluster, input: Quadrature },
    Submit { id: Identity, digest: ContentDigest },
    Observe { id: Identity },
    Cancel { id: Identity },
    Collect { id: Identity },
    Artifact { id: Identity, digest: ContentDigest },
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Envelope {
    token: String,
    request: Request,
}

/// Frozen invocation and external facts, not a second Run/Use state machine.
#[derive(Serialize, Deserialize)]
struct SlurmRequest {
    constraints: BatchConstraints,
    account: Option<Identity>,
}
#[derive(Serialize, Deserialize)]
struct Attempt {
    id: Identity,
    cluster: Cluster,
    input: Quadrature,
    directory: PathBuf,
    digest: ContentDigest,
    snapshot: EnvironmentSnapshot,
    slurm: Option<SlurmRequest>,
    #[serde(default)]
    submitted_at: Option<u64>,
    #[serde(default)]
    process: Option<RemoteProcessObservation>,
    #[serde(default)]
    batch: Option<BatchSubmission>,
    #[serde(default)]
    batch_observation: Option<BatchObservation>,
    #[serde(default)]
    cancel_requested: bool,
    #[serde(default)]
    outputs: Vec<Output>,
    #[serde(default)]
    collection_error: Option<String>,
    #[serde(default)]
    error: Option<String>,
}
#[derive(Serialize, Deserialize)]
struct Output {
    path: String,
    sha256: ContentDigest,
    reference: String,
}

pub(super) struct RemoteCompute {
    address: std::net::SocketAddr,
    token: String,
    stopped: Arc<AtomicBool>,
    worker: Option<JoinHandle<()>>,
}
impl RemoteCompute {
    pub fn start(app: &str, data: &Path) -> Result<Option<Self>, String> {
        if app != "compute" {
            return Ok(None);
        }
        let data = data.to_owned();
        fs::create_dir_all(data.join(".remote/attempts")).map_err(|e| e.to_string())?;
        let mut uses = EnvironmentUses::open(&data.join(".remote/uses.sqlite"))?;
        let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|e| e.to_string())?;
        let address = listener.local_addr().map_err(|e| e.to_string())?;
        let token = uuid::Uuid::new_v4().to_string();
        let stopped = Arc::new(AtomicBool::new(false));
        let (secret, done) = (token.clone(), stopped.clone());
        // Host configuration only. The App cannot choose executables or keys.
        let ssh = std::env::var_os("PERO_COMPUTE_SSH")
            .map(PathBuf::from)
            .unwrap_or_else(|| "/usr/bin/ssh".into());
        let worker = std::thread::spawn(move || {
            let mut owner = Owner {
                data,
                ssh,
                uses: &mut uses,
                probe: None,
            };
            for stream in listener.incoming() {
                if done.load(Ordering::SeqCst) {
                    break;
                }
                let Ok(mut stream) = stream else {
                    break;
                };
                let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(35)));
                let _ = stream.set_write_timeout(Some(std::time::Duration::from_secs(35)));
                let result = (|| {
                    let mut line = String::new();
                    BufReader::new(&stream)
                        .take(65537)
                        .read_line(&mut line)
                        .map_err(|e| e.to_string())?;
                    if line.len() > 65536 || !line.ends_with('\n') {
                        return Err("Invalid remote Compute frame".to_owned());
                    }
                    let envelope: Envelope =
                        serde_json::from_str(&line).map_err(|e| e.to_string())?;
                    if envelope.token != secret {
                        return Err("Private Compute owner required".into());
                    }
                    owner.apply(envelope.request)
                })();
                let response = match result {
                    Ok(value) => serde_json::json!({"value":value}),
                    Err(error) => serde_json::json!({"error":error}),
                };
                let _ = writeln!(stream, "{response}");
            }
            // Remote work survives the App/Host. Reopening only observes original
            // identities; it does not resend a submission or claim a local stop.
        });
        Ok(Some(Self {
            address,
            token,
            stopped,
            worker: Some(worker),
        }))
    }
    pub fn configure(&self, command: &mut std::process::Command) {
        command
            .env("PERO_REMOTE_COMPUTE_ADDRESS", self.address.to_string())
            .env("PERO_REMOTE_COMPUTE_TOKEN", &self.token);
    }
}
impl Drop for RemoteCompute {
    fn drop(&mut self) {
        self.stopped.store(true, Ordering::SeqCst);
        let _ = TcpStream::connect(self.address);
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

struct Owner<'a> {
    data: PathBuf,
    ssh: PathBuf,
    uses: &'a mut EnvironmentUses,
    probe: Option<serde_json::Value>,
}
impl Owner<'_> {
    fn transport(&self, cluster: &Cluster) -> Result<SshTransport, String> {
        SshTransport::new(self.ssh.clone(), cluster.host.clone())
    }
    fn path(&self, id: &Identity) -> PathBuf {
        self.data
            .join(".remote/attempts")
            .join(format!("{}.json", id.as_str()))
    }
    fn save(&self, attempt: &Attempt) -> Result<(), String> {
        let path = self.path(&attempt.id);
        let pending = path.with_extension("pending");
        let mut file = fs::File::create(&pending).map_err(|e| e.to_string())?;
        file.write_all(&serde_json::to_vec_pretty(attempt).map_err(|e| e.to_string())?)
            .and_then(|_| file.sync_all())
            .map_err(|e| e.to_string())?;
        fs::rename(pending, path).map_err(|e| e.to_string())
    }
    fn load(&self, id: &Identity) -> Result<Attempt, String> {
        serde_json::from_slice(&fs::read(self.path(id)).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())
    }
    fn state(&self) -> Result<serde_json::Value, String> {
        let mut attempts = vec![];
        for file in fs::read_dir(self.data.join(".remote/attempts")).map_err(|e| e.to_string())? {
            let path = file.map_err(|e| e.to_string())?.path();
            if path.extension().is_some_and(|v| v == "json") {
                let attempt: Attempt =
                    serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?)
                        .map_err(|e| e.to_string())?;
                attempts.push(self.view(&attempt)?);
            }
        }
        attempts.sort_by(|a, b| a["id"].as_str().cmp(&b["id"].as_str()));
        Ok(serde_json::json!({"available":true,"attempts":attempts,"probe":self.probe}))
    }
    fn view(&self, a: &Attempt) -> Result<serde_json::Value, String> {
        let use_state = self
            .uses
            .get(&a.id)?
            .map(|v| format!("{:?}", v.state().state()))
            .unwrap_or_else(|| "NotAcquired".into());
        let state = if a.submitted_at.is_none() {
            "prepared"
        } else if let Some(o) = &a.batch_observation {
            if o.stopped() {
                if o.states.contains(&BatchState::Completed) {
                    "completed"
                } else if o.states.contains(&BatchState::Cancelled) {
                    "stopped"
                } else {
                    "failed"
                }
            } else if o.states.is_empty() || o.states.contains(&BatchState::Unknown) {
                "unknown"
            } else if a.cancel_requested {
                "cancel_requested"
            } else if o.states.contains(&BatchState::Running) {
                "running"
            } else {
                "queued"
            }
        } else if let Some(p) = &a.process {
            if p.running {
                if a.cancel_requested {
                    "cancel_requested"
                } else {
                    "running"
                }
            } else if a.cancel_requested {
                "stopped"
            } else if p.exit_code == Some(0) {
                "completed"
            } else {
                "failed"
            }
        } else {
            "unknown"
        };
        let logs = |name| {
            fs::read_to_string(
                self.data
                    .join(".remote/collected")
                    .join(a.id.as_str())
                    .join(name),
            )
            .unwrap_or_default()
        };
        Ok(
            serde_json::json!({"id":a.id,"clusterId":a.cluster.id,"host":a.cluster.host,"scheduler":a.cluster.scheduler,"account":a.cluster.account,"partition":a.cluster.partition,"directory":a.directory,"digest":a.digest,
            "samples":a.input.samples(),"repetitions":a.input.repetitions(),"useState":use_state,"state":state,"logs":{"stdout":logs("stdout.log"),"stderr":logs("stderr.log")},
            "outputs":a.outputs,"collected":!a.outputs.is_empty(),"error":a.error.as_ref().or(a.collection_error.as_ref()),"exitCode":a.process.as_ref().and_then(|p| p.exit_code),"jobId":a.batch.as_ref().map(|b| b.job_id)}),
        )
    }
    fn apply(&mut self, request: Request) -> Result<serde_json::Value, String> {
        match request {
            Request::State => return self.state(),
            Request::Artifact { id, digest } => {
                let a = self.load(&id)?;
                let output = a
                    .outputs
                    .iter()
                    .find(|o| o.sha256 == digest)
                    .ok_or("Original collected artifact not found")?;
                let path = self
                    .data
                    .join(".remote/artifacts")
                    .join(id.as_str())
                    .join(format!("{}-{}", digest.as_str(), output.path));
                let bytes = fs::read(path).map_err(|e| e.to_string())?;
                use sha2::{Digest, Sha256};
                if format!("{:x}", Sha256::digest(&bytes)) != digest.as_str() {
                    return Err("Collected artifact failed its fixed digest check".into());
                }
                use base64::Engine;
                return Ok(
                    serde_json::json!({"filename":output.path,"sha256":digest,"base64":base64::engine::general_purpose::STANDARD.encode(bytes)}),
                );
            }
            Request::Probe { cluster } => {
                let _ = self.inspect(&cluster)?;
            }
            Request::Prepare { cluster, input } => {
                if !cluster.workdir.is_absolute() {
                    return Err(
                        "Set an absolute remote working directory before preparation".into(),
                    );
                }
                if matches!(cluster.scheduler, Scheduler::Slurm) && cluster.partition.is_empty() {
                    return Err("Choose a Slurm partition before preparation".into());
                }
                let slurm = if matches!(cluster.scheduler, Scheduler::Slurm) {
                    Some(SlurmRequest {
                        constraints: BatchConstraints::new(
                            identity(cluster.partition.clone())?,
                            1,
                            256,
                            600,
                        )
                        .map_err(|e| e.to_string())?,
                        account: if cluster.account.is_empty() {
                            None
                        } else {
                            Some(identity(cluster.account.clone())?)
                        },
                    })
                } else {
                    None
                };
                let (probe, batch_cluster) = self.inspect(&cluster)?;
                let id: Identity = format!("remote-{}", uuid::Uuid::new_v4().simple())
                    .try_into()
                    .unwrap();
                let directory = cluster.workdir.join(id.as_str());
                let snapshot = snapshot(
                    &probe,
                    batch_cluster.as_ref().unwrap_or(&cluster.id),
                    &id,
                    now(),
                )?;
                let digest =
                    ContentDigest::of(&(&cluster, &input, &directory, &snapshot, QUADRATURE));
                let attempt = Attempt {
                    id,
                    cluster,
                    input,
                    directory,
                    digest,
                    snapshot,
                    slurm,
                    submitted_at: None,
                    process: None,
                    batch: None,
                    batch_observation: None,
                    cancel_requested: false,
                    outputs: vec![],
                    collection_error: None,
                    error: None,
                };
                // Persist the frozen intent before staging. A lost stage reply
                // preserves the original directory; prepare never reuses it.
                self.save(&attempt)?;
                let files = staged_files(&attempt.input);
                if let Err(error) = self
                    .transport(&attempt.cluster)?
                    .stage(&attempt.directory, &files)
                {
                    let mut a = attempt;
                    a.error = Some(error.clone());
                    self.save(&a)?;
                    return Err(error);
                }
            }
            Request::Submit { id, digest } => {
                let mut a = self.load(&id)?;
                if digest != a.digest {
                    return Err("Prepared inputs changed; review the current digest".into());
                }
                if a.submitted_at.is_some() {
                    return Err("Submission already requested; observe the original attempt, do not submit again".into());
                }
                if a.error.is_some() {
                    return Err("Preparation did not complete; prepare a new attempt".into());
                }
                let (probe, site) = self.inspect(&a.cluster)?;
                let current =
                    snapshot(&probe, site.as_ref().unwrap_or(&a.cluster.id), &a.id, now())?;
                if current.binding().unwrap().profile.id()
                    != a.snapshot.binding().unwrap().profile.id()
                {
                    return Err(
                        "Observed submission software changed; prepare and review a new attempt"
                            .into(),
                    );
                }
                let (_, effects) = self.uses.apply(
                    &id,
                    UseCommand::Begin(UseRequest {
                        id: id.clone(),
                        consumer: id.clone(),
                        snapshot: a.snapshot.clone(),
                    }),
                )?;
                if effects != vec![UseEffect::Acquire] {
                    return Err("Original Use already exists; reconcile without replay".into());
                }
                a.submitted_at = Some(now());
                self.save(&a)?; // durable no-replay intent before external execution
                let result = self.dispatch(&mut a);
                if let Err(error) = result {
                    a.error = Some(error.clone());
                    self.save(&a)?;
                    self.uses.apply(&id, UseCommand::Unknown)?;
                    return Err(error);
                }
                self.save(&a)?;
                self.uses.apply(
                    &id,
                    UseCommand::Acquired(receipt(&a, "original-owner-dispatched")),
                )?;
                self.observe(&mut a, false)?;
            }
            Request::Observe { id } => return self.action(id, false, false),
            Request::Cancel { id } => return self.action(id, true, false),
            Request::Collect { id } => return self.action(id, false, true),
        }
        self.state()
    }
    fn inspect(&mut self, cluster: &Cluster) -> Result<(SshProbe, Option<Identity>), String> {
        let transport = self.transport(cluster)?;
        let probe = transport.probe()?;
        let batch_cluster = if matches!(cluster.scheduler, Scheduler::Slurm) {
            Some(
                SlurmSite::probe_ssh(transport, PathBuf::new())?
                    .cluster()
                    .clone(),
            )
        } else {
            None
        };
        self.probe = Some(
            serde_json::json!({"clusterId":cluster.id,"endpoint":cluster.host,"host":probe.hostname,"platform":format!("{} {}",probe.system,probe.architecture),"python":probe.python,"cluster":batch_cluster}),
        );
        Ok((probe, batch_cluster))
    }
    fn slurm(&self, a: &Attempt) -> Result<SlurmSite, String> {
        let cluster = a
            .snapshot
            .binding()
            .ok_or("Missing original submission binding")?
            .owner
            .clone();
        SlurmSite::connect_ssh(self.transport(&a.cluster)?, PathBuf::new(), cluster)
    }
    fn dispatch(&self, a: &mut Attempt) -> Result<(), String> {
        match a.cluster.scheduler {
            Scheduler::Ssh => {
                a.process = Some(
                    self.transport(&a.cluster)?.start(
                        &a.directory,
                        &a.id,
                        Path::new("python3"),
                        &["entry.py".into()],
                        &staged_files(&a.input)
                            .iter()
                            .map(|f| (f.name.clone(), digest_bytes(&f.bytes)))
                            .collect::<Vec<_>>(),
                    )?,
                )
            }
            Scheduler::Slurm => {
                let request = a.slurm.as_ref().ok_or("Missing frozen Slurm request")?;
                let digest = digest_bytes(
                    &staged_files(&a.input)
                        .into_iter()
                        .find(|f| f.name == "entry.py")
                        .unwrap()
                        .bytes,
                );
                a.batch = Some(self.slurm(a)?.submit_staged(
                    SlurmInvocation {
                        operation: a.id.clone(),
                        constraints: request.constraints.clone(),
                        payload: digest,
                        entry: &a.directory.join("entry.py"),
                        directory: &a.directory,
                        account: request.account.as_ref(),
                    },
                    &self.path(&a.id).with_extension("submit-intent"),
                    &self.data.join("executions"),
                )?);
            }
        }
        Ok(())
    }
    fn action(
        &mut self,
        id: Identity,
        cancel: bool,
        collect: bool,
    ) -> Result<serde_json::Value, String> {
        let mut a = self.load(&id)?;
        if collect && !a.outputs.is_empty() && a.collection_error.is_none() {
            return self.state();
        }
        if a.submitted_at.is_none() {
            return Err("This attempt has not been submitted".into());
        }
        if cancel {
            a.cancel_requested = true;
            self.save(&a)?;
            self.uses.apply(&id, UseCommand::End)?;
        }
        match self.observe(&mut a, cancel) {
            Ok(()) => {
                if collect {
                    let stopped = a.batch_observation.as_ref().is_some_and(|o| o.stopped())
                        || a.process.as_ref().is_some_and(|p| !p.running);
                    if !stopped {
                        return Err("Outputs are not fixed while the original execution may still be running; remote path retained".into());
                    }
                    let mut names = vec![
                        "stdout.log".into(),
                        "stderr.log".into(),
                        "input.json".into(),
                        "method.py".into(),
                        "entry.py".into(),
                    ];
                    let completed = a.process.as_ref().is_some_and(|p| p.exit_code == Some(0))
                        || a.batch_observation
                            .as_ref()
                            .is_some_and(|o| o.states.contains(&BatchState::Completed));
                    if completed {
                        names.push("result.json".into());
                    }
                    if matches!(a.cluster.scheduler, Scheduler::Slurm) {
                        names.push("allocation.txt".into());
                    }
                    let transport = self.transport(&a.cluster)?;
                    let directory = self.data.join(".remote/artifacts").join(id.as_str());
                    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
                    let mut missing = vec![];
                    for name in names {
                        if a.outputs.iter().any(|o| o.path == name) {
                            continue;
                        }
                        match transport.collect(&a.directory, &[name]) {
                            Ok(files) => {
                                for file in files {
                                    let target = directory.join(format!(
                                        "{}-{}",
                                        file.sha256.as_str(),
                                        file.name
                                    ));
                                    if !target.exists() {
                                        let mut out = fs::OpenOptions::new()
                                            .write(true)
                                            .create_new(true)
                                            .open(target)
                                            .map_err(|e| e.to_string())?;
                                        out.write_all(&file.bytes)
                                            .and_then(|_| out.sync_all())
                                            .map_err(|e| e.to_string())?;
                                    }
                                    a.outputs.push(Output {
                                        path: file.name,
                                        reference: format!(
                                            "compute:{}:{}",
                                            id.as_str(),
                                            file.sha256.as_str()
                                        ),
                                        sha256: file.sha256,
                                    });
                                }
                            }
                            Err(error) => missing.push(error),
                        }
                    }
                    a.error = None; // collection reports any missing logs/files below
                    a.collection_error = (!missing.is_empty()).then(|| {
                        format!(
                            "Partial evidence collected; remote path retained. {}",
                            missing.join("; ")
                        )
                    });
                    self.save(&a)?;
                }
            }
            Err(error) => {
                a.error = Some(error.clone());
                self.save(&a)?;
                return Err(error);
            }
        }
        self.state()
    }
    fn observe(&mut self, a: &mut Attempt, cancel: bool) -> Result<(), String> {
        let transport = self.transport(&a.cluster)?;
        match a.cluster.scheduler {
            Scheduler::Ssh => {
                a.process = Some(if cancel {
                    transport.cancel(&a.directory, &a.id)?
                } else {
                    transport.observe(&a.directory, &a.id)?
                })
            }
            Scheduler::Slurm => {
                let submission = a.batch.as_ref().ok_or("Original Slurm submit response is unknown; reconcile the saved submission marker on the site, do not resubmit")?;
                let site = self.slurm(a)?;
                a.batch_observation = Some(if cancel {
                    site.cancel(&self.data.join("executions"), submission)?
                } else {
                    site.observe(&self.data.join("executions"), submission)?
                });
            }
        }
        // Log reads can fail independently of queue/process observation. Preserve
        // the execution facts and old local logs, and expose the collection error.
        let log_result =
            transport.collect(&a.directory, &["stdout.log".into(), "stderr.log".into()]);
        a.error = match log_result {
            Ok(files) => {
                let directory = self.data.join(".remote/collected").join(a.id.as_str());
                fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
                for file in files {
                    fs::write(directory.join(file.name), file.bytes).map_err(|e| e.to_string())?;
                }
                None
            }
            Err(error) => Some(format!("Execution observed; logs not collected: {error}")),
        };
        let stopped = a.batch_observation.as_ref().is_some_and(|o| o.stopped())
            || a.process.as_ref().is_some_and(|p| !p.running);
        if let Some(process) = &a.process {
            store_process_receipt(
                &self.data.join("executions"),
                &ProcessReceipt {
                    operation: a.id.clone(),
                    host: a.cluster.id.clone(),
                    payload: a.digest.clone(),
                    started: process.started_ms,
                    ended: process.ended_ms,
                    exit_code: process.exit_code,
                    unconfirmed: false,
                    entry: Some(a.directory.join("method.py").display().to_string()),
                    snapshot: Some(a.snapshot.digest()),
                    logs: vec!["stdout.log".into(), "stderr.log".into()],
                },
            )?;
        }
        self.save(a)?; // durable owner evidence precedes Use release
        let state = self
            .uses
            .get(&a.id)?
            .ok_or("Original Use missing")?
            .state()
            .state();
        if matches!(state, UseState::Acquiring | UseState::UnknownAcquire) {
            self.uses.apply(
                &a.id,
                UseCommand::Acquired(receipt(a, "original-owner-dispatched")),
            )?;
        }
        if stopped && state != UseState::Released {
            self.uses.apply(&a.id, UseCommand::End)?;
            self.uses.apply(
                &a.id,
                UseCommand::Released {
                    stopped: receipt(a, "original-owner-confirmed-stop"),
                    released: receipt(a, "original-owned-invocation-released"),
                },
            )?;
        }
        Ok(())
    }
}
fn digest_bytes(bytes: &[u8]) -> ContentDigest {
    use sha2::{Digest, Sha256};
    format!("{:x}", Sha256::digest(bytes)).try_into().unwrap()
}
fn staged_files(input: &Quadrature) -> Vec<StagedFile> {
    let bytes = serde_json::to_vec(input).expect("fixed method input");
    let entry = format!(
        "#!/usr/bin/env python3\nimport hashlib,os,sys\nfrom pathlib import Path\nfor name,expected in [('method.py','{}'),('input.json','{}')]:\n    if hashlib.sha256(Path(name).read_bytes()).hexdigest()!=expected: raise SystemExit('Prepared input changed: '+name)\nos.execv(sys.executable,[sys.executable,'method.py'])\n",
        digest_bytes(QUADRATURE.as_bytes()).as_str(),
        digest_bytes(&bytes).as_str()
    );
    vec![
        StagedFile {
            name: "method.py".into(),
            bytes: QUADRATURE.as_bytes().to_vec(),
            executable: false,
        },
        StagedFile {
            name: "input.json".into(),
            bytes,
            executable: false,
        },
        StagedFile {
            name: "entry.py".into(),
            bytes: entry.into_bytes(),
            executable: true,
        },
    ]
}
fn receipt(a: &Attempt, label: &str) -> OwnerReceipt {
    OwnerReceipt {
        use_id: a.id.clone(),
        snapshot: a.snapshot.digest(),
        target: None,
        receipt: ContentDigest::of(&(&a.id, &a.digest, label)),
    }
}
fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("system clock")
        .as_millis() as u64
}
fn identity(value: String) -> Result<Identity, String> {
    value
        .try_into()
        .map_err(|e: EnvironmentError| e.to_string())
}
fn snapshot(
    probe: &SshProbe,
    owner: &Identity,
    incarnation: &Identity,
    time: u64,
) -> Result<EnvironmentSnapshot, String> {
    let method = identity("compute.quadrature-v1".into())?;
    let version: Version = probe
        .python
        .clone()
        .try_into()
        .map_err(|e: EnvironmentError| e.to_string())?;
    let profile = SoftwareProfile::observed(
        ComponentObservation::new(
            method.clone(),
            identity(probe.system.clone())?,
            identity(probe.architecture.clone())?,
            BTreeMap::from([(
                identity("submission-python".into())?,
                SoftwareComponent::Native {
                    program: NativeProgram {
                        version: Some(version),
                        sha256: None,
                        status: NativeStatus::Observed,
                    },
                },
            )]),
        )
        .map_err(|e| e.to_string())?,
    );
    let requirements = EnvironmentRequirements::new(
        method.clone(),
        vec![Requirement::Profile {
            digest: profile.id().clone(),
        }],
        vec![],
    )
    .map_err(|e| e.to_string())?;
    EnvironmentSnapshot::capture(
        EnvironmentTemplate::new(method, "1".to_owned().try_into().unwrap(), requirements),
        EnvironmentBinding {
            owner: owner.clone(),
            incarnation: incarnation.clone(),
            observed_at_ms: time,
            profile,
        },
        time,
        1,
    )
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests;
