//! Host-owned Python preparation, shared by every Desktop shell.
use super::{AppName, PythonEnvironment, definition::PythonDependency};
use serde::Serialize;
use std::{
    io::{BufRead, BufReader},
    process::{Command, Stdio},
    sync::mpsc,
    time::{Duration, Instant},
};

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PreparationPhase {
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
    environment: &PythonEnvironment,
    dependencies: &[PythonDependency],
    progress: &mut impl FnMut(AppPreparation),
) -> Result<(), String> {
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
    let result: Result<(), String> = (|| {
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
            let python =
                super::python::bundled_python_executable().unwrap_or_else(|_| "3.12".into());
            let mut command = uv_command(&uv, environment);
            // Reuse local CPython 3.12, or let uv prepare it when absent.
            command
                .args(["venv", "--python"])
                .arg(&python)
                .arg(environment.root());
            run(&mut command, &mut |line| {
                report(PreparationPhase::Creating, line)
            })?;
        }
        let config = std::fs::read_to_string(environment.root().join("pyvenv.cfg"))
            .map_err(|e| e.to_string())?;
        environment.validate_config(&config)?;
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
                return Err("Installed Python dependencies could not be verified. Enable the App again to retry the locked requirements. ngspice is not downloaded.".into());
            }
        }
        Ok(())
    })();
    match &result {
        Ok(()) => report(
            PreparationPhase::Ready,
            "Python environment is ready".into(),
        ),
        Err(error) => report(PreparationPhase::Failed, error.clone()),
    }
    result
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
        .args(["-I", "-c", "import importlib, importlib.metadata as m, sys\nreqs=sys.argv[1:]\ntry:\n ok=all(m.version(n)==v for n,v in (r.split('==') for r in reqs))\nexcept m.PackageNotFoundError:\n sys.exit(1)\nif not ok:\n sys.exit(1)\ntry:\n for req in reqs:\n  name=req.split('==',1)[0]\n  dist=m.distribution(name)\n  for top in (dist.read_text('top_level.txt') or '').split():\n   if top: importlib.import_module(top)\n  if name=='scipy': importlib.import_module('scipy.linalg')\nexcept Exception as exc:\n print(exc, file=sys.stderr)\n sys.exit(2)"])
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
            "{detail} Enable the App again to retry the locked requirements. ngspice is not downloaded."
        ));
    }
    Ok(false)
}

// A pinned official installer avoids requiring Python or pip to bootstrap uv.
// UV_UNMANAGED_INSTALL leaves shell profiles and PATH untouched.
fn installer(
    environment: &PythonEnvironment,
    log: &mut impl FnMut(String),
) -> Result<std::path::PathBuf, String> {
    if Command::new("uv")
        .arg("--version")
        .output()
        .ok()
        .is_some_and(|output| output.status.success())
    {
        return Ok(std::path::PathBuf::from("uv"));
    }
    let tools = environment
        .root()
        .parent()
        .ok_or("Environment needs a parent")?
        .join("tools");
    let uv = tools.join(if cfg!(windows) { "uv.exe" } else { "uv" });
    if uv.is_file() {
        return Ok(uv);
    }
    log("Downloading uv 0.12.20".into());
    std::fs::create_dir_all(&tools).map_err(|e| e.to_string())?;
    let filename = if cfg!(windows) {
        "install.ps1"
    } else {
        "install.sh"
    };
    let script = tools.join(filename);
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;
    let bytes = client
        .get(format!("https://astral.sh/uv/0.12.20/{filename}"))
        .send()
        .and_then(|r| r.error_for_status())
        .and_then(|r| r.bytes())
        .map_err(|e| format!("Cannot download uv: {e}"))?;
    std::fs::write(&script, bytes).map_err(|e| e.to_string())?;
    let mut command = if cfg!(windows) {
        let mut command = Command::new("powershell.exe");
        command.args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"]);
        command
    } else {
        Command::new("sh")
    };
    command.arg(&script).env("UV_UNMANAGED_INSTALL", &tools);
    run(&mut command, log)?;
    if !uv.is_file() {
        return Err("uv installer did not create its executable".into());
    }
    Ok(uv)
}

fn uv_command(uv: &std::path::Path, environment: &PythonEnvironment) -> Command {
    let home = environment.root().parent().expect("environment parent");
    let mut command = Command::new(uv);
    command
        .env("UV_PYTHON_INSTALL_DIR", home.join("python"))
        .env("UV_CACHE_DIR", home.join("cache"))
        .env("UV_PYTHON_INSTALL_BIN", "0")
        .arg("--no-config");
    command
}

/// Stream installer output while bounding the wait. No installation timeout is
/// mistaken for backend readiness; the backend starts only after this succeeds.
fn run(command: &mut Command, log: &mut impl FnMut(String)) -> Result<(), String> {
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            format!("Cannot prepare Python environment: {e}. Check the installation log and retry.")
        })?;
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
        if let Ok(line) = receive.recv_timeout(Duration::from_millis(100)) {
            tail = line.chars().take(2000).collect();
            log(tail.clone());
        }
        match child.try_wait() {
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
                let _ = child.kill();
                let _ = child.wait();
                return Err(match result { Err(e) => e.to_string(), _ => "Python environment installation exceeded 10 minutes. Check the network and retry.".into() });
            }
        }
    }
}
