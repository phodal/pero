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

    pub(super) fn exited(status: ExitStatus) -> Self {
        Self {
            code: StartupCode::BackendExited,
            message: "App backend stopped during startup".into(),
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

impl fmt::Display for AppStartupFailure {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}
