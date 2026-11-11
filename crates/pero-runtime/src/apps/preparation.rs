//! Host-owned Python preparation, shared by every Desktop shell.
use super::{AppName, PythonEnvironment, definition::PythonDependency, python::PythonPreparation};
use serde::Serialize;
use std::{
    path::Path,
    io::{BufRead, BufReader},
    process::{Command, Stdio},
    sync::mpsc,
    time::{Duration, Instant},
};

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PreparationPhase {
    Required,
    Checking,
    Creating,
    Installing,
    Ready,
    Failed,
}

#[derive(Clone, Debug, Serialize)]
pub struct AppPreparation {
    pub name: AppName,
    pub phase: PreparationPhase,
    pub message: String,
}

pub(super) fn prepare(
    name: &AppName,
    selected: Option<&PythonEnvironment>,
    managed: PythonEnvironment,
    dependencies: &[PythonDependency],
    python_minor: &str,
    required_minor: Option<&str>,
    progress: &mut impl FnMut(AppPreparation),
) -> Result<PythonPreparation, String> {
    let mut report = |phase, message: String| {
        progress(AppPreparation {
            name: name.clone(),
            phase,
            message,
        })
    };
    report(
        PreparationPhase::Checking,
        "Checking Python dependencies".into(),
    );
    let result: Result<PythonPreparation, String> = (|| {
        let target = selection(selected, managed, required_minor)?;
        let environment = target.environment();
        if !environment.executable().is_file() {
            report(
                PreparationPhase::Creating,
                format!("Creating {}", environment.root().display()),
            );
            std::fs::create_dir_all(
                environment
                    .root()
                    .parent()
                    .ok_or("Environment needs a parent")?,
            )
            .map_err(|e| e.to_string())?;
            let uv = installer(environment, &mut |line| {
                report(PreparationPhase::Creating, line)
            })?;
            let mut command = uv_command(&uv, environment);
            // The bundled minor resolves a real interpreter. Another minor is
            // requested by version so uv can fetch it without a PATH shim.
            command
                .args(["venv", "--python"])
                .arg(interpreter_request(python_minor))
                .arg(environment.root());
            run(&mut command, &mut |line| {
                report(PreparationPhase::Creating, line)
            })?;
        }
        if matches!(target, PythonPreparation::Managed(_)) {
            let config = std::fs::read_to_string(environment.root().join("pyvenv.cfg"))
                .map_err(|e| e.to_string())?;
            environment.validate_config(&config)?;
        }
        let requirements: Vec<&str> = dependencies.iter().map(PythonDependency::as_str).collect();
        // Check installed distribution versions, rather than trusting a receipt
        // left behind before an environment was edited or removed.
        let check = || locked_packages_ready(environment, &requirements);
        if !check()? {
            report(
                PreparationPhase::Installing,
                format!("Installing {}", requirements.join(", ")),
            );
            let uv = installer(environment, &mut |line| {
                report(PreparationPhase::Installing, line)
            })?;
            let mut command = uv_command(&uv, environment);
            command
                .args(["pip", "install", "--python"])
                .arg(environment.executable())
                .args(["--only-binary", ":all:"])
                .args(&requirements);
            run(&mut command, &mut |line| {
                report(PreparationPhase::Installing, line)
            })?;
            if !check()? {
                return Err("Installed Python dependencies could not be verified. Choose Prepare environment to retry the locked requirements. ngspice is not downloaded.".into());
            }
        }
        Ok(target)
    })();
    match &result {
        Ok(_) => report(
            PreparationPhase::Ready,
            "Python environment is ready".into(),
        ),
        Err(error) => report(PreparationPhase::Failed, error.clone()),
    }
    result
}

/// Read-only admission for opening an App. Acquisition belongs to `prepare`.
pub(super) fn check(
    selected: Option<&PythonEnvironment>,
    managed: PythonEnvironment,
    dependencies: &[PythonDependency],
    required_minor: Option<&str>,
) -> Result<PythonEnvironment, String> {
    let target = selection(selected, managed, required_minor)?;
    let environment = target.environment();
    if selected.is_some_and(|selected| selected.root() != environment.root()) {
        return Err("This App needs a compatible Python environment. Choose Prepare environment to update its binding.".into());
    }
    if !environment.executable().is_file() {
        return Err("Prepare the App environment before opening it. Python will only be installed when you choose Prepare environment.".into());
    }
    if matches!(target, PythonPreparation::Managed(_)) {
        let config = std::fs::read_to_string(environment.root().join("pyvenv.cfg"))
            .map_err(|error| error.to_string())?;
        environment.validate_config(&config)?;
    }
    let requirements: Vec<&str> = dependencies.iter().map(PythonDependency::as_str).collect();
    if !locked_packages_ready(environment, &requirements)? {
        return Err("The App's locked dependencies are missing. Choose Prepare environment to install them.".into());
    }
    Ok(environment.clone())
}

