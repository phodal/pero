//! Private Host/App coordination of existing scientific attempts. This endpoint
//! cannot launch commands, approve science, select software, or install anything.
use crate::{environment_use_store::EnvironmentUses, environments::*};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs,
    io::{BufRead, BufReader, Read, Write},
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicU32, Ordering},
    },
    thread::JoinHandle,
};

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Native {
    path: PathBuf,
    sha256: ContentDigest,
    version: Version,
}
#[derive(Deserialize)]
#[serde(tag = "operation", rename_all = "snake_case", deny_unknown_fields)]
enum Command {
    Begin {
        id: Identity,
        consumer: Identity,
        approval: ContentDigest,
        profile: LockedPythonProfile,
        #[serde(default)]
        native: Option<Native>,
    },
    Started {
        id: Identity,
        pid: u32,
        parent: u32,
    },
    Finish {
        id: Identity,
    },
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Envelope {
    token: String,
    request: Command,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Owner {
    group: u32,
    pid: Option<u32>,
    approval: ContentDigest,
}

pub(super) struct ScientificUses {
    address: std::net::SocketAddr,
    token: String,
    group: Arc<AtomicU32>,
    stopped: Arc<AtomicBool>,
    worker: Option<JoinHandle<()>>,
}
impl ScientificUses {
    pub fn start(app: &str, data: &Path) -> Result<Option<Self>, String> {
        if !matches!(app, "control-lab" | "paper-agent") {
            return Ok(None);
        }
        #[cfg(not(unix))]
        return Ok(None); // No unsupported process-group attestation.
        let directory = data.join(".compute/uses");
        fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
        let store = EnvironmentUses::open(&directory.join("uses.sqlite"))?;
        let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|e| e.to_string())?;
        let address = listener.local_addr().map_err(|e| e.to_string())?;
        let token = uuid::Uuid::new_v4().to_string();
        let stopped = Arc::new(AtomicBool::new(false));
        let group = Arc::new(AtomicU32::new(0));
        let (secret, done, process_group) = (token.clone(), stopped.clone(), group.clone());
        let app = app.to_owned();
        let data = data.to_owned();
        let worker = std::thread::spawn(move || {
            let mut store = store;
            // On restart, only absent original OS groups prove prior children stopped.
            if let Err(error) = recover(&mut store, &directory) {
                eprintln!("Scientific Use recovery: {error}");
            }
            for stream in listener.incoming() {
                if done.load(Ordering::SeqCst) {
                    break;
                }
                let Ok(mut stream) = stream else {
                    break;
                };
                let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(5)));
                let _ = stream.set_write_timeout(Some(std::time::Duration::from_secs(5)));
                let result = (|| {
                    let mut line = String::new();
                    BufReader::new(&stream)
                        .take(65537)
                        .read_line(&mut line)
                        .map_err(|e| e.to_string())?;
                    if line.len() > 65536 || !line.ends_with('\n') {
                        return Err("Invalid scientific receipt frame".into());
                    }
                    let envelope: Envelope =
                        serde_json::from_str(&line).map_err(|e| e.to_string())?;
                    if envelope.token != secret {
                        return Err("Private scientific owner required".into());
                    }
                    apply(
                        &mut store,
                        &directory,
                        &data,
                        &app,
                        process_group.load(Ordering::SeqCst),
                        envelope.request,
                    )
                })();
                let response = match result {
                    Ok(value) => serde_json::json!({"value":value}),
                    Err(error) => serde_json::json!({"error":error}),
                };
                let _ = writeln!(stream, "{response}");
            }
            if let Err(error) =
                stop_owned_groups(&store, &directory, process_group.load(Ordering::SeqCst))
            {
                eprintln!("Scientific group shutdown: {error}");
            }
            if let Err(error) = recover(&mut store, &directory) {
                eprintln!("Scientific Use shutdown: {error}");
            }
        });
        Ok(Some(Self {
            address,
            token,
            group,
            stopped,
            worker: Some(worker),
        }))
    }
    pub fn configure(&self, command: &mut std::process::Command) {
        command
            .env("PERO_SCIENTIFIC_USE_ADDRESS", self.address.to_string())
            .env("PERO_SCIENTIFIC_USE_TOKEN", &self.token);
    }
    pub fn bind(&self, group: u32) {
        self.group.store(group, Ordering::SeqCst);
    }
}
impl Drop for ScientificUses {
    fn drop(&mut self) {
        self.stopped.store(true, Ordering::SeqCst);
        let _ = TcpStream::connect(self.address); // Wake accept; no timed shutdown race.
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}
fn receipt(state: &EnvironmentUse, label: &str) -> OwnerReceipt {
    OwnerReceipt {
        use_id: state.request().id.clone(),
        snapshot: state.request().snapshot.digest(),
        target: None,
        receipt: ContentDigest::of(&(state.request(), label)),
    }
}
fn absent(pid: i32) -> bool {
    #[cfg(unix)]
    {
        unsafe {
            libc::kill(pid, 0) == -1
                && std::io::Error::last_os_error().raw_os_error() == Some(libc::ESRCH)
        }
    }
    #[cfg(not(unix))]
    {
        let _ = pid;
        false
    }
}
fn owner_path(directory: &Path, id: &Identity) -> PathBuf {
    directory.join(format!("{}.owner.json", id.as_str()))
}
fn save_owner(path: &Path, owner: &Owner) -> Result<(), String> {
    let pending = path.with_extension("pending");
    fs::write(
        &pending,
        serde_json::to_vec(owner).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    fs::rename(pending, path).map_err(|e| e.to_string())
}
fn apply(
    store: &mut EnvironmentUses,
    directory: &Path,
    data: &Path,
    app: &str,
    group: u32,
    command: Command,
) -> Result<EnvironmentUse, String> {
    match command {
        Command::Begin {
            id,
            consumer,
            approval,
            profile,
            native,
        } => {
            if group == 0 {
                return Err("App owner is not attached".into());
            }
            let selected: LockedPythonProfile = serde_json::from_slice(
                &fs::read(data.join(".compute/binding.json")).map_err(|e| e.to_string())?,
            )
            .map_err(|e| e.to_string())?;
            if ContentDigest::of(&profile) != ContentDigest::of(&selected) {
                return Err("Compute selection changed before attempt admission".into());
            }
            if app == "paper-agent" {
                require_paper_approval(data, &consumer, &approval)?;
            }
            let observation = &profile.observation;
            let version = observation
                .version
                .split('.')
                .map(str::parse::<u16>)
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            if version.len() != 3 {
                return Err("Invalid observed Python version".into());
            }
            let mut components = BTreeMap::from([
                (
                    "python"
                        .to_owned()
                        .try_into()
                        .map_err(|e: EnvironmentError| e.to_string())?,
                    SoftwareComponent::Python {
                        version: PythonVersion {
                            major: version[0],
                            minor: version[1],
                            patch: version[2],
                        },
                        sha256: Some(
                            observation
                                .executable_sha256
                                .clone()
                                .try_into()
                                .map_err(|e: EnvironmentError| e.to_string())?,
                        ),
                        packages: observation
                            .packages
                            .iter()
                            .map(|(name, version)| {
                                Ok((name.clone().try_into()?, Some(version.clone().try_into()?)))
                            })
                            .collect::<Result<_, EnvironmentError>>()
                            .map_err(|e| e.to_string())?,
                    },
                ),
                (
                    "installation".to_owned().try_into().unwrap(),
                    SoftwareComponent::Native {
                        program: NativeProgram {
                            version: Some(
                                profile
                                    .lock_sha256
                                    .clone()
                                    .try_into()
                                    .map_err(|e: EnvironmentError| e.to_string())?,
                            ),
                            sha256: Some(ContentDigest::of(&profile)),
                            status: NativeStatus::Observed,
                        },
                    },
                ),
            ]);
            if let Some(native) = native {
                if !native.path.is_absolute()
                    || super::uv_tool::sha(&fs::read(&native.path).map_err(|e| e.to_string())?)
                        != String::from(native.sha256.clone())
                {
                    return Err("Native executable changed before admission".into());
                }
                components.insert(
                    "ngspice".to_owned().try_into().unwrap(),
                    SoftwareComponent::Native {
                        program: NativeProgram {
                            version: Some(native.version),
                            sha256: Some(native.sha256),
                            status: NativeStatus::Observed,
                        },
                    },
                );
            }
            let method: Identity = format!("{app}.compute")
                .try_into()
                .map_err(|e: EnvironmentError| e.to_string())?;
            let software = SoftwareProfile::observed(
                ComponentObservation::new(
                    method.clone(),
                    observation
                        .platform
                        .clone()
                        .try_into()
                        .map_err(|e: EnvironmentError| e.to_string())?,
                    observation
                        .machine
                        .clone()
                        .try_into()
                        .map_err(|e: EnvironmentError| e.to_string())?,
                    components,
                )
                .map_err(|e| e.to_string())?,
            );
            let requirements = EnvironmentRequirements::new(
                method.clone(),
                vec![Requirement::Profile {
                    digest: software.id().clone(),
                }],
                vec![],
            )
            .map_err(|e| e.to_string())?;
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|e| e.to_string())?
                .as_millis() as u64;
            let snapshot = EnvironmentSnapshot::capture(
                EnvironmentTemplate::new(
                    method.clone(),
                    "1".to_owned().try_into().unwrap(),
                    requirements,
                ),
                EnvironmentBinding {
                    owner: method,
                    incarnation: format!("app-{group}").try_into().unwrap(),
                    observed_at_ms: now,
                    profile: software,
                },
                now,
                1,
            )
            .map_err(|e| e.to_string())?;
            let (state, effects) = store.apply(
                &id,
                UseCommand::Begin(UseRequest {
                    id: id.clone(),
                    consumer,
                    snapshot,
                }),
            )?;
            if effects != vec![UseEffect::Acquire] {
                return Err(
                    "Use already exists; reconcile the original attempt, do not replay".into(),
                );
            }
            save_owner(
                &owner_path(directory, &id),
                &Owner {
                    group,
                    pid: None,
                    approval,
                },
            )?;
            Ok(state)
        }
        Command::Started { id, pid, parent } => {
            let path = owner_path(directory, &id);
            let mut owner: Owner =
                serde_json::from_slice(&fs::read(&path).map_err(|e| e.to_string())?)
                    .map_err(|e| e.to_string())?;
            #[cfg(unix)]
            let belongs = pid > 0
                && pid <= i32::MAX as u32
                && parent > 0
                && parent <= i32::MAX as u32
                && unsafe { libc::getpgid(pid as i32) } == pid as i32
                && unsafe { libc::getpgid(parent as i32) } == group as i32;
            #[cfg(not(unix))]
            let belongs = false;
            if owner.group != group || owner.pid.is_some() || !belongs {
                return Err(
                    "Scientific child is not an unregistered member of this App process group"
                        .into(),
                );
            }
            let observed = std::process::Command::new("/bin/ps")
                .args(["-o", "ppid=", "-p", &pid.to_string()])
                .output()
                .map_err(|e| e.to_string())?;
            if !observed.status.success()
                || String::from_utf8_lossy(&observed.stdout)
                    .trim()
                    .parse::<u32>()
                    .ok()
                    != Some(parent)
            {
                return Err("Scientific child has a different OS parent".into());
            }
            let state = store.get(&id)?.ok_or("Unknown Use")?.state().clone();
            owner.pid = Some(pid);
            save_owner(&path, &owner)?;
            store
                .apply(
                    &id,
                    UseCommand::Acquired(receipt(&state, "registered-gated-child")),
                )
                .map(|v| v.0)
        }
        Command::Finish { id } => {
            let owner: Owner = serde_json::from_slice(
                &fs::read(owner_path(directory, &id)).map_err(|e| e.to_string())?,
            )
            .map_err(|e| e.to_string())?;
            if owner.group != group {
                return Err("Use belongs to the original App owner".into());
            }
            let (state, _) = store.apply(&id, UseCommand::End)?;
            if state.state() == UseState::Released {
                return Ok(state);
            }
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(1);
            while owner.pid.is_some_and(|pid| !absent(-(pid as i32)))
                && std::time::Instant::now() < deadline
            {
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
            if !owner.pid.is_some_and(|pid| absent(-(pid as i32))) {
                store.apply(&id, UseCommand::Unknown)?;
                return Err("Scientific process stop is not confirmed; Use remains unknown".into());
            }
            store
                .apply(
                    &id,
                    UseCommand::Released {
                        stopped: receipt(&state, "os-scientific-group-absent"),
                        released: receipt(&state, "original-owner-released"),
                    },
                )
                .map(|v| v.0)
        }
    }
}
fn stop_owned_groups(store: &EnvironmentUses, directory: &Path, group: u32) -> Result<(), String> {
    for file in fs::read_dir(directory).map_err(|e| e.to_string())? {
        let path = file.map_err(|e| e.to_string())?.path();
        let Some(name) = path
            .file_name()
            .and_then(|n| n.to_str())
            .and_then(|n| n.strip_suffix(".owner.json"))
        else {
            continue;
        };
        let id: Identity = name
            .to_owned()
            .try_into()
            .map_err(|e: EnvironmentError| e.to_string())?;
        if store
            .get(&id)?
            .is_none_or(|r| r.state().state() == UseState::Released)
        {
            continue;
        }
        let owner: Owner = serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        if owner.group == group {
            if let Some(pid) = owner.pid {
                crate::owned_process::stop_process_group(pid).map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(())
}
fn recover(store: &mut EnvironmentUses, directory: &Path) -> Result<(), String> {
    for file in fs::read_dir(directory).map_err(|e| e.to_string())? {
        let path = file.map_err(|e| e.to_string())?.path();
        let Some(name) = path
            .file_name()
            .and_then(|n| n.to_str())
            .and_then(|n| n.strip_suffix(".owner.json"))
        else {
            continue;
        };
        let id: Identity = name
            .to_owned()
            .try_into()
            .map_err(|e: EnvironmentError| e.to_string())?;
        let Some(record) = store.get(&id)? else {
            continue;
        };
        if record.state().state() == UseState::Released {
            continue;
        }
        let owner: Owner = serde_json::from_slice(&fs::read(&path).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        let (state, _) = store.apply(&id, UseCommand::End)?;
        if absent(-(owner.pid.unwrap_or(owner.group) as i32)) {
            let command = if matches!(
                state.state(),
                UseState::Acquiring | UseState::UnknownAcquire
            ) {
                UseCommand::Refused(receipt(&state, "original-app-group-absent"))
            } else {
                UseCommand::Released {
                    stopped: receipt(&state, "original-app-group-absent"),
                    released: receipt(&state, "reconciled-without-replay"),
                }
            };
            store.apply(&id, command)?;
        } else {
            store.apply(&id, UseCommand::Unknown)?;
        }
    }
    Ok(())
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct PaperApproval {
    item_id: ContentDigest,
    spec_id: ContentDigest,
    request_id: String,
    frozen_digest: ContentDigest,
}
#[derive(Deserialize)]
struct PaperDecision {
    state: String,
}
fn require_paper_approval(
    data: &Path,
    consumer: &Identity,
    approval: &ContentDigest,
) -> Result<(), String> {
    let data = data.join("research-v1");
    for file in fs::read_dir(data.join("pcgym-approval-requests")).map_err(|e| e.to_string())? {
        let path = file.map_err(|e| e.to_string())?.path();
        if path.extension().is_none_or(|e| e != "json") {
            continue;
        }
        let saved: PaperApproval =
            serde_json::from_slice(&fs::read(&path).map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
        if &ContentDigest::of(&saved) != approval {
            continue;
        }
        if String::from(saved.spec_id) != consumer.as_str() {
            return Err("Scientific approval belongs to a different specification".into());
        }
        let decision: PaperDecision = serde_json::from_slice(
            &fs::read(
                data.join("pcgym-approval-decisions")
                    .join(path.file_name().unwrap()),
            )
            .map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        return if decision.state == "allowed" {
            Ok(())
        } else {
            Err("Original scientific approval is not allowed".into())
        };
    }
    Err("Original private scientific approval is missing".into())
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use crate::owned_process::OwnedProcess;
    use std::process::{Command, Stdio};

    #[test]
    fn scientific_owner_release_evidence() {
        for registered in [false, true] {
            let root =
                std::env::temp_dir().join(format!("pero-scientific-use-{}", uuid::Uuid::new_v4()));
            let data = root.as_path();
            let directory = data.join(".compute/uses");
            fs::create_dir_all(&directory).unwrap();
            let profile:LockedPythonProfile=serde_json::from_value(serde_json::json!({
                "root":"/fixture","project_sha256":"a".repeat(64),"lock_sha256":"b".repeat(64),
                "python_request":"3.12.14","python_archive_url":"https://example.invalid/python",
                "python_archive_sha256":"c".repeat(64),"uv_version":"0.12.20","uv_sha256":"d".repeat(64),
                "observation":{"version":"3.12.14","build":"fixture","platform":"linux","machine":"x86_64",
                    "executable_sha256":"e".repeat(64),"packages_sha256":"f".repeat(64),"packages":{}}
            })).unwrap();
            fs::write(
                data.join(".compute/binding.json"),
                serde_json::to_vec(&profile).unwrap(),
            )
            .unwrap();
            let mut store = EnvironmentUses::open(&directory.join("uses.sqlite")).unwrap();
            let mut command = Command::new("/bin/sh");
            command.args(["-c", "read gate"]).stdin(Stdio::piped());
            let mut process = OwnedProcess::spawn(&mut command).unwrap();
            let pid = process.child_mut().id();
            let group = if registered {
                (unsafe { libc::getpgrp() }) as u32
            } else {
                pid
            };
            let id: Identity = "attempt".to_owned().try_into().unwrap();
            let state = apply(
                &mut store,
                &directory,
                data,
                "control-lab",
                group,
                super::Command::Begin {
                    id: id.clone(),
                    consumer: "experiment".to_owned().try_into().unwrap(),
                    approval: ContentDigest::of(&"approval"),
                    profile,
                    native: None,
                },
            )
            .unwrap();
            assert_eq!(state.state(), UseState::Acquiring);
            if registered {
                let active = apply(
                    &mut store,
                    &directory,
                    data,
                    "control-lab",
                    group,
                    super::Command::Started {
                        id: id.clone(),
                        pid,
                        parent: std::process::id(),
                    },
                )
                .unwrap();
                assert_eq!(active.state(), UseState::Active);
                assert!(
                    apply(
                        &mut store,
                        &directory,
                        data,
                        "control-lab",
                        group,
                        super::Command::Finish { id: id.clone() }
                    )
                    .is_err()
                );
                assert_eq!(
                    store.get(&id).unwrap().unwrap().state().state(),
                    UseState::UnknownRelease
                );
            }
            process.stop().unwrap();
            drop(store);
            let mut reopened = EnvironmentUses::open(&directory.join("uses.sqlite")).unwrap();
            recover(&mut reopened, &directory).unwrap();
            assert_eq!(
                reopened.get(&id).unwrap().unwrap().state().state(),
                UseState::Released
            );
            drop(reopened);
            fs::remove_dir_all(root).unwrap();
        }
    }

    /// Actual fixed-case science. No downloads; all inputs are explicitly supplied.
    #[test]
    #[ignore = "requires PERO_SCIENTIFIC_LIVE_HOME, PROFILE, CHECKOUT and APP_PYTHON"]
    fn managed_pcgym_attempt_and_cancel() {
        let root = PathBuf::from(std::env::var_os("PERO_SCIENTIFIC_LIVE_HOME").unwrap());
        assert!(!root.exists(), "Use a fresh evidence directory");
        let profile = PathBuf::from(std::env::var_os("PERO_SCIENTIFIC_LIVE_PROFILE").unwrap());
        let frozen: LockedPythonProfile =
            serde_json::from_slice(&fs::read(&profile).unwrap()).unwrap();
        let repository = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let uses = ScientificUses::start("paper-agent", &root)
            .unwrap()
            .unwrap();
        let mut command = Command::new(std::env::var_os("PERO_SCIENTIFIC_APP_PYTHON").unwrap());
        command
            .arg(repository.join("tests/environments/pcgym-runtime.py"))
            .arg("--science-python")
            .arg(frozen.root.join("bin/python"))
            .arg("--managed-profile")
            .arg(profile)
            .arg("--checkout")
            .arg(std::env::var_os("PERO_SCIENTIFIC_LIVE_CHECKOUT").unwrap())
            .arg("--output")
            .arg(&root)
            .stdin(Stdio::piped());
        uses.configure(&mut command);
        let mut child = OwnedProcess::spawn(&mut command).unwrap();
        uses.bind(child.child_mut().id());
        child
            .child_mut()
            .stdin
            .take()
            .unwrap()
            .write_all(b"execute\n")
            .unwrap();
        assert!(child.child_mut().wait().unwrap().success());
        drop(child);
        drop(uses);
    }

    #[test]
    #[ignore = "requires existing PERO_UV_LIVE_HOME and PERO_SCIENTIFIC_APP_PYTHON"]
    fn managed_control_attempt_and_cancel() {
        let root = PathBuf::from(std::env::var_os("PERO_UV_LIVE_HOME").unwrap());
        let repository = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let uses = ScientificUses::start("control-lab", &root.join("app-data/control-lab"))
            .unwrap()
            .unwrap();
        let mut command = Command::new(std::env::var_os("PERO_SCIENTIFIC_APP_PYTHON").unwrap());
        command
            .arg(repository.join("scripts/verification/uv-control.py"))
            .arg(&root)
            .stdin(Stdio::piped());
        uses.configure(&mut command);
        let mut child = OwnedProcess::spawn(&mut command).unwrap();
        uses.bind(child.child_mut().id());
        child
            .child_mut()
            .stdin
            .take()
            .unwrap()
            .write_all(b"execute\n")
            .unwrap();
        assert!(child.child_mut().wait().unwrap().success());
        drop(child);
        drop(uses);
    }
}
