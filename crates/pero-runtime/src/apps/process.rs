use super::PythonEnvironment;
use crate::owned_process::OwnedProcess;
use super::definition::{AppDefinition, BackendKind};
use serde::Serialize;
use std::{
    io::{BufRead, BufReader, Read},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::mpsc,
    time::Duration,
};

#[derive(Clone, Serialize)]
pub struct BackendAccess {
    pub url: String,
    pub token: String,
    /// Host-only Paper compute authority. Never part of an App resolve response.
    #[serde(skip_serializing)]
    pub reproduction_token: Option<String>,
}

impl std::fmt::Debug for BackendAccess {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.debug_struct("BackendAccess").field("url", &self.url)
            .field("token", &"[redacted]")
            .field("reproduction_enabled", &self.reproduction_token.is_some()).finish()
    }
}

/// Explicit Host deployment configuration, not an App manifest or request field.
struct ReproductionDeployment { checkout: PathBuf }
impl ReproductionDeployment {
    fn resolve(app: &str, configured: Option<std::ffi::OsString>) -> Result<Option<Self>, String> {
        if app != "paper-agent" { return Ok(None); }
        let Some(configured) = configured else { return Ok(None); };
        let checkout = PathBuf::from(configured);
        if !checkout.is_absolute() || !checkout.is_dir()
            || checkout.canonicalize().map_err(|_| "Paper compute checkout is unavailable")? != checkout {
            return Err("Paper compute requires a canonical existing absolute checkout directory".into());
        }
        Ok(Some(Self { checkout }))
    }
}

pub(super) struct AppProcess {
    child: OwnedProcess,
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
        let reproduction = ReproductionDeployment::resolve(definition.name.as_str(),
            std::env::var_os("PERO_PAPER_PCGYM_CHECKOUT"))?;
        let reproduction_token = reproduction.as_ref().map(|_| uuid::Uuid::new_v4().to_string());
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
                super::python::default_executable(),
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
        for key in ["PATH", "HOME", "LANG", "SYSTEMROOT", "USERPROFILE", "HOMEDRIVE", "HOMEPATH"] {
            if let Some(value) = std::env::var_os(key) {
                command.env(key, value);
            }
        }
        if let (BackendKind::Python, Some(environment)) = (&backend.kind, python) {
            environment.configure_command(&mut command)?;
        }
        if let Some(deployment) = reproduction {
            if let Some(scientific_python) = std::env::var_os("PERO_PAPER_SCIENTIFIC_PYTHON") {
                command.env("PERO_PAPER_SCIENTIFIC_PYTHON", scientific_python);
            }
            command.env("PERO_PAPER_PCGYM_CHECKOUT", deployment.checkout)
                .env("PERO_PAPER_COMPUTE_TOKEN", reproduction_token.as_ref().expect("configured capability"));
        }
        command
            .env("ELECTRON_RUN_AS_NODE", "1")
            .env("PERO_APP_DATA", data)
            .env("PERO_APP_TOKEN", &token)
            .env("PERO_APP_NAME", definition.name.as_str())
            .env("PYTHONUNBUFFERED", "1")
            .env("PYTHONDONTWRITEBYTECODE", "1")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit());
        let child = OwnedProcess::spawn(&mut command)
            .map_err(|error| format!("Cannot start App {label} backend {}: {error}. Check its configured interpreter and environment.", definition.name.as_str()))?;
        let mut process = Self {
            child,
            access: BackendAccess {
                url: String::new(),
                token,
                reproduction_token,
            },
        };
        let stdout = process.child.child_mut().stdout.take().expect("piped stdout");
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



#[cfg(test)]
mod reproduction_tests {
    use super::*;

    #[test]
    fn private_capability_is_not_serialized_or_debugged() {
        let access = BackendAccess { url: "http://127.0.0.1:1".into(), token: "ordinary-secret".into(),
            reproduction_token: Some("compute-secret".into()) };
        let encoded = serde_json::to_value(&access).unwrap();
        assert_eq!(encoded, serde_json::json!({"url":"http://127.0.0.1:1","token":"ordinary-secret"}));
        let debug = format!("{access:?}");
        assert!(!debug.contains("ordinary-secret"));
        assert!(!debug.contains("compute-secret"));
    }

    #[test]
    fn deployment_is_explicit_fixed_to_paper_and_requires_a_real_canonical_directory() {
        assert!(ReproductionDeployment::resolve("paper-agent", None).unwrap().is_none());
        assert!(ReproductionDeployment::resolve("other-app", Some("ignored".into())).unwrap().is_none());
        for path in ["", ".", "/does-not-exist/pero-compute"] {
            assert!(ReproductionDeployment::resolve("paper-agent", Some(path.into())).is_err());
        }
        let root = std::env::temp_dir().canonicalize().unwrap().join(format!("pero-compute-config-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        assert!(ReproductionDeployment::resolve("paper-agent", Some(root.clone().into_os_string())).unwrap().is_some());
        #[cfg(unix)] {
            let alias = root.with_extension("alias");
            std::os::unix::fs::symlink(&root, &alias).unwrap();
            assert!(ReproductionDeployment::resolve("paper-agent", Some(alias.clone().into_os_string())).is_err());
            std::fs::remove_file(alias).unwrap();
        }
        std::fs::remove_dir(root).unwrap();
    }
}