fn selection(
    selected: Option<&PythonEnvironment>,
    managed: PythonEnvironment,
    required_minor: Option<&str>,
) -> Result<PythonPreparation, String> {
    let read = |name: &str| -> Result<Option<String>, String> {
        let Some(environment) = selected else {
            return Ok(None);
        };
        let path = environment.root().join(name);
        match std::fs::read_to_string(&path) {
            Ok(text) => Ok(Some(text)),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(format!("Cannot read Python environment {}: {error}", path.display())),
        }
    };
    let config = read("pyvenv.cfg")?;
    let marker = read(super::conda::MARKER)?;
    PythonPreparation::for_app(
        selected,
        managed,
        config.as_deref(),
        selected.is_some_and(|environment| environment.executable().is_file()),
        required_minor,
        marker.as_deref(),
    )
}

/// Missing pins are not ready. Pins that are installed but cannot be imported
/// stay failed, so a later open does not run pip again.
fn locked_packages_ready(
    environment: &PythonEnvironment,
    requirements: &[&str],
) -> Result<bool, String> {
    if requirements.is_empty() {
        return Ok(true);
    }
    let output = Command::new(environment.executable())
        .args(["-I", "-B", "-c", "import importlib, importlib.metadata as m, sys\nreqs=sys.argv[1:]\ntry:\n ok=all(m.version(n)==v for n,v in (r.split('==') for r in reqs))\nexcept m.PackageNotFoundError:\n sys.exit(1)\nif not ok:\n sys.exit(1)\ntry:\n for req in reqs:\n  name=req.split('==',1)[0]\n  dist=m.distribution(name)\n  for top in (dist.read_text('top_level.txt') or '').split():\n   if top: importlib.import_module(top)\n  if name=='scipy': importlib.import_module('scipy.linalg')\nexcept Exception as exc:\n print(exc, file=sys.stderr)\n sys.exit(2)"])
        .args(requirements)
        .output()
        .map_err(|error| error.to_string())?;
    if output.status.success() {
        return Ok(true);
    }
    let detail = String::from_utf8_lossy(&output.stderr);
    let detail = detail.trim();
    if output.status.code() == Some(2) || !detail.is_empty() {
        let detail = if detail.is_empty() {
            "locked packages did not import"
        } else {
            detail
        };
        return Err(format!(
            "{detail} Choose Prepare environment to retry the locked requirements. ngspice is not downloaded."
        ));
    }
    Ok(false)
}

// The same verified tool owns legacy App preparation and locked compute recipes.
fn installer(
    environment: &PythonEnvironment,
    log: &mut impl FnMut(String),
) -> Result<std::path::PathBuf, String> {
    super::uv_tool::ensure(environment.root().parent().ok_or("Environment needs a parent")?, log)
}

fn interpreter_request(minor: &str) -> std::ffi::OsString {
    if minor == super::python::BUNDLED_PYTHON_MINOR {
        super::python::bundled_python_executable()
            .map(|path| path.into_os_string())
            .unwrap_or_else(|_| minor.into())
    } else {
        minor.into()
    }
}

/// PyG's torch 2.3 CPU wheels are not `package==version` pins. Install them once.
pub(super) fn install_lcms_wheels(
    environment: &PythonEnvironment,
    log: &mut impl FnMut(String),
) -> Result<(), String> {
    if lcms_wheels_ready(environment)? {
        return Ok(());
    }
    log("Installing PyG wheels for torch 2.3".into());
    install_from_index(
        environment,
        "https://data.pyg.org/whl/torch-2.3.0+cpu.html",
        &[
            "pyg_lib",
            "torch_scatter",
            "torch_sparse",
            "torch_cluster",
            "torch_spline_conv",
        ],
        log,
    )
}

pub(super) fn lcms_wheels_ready(environment: &PythonEnvironment) -> Result<bool, String> {
    let output = Command::new(environment.executable())
        .args([
            "-I",
            "-B",
            "-c",
            "import importlib.metadata as m\nfor name in ('pyg_lib','torch_scatter','torch_sparse','torch_cluster','torch_spline_conv'):\n m.version(name)\n",
        ])
        .output()
        .map_err(|error| error.to_string())?;
    Ok(output.status.success())
}

