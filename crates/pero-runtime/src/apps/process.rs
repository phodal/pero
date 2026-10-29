use super::PythonEnvironment;
use super::definition::{AppDefinition, BackendKind};
use serde::Serialize;
use std::{
    io::{BufRead, BufReader, Read},
    path::Path,
    process::{Child, Command, Stdio},
    sync::mpsc,
    time::{Duration, Instant},
};

#[derive(Clone, Debug, Serialize)]
pub struct BackendAccess {
    pub url: String,
    pub token: String,
}

pub(super) struct AppProcess {
    child: Child,
    access: BackendAccess,
}

impl AppProcess {
    pub fn start(
        definition: &AppDefinition,
        root: &Path,
        data: &Path,
        python: Option<&PythonEnvironment>,
    ) -> Result<Self, String> {
        let backend = definition.backend.as_ref().ok_or("App has no backend")?;
        std::fs::create_dir_all(data).map_err(|error| error.to_string())?;
        let token = uuid::Uuid::new_v4().to_string();
        let (executable, label) = match (&backend.kind, python) {
            (BackendKind::Python, Some(environment)) => {
                let config = environment.root().join("pyvenv.cfg");
                let contents = std::fs::read_to_string(&config).map_err(|error| {
                    format!(
                        "App {} Python environment {} is unavailable: {error}. Prepare the virtual environment or update app_python and restart the Host.",
                        definition.name.as_str(), config.display(),
                    )
                })?;
                environment.validate_config(&contents)?;
                let executable = environment.executable();
                if !executable.is_file() {
                    return Err(format!(
                        "App {} Python interpreter {} is missing. Recreate the virtual environment or update app_python and restart the Host.",
                        definition.name.as_str(),
                        executable.display(),
                    ));
                }
                (executable.into_os_string(), "Python")
            }
            (BackendKind::Python, None) => (
                std::env::var_os("PERO_APP_PYTHON").unwrap_or_else(|| "python3".into()),
                "Python",
            ),
            (BackendKind::Node, _) => (
                std::env::var_os("PERO_APP_NODE").unwrap_or_else(|| "node".into()),
                "Node",
            ),
        };
        let mut command = Command::new(executable);
        if matches!(backend.kind, BackendKind::Python) {
            // Ignore ambient Python settings and user-site packages, while
            // retaining the entry directory for the App's sibling modules.
            command.args(["-E", "-s", "-u", "-B"]);
        }
        command
            .arg(root.join(&backend.entry))
            .current_dir(root)
            .env_clear();
        for key in ["PATH", "HOME", "LANG", "SYSTEMROOT"] {
            if let Some(value) = std::env::var_os(key) {
                command.env(key, value);
            }
        }
        if let (BackendKind::Python, Some(environment)) = (&backend.kind, python) {
            let executable = environment.executable();
            let mut paths = vec![
                executable
                    .parent()
                    .expect("venv executable directory")
                    .to_path_buf(),
            ];
            if let Some(path) = std::env::var_os("PATH") {
                paths.extend(std::env::split_paths(&path));
            }
            command.env("VIRTUAL_ENV", environment.root()).env(
                "PATH",
                std::env::join_paths(paths).map_err(|error| {
                    format!("Cannot configure App Python environment PATH: {error}")
                })?,
            );
        }
        command
            .env("PERO_APP_DATA", data)
            .env("PERO_APP_TOKEN", &token)
            .env("PERO_APP_NAME", definition.name.as_str())
            .env("PYTHONUNBUFFERED", "1")
            .env("PYTHONDONTWRITEBYTECODE", "1")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit());
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            command.process_group(0);
        }
        let child = command
            .spawn()
            .map_err(|error| format!("Cannot start App {label} backend {}: {error}. Check its configured interpreter and environment.", definition.name.as_str()))?;
        let mut process = Self {
            child,
            access: BackendAccess {
                url: String::new(),
                token,
            },
        };
        let stdout = process.child.stdout.take().expect("piped stdout");
        let (send, receive) = mpsc::sync_channel(1);
        std::thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            let mut line = String::new();
            let ready = reader
                .by_ref()
                .take(1024)
                .read_line(&mut line)
                .map(|_| line);
            let _ = send.send(ready);
            let _ = std::io::copy(&mut reader, &mut std::io::sink());
        });
        let line = receive
            .recv_timeout(Duration::from_secs(10))
            .map_err(|_| "App backend did not report readiness within 10 seconds".to_string())?
            .map_err(|error| error.to_string())?;
        #[derive(serde::Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Ready {
            port: u16,
        }
        let ready: Ready = serde_json::from_str(&line)
            .map_err(|_| "App backend returned an invalid readiness line")?;
        if ready.port == 0 {
            return Err("App backend returned an invalid port".into());
        }
        if process
            .child
            .try_wait()
            .map_err(|error| error.to_string())?
            .is_some()
        {
            return Err("App backend stopped during startup".into());
        }
        process.access.url = format!("http://127.0.0.1:{}", ready.port);
        Ok(process)
    }

    pub fn access(&mut self) -> Result<BackendAccess, String> {
        match self.child.try_wait().map_err(|error| error.to_string())? {
            None => Ok(self.access.clone()),
            Some(_) => Err("App backend stopped. Close and reopen the App to retry.".into()),
        }
    }
}

impl Drop for AppProcess {
    fn drop(&mut self) {
        #[cfg(unix)]
        {
            // The Host owns the entire backend process group, including children.
            let group = -(self.child.id() as i32);
            unsafe {
                libc::kill(group, libc::SIGTERM);
            }
            let deadline = Instant::now() + Duration::from_secs(2);
            while self.child.try_wait().ok().flatten().is_none() && Instant::now() < deadline {
                std::thread::sleep(Duration::from_millis(10));
            }
            unsafe {
                libc::kill(group, libc::SIGKILL);
            }
        }
        #[cfg(not(unix))]
        {
            let _ = self.child.kill();
        }
        let _ = self.child.wait();
    }
}
