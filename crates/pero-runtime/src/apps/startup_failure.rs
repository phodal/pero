use serde::Serialize;
use std::{fmt, process::ExitStatus};

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum StartupCode {
    AppUnavailable,
    EnvironmentUnavailable,
    BackendSetupFailed,
    SpawnFailed,
    ReadinessIo,
    ReadinessTimeout,
    InvalidReadiness,
    BackendExited,
}

#[derive(Debug)]
pub struct AppStartupFailure {
    code: StartupCode,
    message: String,
    status: Option<ExitStatus>,
}

impl AppStartupFailure {
    pub(super) fn new(code: StartupCode, message: impl Into<String>) -> Self {
        Self { code, message: message.into(), status: None }
    }

    pub(super) fn environment(message: String) -> Self {
        Self::new(StartupCode::EnvironmentUnavailable, message)
    }

    pub(super) fn setup(message: String) -> Self {
        Self::new(StartupCode::BackendSetupFailed, message)
    }

    pub(super) fn exited(status: ExitStatus, python: bool, stderr: &[u8]) -> Self {
        let missing = if python { missing_python_module(stderr) } else { None };
        Self {
            code: StartupCode::BackendExited,
            message: missing.map(|module| format!(
                "Python module '{module}' is missing. Repair this App package or its Python environment, then reopen the App."
            )).unwrap_or_else(|| "App backend stopped during startup".into()),
            status: Some(status),
        }
    }

    /// Local diagnostics include only process metadata. Error messages can
    /// contain interpreter paths or data supplied by an App.
    pub fn diagnostic(&self) -> impl Serialize {
        #[derive(Serialize)]
        struct Diagnostic {
            stage: &'static str,
            code: StartupCode,
            exit_code: Option<i32>,
            signal: Option<i32>,
        }

        let stage = match self.code {
            StartupCode::AppUnavailable => "resolve",
            StartupCode::EnvironmentUnavailable => "environment",
            StartupCode::BackendSetupFailed | StartupCode::SpawnFailed => "spawn",
            StartupCode::ReadinessIo | StartupCode::ReadinessTimeout
            | StartupCode::InvalidReadiness | StartupCode::BackendExited => "ready",
        };
        #[cfg(unix)]
        let signal = {
            use std::os::unix::process::ExitStatusExt;
            self.status.and_then(|status| status.signal())
        };
        #[cfg(not(unix))]
        let signal = None;
        Diagnostic { stage, code: self.code, exit_code: self.status.and_then(|status| status.code()), signal }
    }
}

fn missing_python_module(stderr: &[u8]) -> Option<String> {
    let output = String::from_utf8_lossy(stderr);
    let module = output.lines().rev()
        .find_map(|line| line.strip_prefix("ModuleNotFoundError: No module named '")?.strip_suffix('\''))?;
    if module.len() > 96 || !module.split('.').all(|part| {
        let mut bytes = part.bytes();
        bytes.next().is_some_and(|first| first.is_ascii_alphabetic() || first == b'_')
            && bytes.all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
    }) { return None; }
    Some(module.to_owned())
}

#[cfg(test)]
mod tests {
    use super::missing_python_module;

    #[test]
    fn only_a_python_module_identifier_becomes_a_visible_startup_reason() {
        for (stderr, expected) in [
            (b"private detail\nModuleNotFoundError: No module named 'pero_source_tools'\n".as_slice(), Some("pero_source_tools")),
            (b"ModuleNotFoundError: No module named 'package.child'\n".as_slice(), Some("package.child")),
            (b"ModuleNotFoundError: No module named '/private/user/token'\n".as_slice(), None),
            (b"RuntimeError: private detail\n".as_slice(), None),
        ] {
            assert_eq!(missing_python_module(stderr).as_deref(), expected);
        }
    }
}

impl fmt::Display for AppStartupFailure {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}