/// The pinned release lives in App data. The module returns immediately when those bytes are already there.
pub(super) fn fetch_lcms_release(
    environment: &PythonEnvironment,
    app_root: &std::path::Path,
    data: &std::path::Path,
    log: &mut impl FnMut(String),
) -> Result<(), String> {
    std::fs::create_dir_all(data).map_err(|error| error.to_string())?;
    log("Checking the pinned LCMS2Yield release".into());
    let mut command = Command::new(environment.executable());
    command
        .args(["-E", "-s", "-B", "-m", "lcms2yield.assets"])
        .current_dir(app_root.join("backend"))
        .env_remove("PYTHONPATH")
        .env_remove("PYTHONHOME")
        .env("PERO_APP_DATA", data);
    run(&mut command, log)
}

/// Install wheels that are not ordinary pinned requirements, such as PyG builds
/// published on a find-links index. Failure stays a preparation failure.
pub(super) fn install_from_index(
    environment: &PythonEnvironment,
    find_links: &str,
    packages: &[&str],
    log: &mut impl FnMut(String),
) -> Result<(), String> {
    let uv = installer(environment, log)?;
    let mut command = uv_command(&uv, environment);
    command
        .args(["pip", "install", "--python"])
        .arg(environment.executable())
        .args(["--only-binary", ":all:", "-f", find_links])
        .args(packages);
    run(&mut command, log)
}

fn uv_command(uv: &std::path::Path, environment: &PythonEnvironment) -> Command {
    super::uv_tool::command(uv, environment.root().parent().expect("environment parent"))
}

/// Stream installer output while bounding the wait. No installation timeout is
/// mistaken for backend readiness; the backend starts only after this succeeds.
pub(super) fn run(command: &mut Command, log: &mut impl FnMut(String)) -> Result<(), String> {
    run_cancellable(command, log, None)
}

pub(super) fn run_cancellable(command: &mut Command, log: &mut impl FnMut(String), cancel: Option<&Path>) -> Result<(), String> {
    if cancel.is_some_and(Path::exists) { return Err("Preparation cancelled by operator".into()); }
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut owned = crate::owned_process::OwnedProcess::spawn(command)
        .map_err(|e| {
            format!("Cannot prepare Python environment: {e}. Check the installation log and retry.")
        })?;
    let child = owned.child_mut();
    let (send, receive) = mpsc::channel();
    let stdout = child.stdout.take().expect("piped stdout");
    let stderr = child.stderr.take().expect("piped stderr");
    for stream in [
        Box::new(stdout) as Box<dyn std::io::Read + Send>,
        Box::new(stderr),
    ] {
        let send = send.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(stream).lines() {
                let Ok(line) = line else {
                    break;
                };
                if send.send(line).is_err() {
                    break;
                }
            }
        });
    }
    drop(send);
    let deadline = Instant::now() + Duration::from_secs(600);
    let mut tail = String::new();
    loop {
        if cancel.is_some_and(Path::exists) {
            owned.stop().map_err(|e|e.to_string())?;
            return Err("Preparation cancelled by operator".into());
        }
        if let Ok(line) = receive.recv_timeout(Duration::from_millis(100)) {
            tail = line.chars().take(2000).collect();
            log(tail.clone());
        }
        match owned.try_wait() {
            Ok(Some(status)) => {
                for line in receive.try_iter() {
                    tail = line.chars().take(2000).collect();
                    log(tail.clone());
                }
                return if status.success() {
                    Ok(())
                } else {
                    Err(format!(
                        "Python environment installation failed ({status}): {tail}. Retry after checking the installation log and network."
                    ))
                };
            }
            Ok(None) if Instant::now() < deadline => {}
            result => {
                let _ = owned.stop();
                return Err(match result { Err(e) => e.to_string(), _ => "Python environment installation exceeded 10 minutes. Check the network and retry.".into() });
            }
        }
    }
}

#[cfg(all(test, unix))]
mod cancellation_tests {
    use super::*;
    #[test]
    fn cancellation_stops_the_preparation_group_after_readiness() {
        let cancel=std::env::temp_dir().join(format!("pero-prepare-cancel-{}",uuid::Uuid::new_v4()));
        let mut command=Command::new("/bin/sh");
        command.args(["-c","echo ready; exec sleep 600"]);
        let error=run_cancellable(&mut command,&mut |line| {
            if line=="ready" { std::fs::write(&cancel,b"cancel").unwrap(); }
        },Some(&cancel)).unwrap_err();
        assert_eq!(error,"Preparation cancelled by operator");
        std::fs::remove_file(cancel).unwrap();
    }
}
