//! Private, persistent NDJSON worker. The Desktop owns its stdio and caller identity.
use pero_contracts::computer_runtime::*;
use pero_contracts::computer_use::*;
use serde::{Deserialize, Serialize};
use std::io::{self, BufRead, Write};

#[cfg(target_os = "macos")]
#[path = "platform/macos/mod.rs"]
mod platform;
#[cfg(target_os = "windows")]
#[path = "platform/windows.rs"]
mod platform;
#[cfg(target_os = "linux")]
#[path = "platform/linux.rs"]
mod platform;
#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
mod runtime;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    id: ComputerRef,
    thread: ComputerRef,
    request: ComputerRequest,
}
#[derive(Serialize)]
#[serde(untagged)]
enum Response {
    Success {
        id: ComputerRef,
        value: ComputerResponse,
    },
    Failure {
        id: ComputerRef,
        error: ComputerError,
    },
}

fn main() -> io::Result<()> {
    #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
    let mut driver = runtime::ComputerRuntime::new();
    for line in io::stdin().lock().lines() {
        let line = line?;
        if line.len() > 1_000_000 {
            return Err(io::Error::other(
                "Computer request exceeds the transport limit",
            ));
        }
        let request: Request = serde_json::from_str(&line)?;
        #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
        let result = driver.call(request.thread, request.request);
        #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
        let result = {
            let _ = request.thread;
            if matches!(request.request, ComputerRequest::Status {}) {
                Ok(ComputerResponse::Status {
                    status: ComputerDriverStatus {
                        available: false,
                        accessibility: ComputerPermissionState::Unsupported,
                        screen_recording: ComputerPermissionState::Unsupported,
                        message: "Native Computer Use is unsupported on this operating system"
                            .into(),
                    },
                })
            } else {
                Err(ComputerError {
                    code: ComputerErrorCode::Unsupported,
                    message: "Native Computer Use is not available on this platform".into(),
                })
            }
        };
        let response = match result {
            Ok(value) => Response::Success {
                id: request.id,
                value,
            },
            Err(error) => Response::Failure {
                id: request.id,
                error,
            },
        };
        let mut stdout = io::stdout().lock();
        serde_json::to_writer(&mut stdout, &response)?;
        writeln!(stdout)?;
        stdout.flush()?;
    }
    Ok(())
}
