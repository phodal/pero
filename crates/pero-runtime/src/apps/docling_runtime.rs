//! Fixed Paper-only optional runtime. Only the trusted Host calls install after
//! native confirmation. App requests cannot supply packages, commands or paths.
use super::{AppName, AppStore};
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};

#[path = "docling_profile.rs"]
mod profile;
use profile::{HostPlatform, PYTHON_IDENTITY, Profile, PythonIdentity};
#[derive(Deserialize)]
struct Wheel {
    url: String,
    sha256: String,
    filename: String,
    #[serde(default)]
    size: u64,
}
const REVISION: &str = "8f39ad3c0b4c58e9c2d2c84a38465abf757272d8";
const MODEL: &str = "docling-project/docling-layout-heron";
const FILES: [(&str, &str); 3] = [
    (
        "config.json",
        "fdea30805ce2f5666b147fca941dcdd27ad468e27d6ed21902207d3da056a97d",
    ),
    (
        "preprocessor_config.json",
        "cd38cd59999e7a95d68e487fbe5132df3d4e5c32a0836add57e6126ba0c4eaf1",
    ),
    (
        "model.safetensors",
        "00333a43451945aaf89db8ca9c0a17e75d1537c17db60fdb91aa95f4c7929e0c",
    ),
];

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Component {
    Software,
    Model,
}
#[derive(Deserialize)]
#[serde(tag = "operation", rename_all = "lowercase", deny_unknown_fields)]
pub enum Request {
    Status {},
    Prepare { component: Component },
    Install { ticket: String },
    Cancel {},
    Revoke {},
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Status {
    state: String,
    software: String,
    model: String,
    #[serde(default)]
    software_approved: bool,
    #[serde(default)]
    model_approved: bool,
    component: Option<Component>,
    message: String,
    installer_supported: bool,
    #[serde(default)]
    profile: Option<Profile>,
    #[serde(default)]
    validation: String,
}
impl Default for Status {
    fn default() -> Self {
        Self {
            state: "idle".into(),
            software: "missing".into(),
            model: "missing".into(),
            software_approved: false,
            model_approved: false,
            component: None,
            message: "Optional Docling runtime has not been configured.".into(),
            installer_supported: false,
            profile: None,
            validation: String::new(),
        }
    }
}
struct State {
    status: Status,
    pending: Option<(String, Component)>,
    cancel: Arc<AtomicBool>,
    running: bool,
    closed: bool,
    worker: Option<std::thread::JoinHandle<()>>,
}
#[derive(Clone)]
pub struct DoclingRuntime {
    root: PathBuf,
    data: PathBuf,
    base_python: PathBuf,
    profile: Option<Profile>,
    state: Arc<Mutex<State>>,
    lease: Option<Arc<fs::File>>,
}

impl AppStore {
    pub fn shutdown_docling_runtime(&self) {
        if let Some(runtime) = &self.docling_runtime {
            runtime.shutdown();
        }
    }
    pub fn docling_runtime(&mut self, name: &AppName) -> Result<DoclingRuntime, String> {
        if name.as_str() != "paper-agent" || !self.installed.get(name).is_some_and(|a| a.enabled) {
            return Err("Optional Docling runtime is reserved for installed Paper".into());
        }
        if self.docling_runtime.is_none() {
            let base = self
                .python
                .select(name)
                .map(|p| p.executable())
                .unwrap_or_else(|| super::python::default_executable().into());
            let root = self
                .root
                .parent()
                .ok_or("App root needs parent")?
                .join("environment/paper-docling");
            self.docling_runtime = Some(DoclingRuntime::open(
                root,
                self.data.join("paper-agent/research-v1"),
                base,
            ));
        }
        Ok(self.docling_runtime.as_ref().unwrap().clone())
    }
}
impl DoclingRuntime {
    fn open(root: PathBuf, data: PathBuf, base_python: PathBuf) -> Self {
        let mut status: Status = fs::read(root.join("status.json"))
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default();
        let detected = Profile::for_host(&HostPlatform::current());
        let profile = detected.as_ref().ok().copied();
        // A new platform cannot inherit another profile's asset verification or
        // consent. Legacy untagged records belong only to the Linux profile.
        if status.profile != profile
            && !(status.profile.is_none() && profile == Some(Profile::LinuxX86))
        {
            status.software = "missing".into();
            status.component = None;
            status.software_approved = false;
            status.model_approved = false;
            status.state = "idle".into();
        }
        status.profile = profile;
        status.validation = profile.map_or("unsupported", Profile::validation).into();
        status.installer_supported = profile.is_some();
        if status.state == "ready" {
            status.state = "idle".into();
            status.message = "Previously configured runtime. Recheck availability in Paper; saved status is not a fresh runtime verification.".into();
        }
        if status.state == "installing" {
            status.state = "interrupted".into();
            status.message = "Host stopped during installation. Review and approve a retry; partial files are not ready.".into();
        }
        let availability = detected.and_then(|p| {
            let python = probe_python(&base_python, None)?;
            p.validate_python(&python)?;
            Ok(p)
        });
        match availability {
            Ok(profile) if status.state == "idle" && status.software == "missing" => {
                status.message = format!(
                    "Optional {} runtime. {}",
                    profile.label(),
                    profile.prerequisites()
                );
            }
            Ok(_) => {}
            Err(error) => {
                status.installer_supported = false;
                status.message = error;
            }
        }
        Self {
            root,
            data,
            base_python,
            profile,
            state: Arc::new(Mutex::new(State {
                status,
                pending: None,
                cancel: Arc::new(AtomicBool::new(false)),
                running: false,
                closed: false,
                worker: None,
            })),
            lease: None,
        }
    }
    pub fn execute(&self, request: Request) -> Result<serde_json::Value, String> {
        let mut state = self.state.lock().map_err(|e| e.to_string())?;
        if state.closed {
            return Err("Host is shutting down".into());
        }
        match request {
            Request::Status {} => {}
            Request::Prepare { component } => {
                if !state.status.installer_supported {
                    return Err(state.status.message.clone());
                }
                if state.running {
                    return Err("An optional component is already installing".into());
                }
                let ticket = uuid::Uuid::new_v4().to_string();
                state.pending = Some((ticket.clone(), component));
                let profile = self
                    .profile
                    .ok_or("No supported optional runtime profile")?;
                let summary = match component {
                    Component::Software => {
                        let wheels: Vec<Wheel> =
                            serde_json::from_str(profile.wheels()).map_err(|e| e.to_string())?;
                        let bytes = match profile {
                            Profile::LinuxX86 => 326_669_963,
                            Profile::MacArm => wheels.iter().map(|w| w.size).sum::<u64>(),
                        };
                        let source = match profile {
                            Profile::LinuxX86 => {
                                "https://pypi.org and CPU PyTorch from https://download.pytorch.org/whl/cpu"
                            }
                            Profile::MacArm => {
                                "https://pypi.org (including native CPU-capable PyTorch, ocrmac and PyObjC)"
                            }
                        };
                        format!(
                            "Install the pinned Docling 2.146.0 {} software profile in a separate Paper runtime ({} verified wheels, {bytes} bytes of downloads; allow about 2 GiB installed plus download cache)? Packages come from {source}. Docling is MIT licensed; dependencies retain their own licenses. This will not modify Paper's normal Python environment or download the Heron model. {} No PDF is uploaded.\nAll wheel URLs and SHA-256 hashes are fixed in this Host release (manifest SHA-256: {:x}).",
                            profile.label(),
                            wheels.len(),
                            profile.prerequisites(),
                            Sha256::digest(profile.wheels().as_bytes())
                        )
                    }
                    Component::Model => {
                        format!(
                            "Download the Apache-2.0 Docling Heron layout model (171,662,708 bytes) from https://huggingface.co/docling-project/docling-layout-heron/tree/8f39ad3c0b4c58e9c2d2c84a38465abf757272d8 into the optional Paper runtime? Three fixed files will be SHA-256 verified. This does not install software or upload a PDF.\nSHA-256: {}",
                            FILES
                                .iter()
                                .map(|(n, h)| format!("{n}: {h}"))
                                .collect::<Vec<_>>()
                                .join("; ")
                        )
                    }
                };
                return Ok(
                    serde_json::json!({"state":"requires-approval", "ticket":ticket, "component":component, "summary":summary}),
                );
            }
            Request::Install { ticket } => {
                if state.running {
                    return Err("Installation is already running".into());
                }
                let Some((expected, component)) = state.pending.as_ref() else {
                    return Err("Request a new Host confirmation first".into());
                };
                if ticket != *expected {
                    return Err("Unknown or expired installation confirmation".into());
                }
                let component = *component;
                fs::create_dir_all(&self.root).map_err(|e| e.to_string())?;
                let lease = fs::OpenOptions::new()
                    .create(true)
                    .truncate(false)
                    .read(true)
                    .write(true)
                    .open(self.root.join("installer.lock"))
                    .map_err(|e| e.to_string())?;
                lease.try_lock_exclusive().map_err(|_| "A previous Host installer is still using this runtime; wait for it to stop before retrying".to_string())?;
                write_json(
                    &self.data.join("docling-runtime.json"),
                    &serde_json::json!({"disabled":true}),
                )?;
                state.pending = None;
                state.running = true;
                state.cancel = Arc::new(AtomicBool::new(false));
                match component {
                    Component::Software => state.status.software_approved = false,
                    Component::Model => state.status.model_approved = false,
                }
                state.status.state = "installing".into();
                state.status.component = Some(component);
                state.status.message = "Preparing optional component".into();
                if let Err(error) = self.save(&state.status) {
                    state.running = false;
                    state.status.state = "failed".into();
                    return Err(error);
                }
                let mut this = self.clone();
                this.lease = Some(Arc::new(lease));
                let cancel = state.cancel.clone();
                state.worker = Some(std::thread::spawn(move || this.install(component, cancel)));
            }
            Request::Cancel {} | Request::Revoke {} => {
                let revoke = matches!(request, Request::Revoke {});
                state.pending = None;
                state.cancel.store(true, Ordering::SeqCst);
                if revoke {
                    write_json(
                        &self.data.join("docling-runtime.json"),
                        &serde_json::json!({"disabled":true}),
                    )?;
                    state.status.state = "revoked".into();
                    state.status.software_approved = false;
                    state.status.model_approved = false;
                    state.status.message = "Optional runtime access revoked. Files are retained; restoring requires confirmation.".into();
                } else if state.status.state == "installing" {
                    state.status.message = "Cancellation requested; waiting for the installer to stop. A pending network read can take up to 120 seconds.".into();
                } else {
                    state.status.state = "cancelled".into();
                    state.status.message = "Setup cancelled.".into();
                }
                self.save(&state.status)?;
            }
        }
        serde_json::to_value(&state.status).map_err(|e| e.to_string())
    }
    pub fn shutdown(&self) {
        let worker = {
            let Ok(mut state) = self.state.lock() else {
                return;
            };
            state.closed = true;
            state.pending = None;
            state.cancel.store(true, Ordering::SeqCst);
            state.worker.take()
        };
        if let Some(worker) = worker {
            let _ = worker.join();
        }
    }
    fn save(&self, status: &Status) -> Result<(), String> {
        write_json(&self.root.join("status.json"), status)
    }
    fn progress(&self, message: String) {
        if let Ok(mut state) = self.state.lock() {
            if state.status.state == "installing" {
                state.status.message = message;
                let _ = self.save(&state.status);
            }
        }
    }
    fn install(&self, component: Component, cancel: Arc<AtomicBool>) {
        let result = match component {
            Component::Software => self.software(&cancel),
            Component::Model => self.model(&cancel),
        };
        let activation = if result.is_ok() && self.python().is_file() && self.verify_model().is_ok()
        {
            self.verify_software(&cancel)
        } else {
            Err("The other component is not yet verified".into())
        };
        let Ok(mut state) = self.state.lock() else {
            return;
        };
        state.running = false;
        state.status.component = None;
        if state.status.state == "revoked" {
            let _ = self.save(&state.status);
            return;
        }
        if cancel.load(Ordering::SeqCst) {
            state.status.state = "cancelled".into();
            state.status.message = "Setup cancelled. Retry requires a new confirmation.".into();
        } else if let Err(error) = result {
            state.status.state = "failed".into();
            state.status.message = error;
        } else {
            match component {
                Component::Software => {
                    state.status.software = "ready".into();
                    state.status.software_approved = true;
                }
                Component::Model => {
                    state.status.model = "ready".into();
                    state.status.model_approved = true;
                }
            }
            state.status.state = "idle".into();
            state.status.message =
                "Component installed and verified. Approve the other component if needed.".into();
            if state.status.software == "ready"
                && state.status.model == "ready"
                && state.status.software_approved
                && state.status.model_approved
            {
                let result = activation.and_then(|_| write_json(&self.data.join("docling-runtime.json"), &serde_json::json!({"python":self.python(), "artifactsPath":self.root.join("artifacts"), "profile":self.profile})));
                match result {
                    Ok(()) => {
                        state.status.state = "ready".into();
                        state.status.message = format!(
                            "Optional runtime is ready. Recheck availability in Paper. {}",
                            self.profile.map_or("", Profile::prerequisites)
                        );
                    }
                    Err(error) => {
                        state.status.state = "failed".into();
                        state.status.message = error;
                    }
                }
            }
        }
        if let Err(error) = self.save(&state.status) {
            state.status.state = "failed".into();
            state.status.message = error;
        }
    }
    fn python(&self) -> PathBuf {
        self.root
            .join(self.profile.map_or("venv", Profile::venv_name))
            .join("bin/python")
    }
    fn software(&self, cancel: &AtomicBool) -> Result<(), String> {
        fs::create_dir_all(&self.root).map_err(|e| e.to_string())?;
        let profile = self
            .profile
            .ok_or("No supported optional runtime profile")?;
        profile.validate_python(&probe_python(&self.base_python, Some(cancel))?)?;
        self.run(
            Command::new(&self.base_python)
                .args(["-I", "-m", "venv", "--without-pip"])
                .arg(self.root.join(profile.venv_name())),
            cancel,
        )?;
        // venv --without-pip avoids ensurepip's subprocess. Bootstrap CPython's
        // own bundled pip wheel in this same supervised process, offline.
        self.run(Command::new(self.python()).args(["-I", "-c", "import ensurepip,pathlib,runpy,sys; w=list((pathlib.Path(ensurepip.__file__).parent/'_bundled').glob('pip-*.whl')); assert len(w)==1, 'CPython bundled pip wheel is required'; sys.path.insert(0,str(w[0])); sys.argv=['pip','--isolated','--no-cache-dir','--disable-pip-version-check','install','--no-index','--no-deps','--no-compile',str(w[0])]; runpy.run_module('pip',run_name='__main__')"]), cancel)?;
        let wheels: Vec<Wheel> =
            serde_json::from_str(profile.wheels()).map_err(|e| e.to_string())?;
        let cache = self.root.join("wheels");
        fs::create_dir_all(&cache).map_err(|e| e.to_string())?;
        let client = download_client()?;
        let mut files = Vec::new();
        for wheel in wheels {
            self.progress(format!("Preparing verified {}", wheel.filename));
            let path = cache.join(&wheel.filename);
            self.download(
                &client,
                &wheel.url,
                &path,
                &wheel.sha256,
                600_000_000,
                cancel,
            )?;
            files.push(path);
        }
        self.progress("Installing SHA-256 verified local wheels in the isolated runtime".into());
        self.run(
            Command::new(self.python())
                .args([
                    "-I",
                    "-m",
                    "pip",
                    "--isolated",
                    "--no-cache-dir",
                    "install",
                    "--only-binary=:all:",
                    "--no-deps",
                    "--no-index",
                    "--no-compile",
                    "--force-reinstall",
                ])
                .args(files),
            cancel,
        )?;
        self.verify_software(cancel)
    }
    fn verify_software(&self, cancel: &AtomicBool) -> Result<(), String> {
        let profile = self
            .profile
            .ok_or("No supported optional runtime profile")?;
        profile.validate_python(&probe_python(&self.python(), Some(cancel))?)?;
        let requirements: Vec<_> = profile
            .requirements()
            .lines()
            .filter(|s| !s.is_empty() && !s.starts_with('#'))
            .collect();
        self.run(Command::new(self.python()).args(["-I", "-B", "-c", "import importlib.metadata as m,sys; assert all(m.version(n)==v for n,v in (r.split('==') for r in sys.argv[1:])); from docling.document_converter import DocumentConverter; import torch,torchvision,transformers,docling_parse,pypdfium2; assert hasattr(pypdfium2,'PdfDocument')"]).args(requirements), cancel)?;
        self.run(
            Command::new(self.python()).args([
                "-I",
                "-m",
                "pip",
                "--isolated",
                "--no-cache-dir",
                "check",
            ]),
            cancel,
        )?;
        if profile == Profile::MacArm {
            self.run(Command::new(self.python()).args(["-I", "-B", "-c", "from ocrmac.ocrmac import OCR; import Vision; request=Vision.VNRecognizeTextRequest.alloc().init(); request.setRecognitionLevel_(Vision.VNRequestTextRecognitionLevelAccurate); languages,error=request.supportedRecognitionLanguagesAndReturnError_(None); assert error is None and 'en-US' in languages, 'Apple Vision English OCR is unavailable'"]), cancel)?;
        }
        Ok(())
    }

