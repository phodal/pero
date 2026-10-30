//! Private, persistent NDJSON worker. The Desktop owns its stdio and caller identity.
use pero_contracts::computer_runtime::*;
use pero_contracts::computer_use::*;
use serde::{Deserialize, Serialize};
use std::io::{self, BufRead, Write};

use crate::{ComputerRuntime, DesktopDriver};

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

pub fn serve<D: DesktopDriver>(desktop: D) -> io::Result<()> {
    let host_pid = std::env::var("PERO_COMPUTER_HOST_PID")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(std::process::id() as i32);
    let mut driver = ComputerRuntime::new(desktop, host_pid);
    for line in io::stdin().lock().lines() {
        let line = line?;
        if line.len() > 1_000_000 {
            return Err(io::Error::other(
                "Computer request exceeds the transport limit",
            ));
        }
        let request: Request = serde_json::from_str(&line)?;
        let result = driver.call(request.thread, request.request);
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