    fn run(&self, command: &mut Command, cancel: &AtomicBool) -> Result<(), String> {
        if cancel.load(Ordering::SeqCst) {
            return Err("Cancelled".into());
        }
        let logfile = self.root.join("installation.log");
        let log = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&logfile)
            .map_err(|e| e.to_string())?;
        let stderr = log.try_clone().map_err(|e| e.to_string())?;
        command
            .env_remove("PYTHONPATH")
            .env_remove("PYTHONHOME")
            .env("HF_HUB_OFFLINE", "1")
            .env("PIP_DISABLE_PIP_VERSION_CHECK", "1")
            .stdin(Stdio::null())
            .stdout(log)
            .stderr(stderr);
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            command.process_group(0);
        }
        #[cfg(unix)]
        {
            use std::os::{fd::AsRawFd, unix::process::CommandExt};
            #[cfg(target_os = "linux")]
            let parent = std::process::id() as libc::pid_t;
            let lock_fd = self.lease.as_ref().map(|file| file.as_raw_fd());
            // Every Unix child retains the runtime lease across exec. On macOS
            // an in-flight fixed pip command may finish after a Host crash, but
            // cannot overlap a new installer. Linux additionally kills it at
            // parent death. No source build or dependency subprocess is used.
            unsafe {
                command.pre_exec(move || {
                    #[cfg(target_os = "linux")]
                    {
                        if libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGKILL) != 0 {
                            return Err(std::io::Error::last_os_error());
                        }
                        if libc::getppid() != parent {
                            return Err(std::io::Error::other(
                                "Host stopped before installer start",
                            ));
                        }
                    }
                    if let Some(fd) = lock_fd {
                        let flags = libc::fcntl(fd, libc::F_GETFD);
                        if flags < 0
                            || libc::fcntl(fd, libc::F_SETFD, flags & !libc::FD_CLOEXEC) < 0
                        {
                            return Err(std::io::Error::last_os_error());
                        }
                    }
                    Ok(())
                });
            }
        }
        let mut child = command
            .spawn()
            .map_err(|e| format!("Cannot start optional installer: {e}"))?;
        let deadline = Instant::now() + Duration::from_secs(1200);
        loop {
            if cancel.load(Ordering::SeqCst) || Instant::now() > deadline {
                #[cfg(unix)]
                unsafe {
                    libc::kill(-(child.id() as i32), libc::SIGKILL);
                }
                let _ = child.kill();
                let _ = child.wait();
                return Err("Installer cancelled or exceeded 20 minutes. Review installation.log and approve a retry.".into());
            }
            if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
                return if status.success() {
                    Ok(())
                } else {
                    Err(format!(
                        "Optional software command failed ({status}). Review {} and approve a retry.",
                        logfile.display()
                    ))
                };
            }
            std::thread::sleep(Duration::from_millis(100));
        }
    }
    fn model_folder(&self) -> PathBuf {
        self.root
            .join("artifacts/docling-project--docling-layout-heron")
    }
    fn verify_model(&self) -> Result<(), String> {
        for (name, expected) in FILES {
            let bytes = fs::read(self.model_folder().join(name)).map_err(|e| e.to_string())?;
            if format!("{:x}", Sha256::digest(bytes)) != expected {
                return Err(format!("Heron {name} SHA-256 mismatch"));
            }
        }
        Ok(())
    }
    fn download(
        &self,
        client: &reqwest::blocking::Client,
        url: &str,
        path: &Path,
        expected: &str,
        limit: usize,
        cancel: &AtomicBool,
    ) -> Result<(), String> {
        if cancel.load(Ordering::SeqCst) {
            return Err("Cancelled".into());
        }
        if fs::read(path).is_ok_and(|bytes| format!("{:x}", Sha256::digest(bytes)) == expected) {
            return Ok(());
        }
        let mut response = client
            .get(url)
            .send()
            .and_then(|r| r.error_for_status())
            .map_err(|e| format!("{e:?}"))?;
        let partial = path.with_extension("partial");
        let mut output = fs::File::create(&partial).map_err(|e| e.to_string())?;
        let mut hasher = Sha256::new();
        let mut total = 0usize;
        let mut buffer = [0u8; 65536];
        loop {
            if cancel.load(Ordering::SeqCst) {
                return Err(
                    "Cancelled; the current network read may take up to its timeout to stop".into(),
                );
            }
            let n = response.read(&mut buffer).map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            total += n;
            if total > limit {
                return Err("Download exceeds fixed file limit".into());
            }
            hasher.update(&buffer[..n]);
            output.write_all(&buffer[..n]).map_err(|e| e.to_string())?;
        }
        if format!("{:x}", hasher.finalize()) != expected {
            return Err(format!(
                "{} SHA-256 mismatch",
                path.file_name().unwrap_or_default().to_string_lossy()
            ));
        }
        output.sync_all().map_err(|e| e.to_string())?;
        fs::rename(partial, path).map_err(|e| e.to_string())
    }

    fn model(&self, cancel: &AtomicBool) -> Result<(), String> {
        let folder = self.model_folder();
        fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
        let client = download_client()?;
        for (name, expected) in FILES {
            if cancel.load(Ordering::SeqCst) {
                return Err("Cancelled".into());
            }
            let path = folder.join(name);
            if fs::read(&path).is_ok_and(|bytes| format!("{:x}", Sha256::digest(bytes)) == expected)
            {
                continue;
            }
            self.progress(format!("Downloading pinned Heron {name}"));
            self.download(
                &client,
                &format!("https://huggingface.co/{MODEL}/resolve/{REVISION}/{name}"),
                &path,
                expected,
                180_000_000,
                cancel,
            )?;
        }
        self.verify_model()
    }
}
fn probe_python(path: &Path, cancel: Option<&AtomicBool>) -> Result<PythonIdentity, String> {
    let mut child = Command::new(path)
        .args(["-I", "-S", "-B", "-c", PYTHON_IDENTITY])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Cannot inspect the selected Paper interpreter: {e}. Select an existing compatible CPython 3.12 environment; this installer does not acquire Python."))?;
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        if cancel.is_some_and(|c| c.load(Ordering::SeqCst)) || Instant::now() > deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Python identity check cancelled or exceeded 10 seconds.".into());
        }
        if child.try_wait().map_err(|e| e.to_string())?.is_some() {
            break;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    let output = child.wait_with_output().map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err("Cannot inspect the selected Paper interpreter. Select an existing compatible CPython 3.12 environment; this installer does not acquire Python.".into());
    }
    serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("Invalid Python interpreter identity: {e}"))
}

fn download_client() -> Result<reqwest::blocking::Client, String> {
    let mut builder = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(120))
        .connect_timeout(Duration::from_secs(20))
        .https_only(true);
    // Honor the Host's existing CA bundle, as Python/OpenSSL do. This neither
    // modifies system trust nor disables certificate/hostname verification.
    if let Some(path) = std::env::var_os("SSL_CERT_FILE") {
        let bytes =
            fs::read(path).map_err(|e| format!("Cannot read configured Host CA bundle: {e}"))?;
        let certificates =
            reqwest::Certificate::from_pem_bundle(&bytes).map_err(|e| e.to_string())?;
        if certificates.is_empty() {
            return Err("Configured Host CA bundle contains no certificates".into());
        }
        for certificate in certificates {
            builder = builder.add_root_certificate(certificate);
        }
    }
    builder.build().map_err(|e| e.to_string())
}

fn write_json(path: &Path, value: &impl Serialize) -> Result<(), String> {
    fs::create_dir_all(path.parent().ok_or("Missing parent")?).map_err(|e| e.to_string())?;
    let temporary = path.with_extension("json.tmp");
    fs::write(
        &temporary,
        serde_json::to_vec(value).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    fs::rename(temporary, path).map_err(|e| e.to_string())
}

#[cfg(test)]
#[path = "docling_runtime_test.rs"]
mod tests;
