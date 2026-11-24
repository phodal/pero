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
    request: Operation,
}
#[derive(Deserialize)]
#[serde(untagged)]
enum Operation {
    Agent(ComputerRequest),
    Preview(PreviewRequest),
}
#[derive(Deserialize)]
#[serde(tag = "operation", deny_unknown_fields)]
enum PreviewRequest {
    #[serde(rename = "preview_frame")]
    Frame { target: ComputerTargetRef },
}
#[derive(Serialize)]
#[serde(untagged)]
enum ResultValue {
    Agent(ComputerResponse),
    Preview {
        kind: &'static str,
        image: Option<ComputerImageContent>,
    },
}
#[derive(Serialize)]
#[serde(untagged)]
enum Response {
    Success {
        id: ComputerRef,
        value: ResultValue,
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
    serve_stream(
        desktop,
        host_pid,
        io::BufReader::new(io::stdin()),
        io::stdout().lock(),
    )
}

pub fn serve_stream<D: DesktopDriver>(
    desktop: D,
    host_pid: i32,
    input: impl BufRead + Send + 'static,
    mut output: impl Write,
) -> io::Result<()> {
    let mut driver = ComputerRuntime::new(desktop, host_pid);
    let cancellation = driver.cancellation.clone();
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    std::thread::spawn(move || {
        for line in input.lines() {
            let request = line.and_then(|line| {
                if line.len() > 1_000_000 {
                    return Err(io::Error::other(
                        "Computer request exceeds the transport limit",
                    ));
                }
                serde_json::from_str::<Request>(&line).map_err(io::Error::other)
            });
            let failed = request.is_err();
            if sender.send(request).is_err() || failed {
                break;
            }
        }
        cancellation.cancel();
    });
    for request in receiver {
        let request = request?;
        let result = match request.request {
            Operation::Agent(call) => driver.call(request.thread, call).map(ResultValue::Agent),
            Operation::Preview(PreviewRequest::Frame { target }) => driver
                .preview_frame(target)
                .map(|image| ResultValue::Preview {
                    kind: "preview_frame",
                    image,
                }),
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
        serde_json::to_writer(&mut output, &response)?;
        writeln!(output)?;
        output.flush()?;
    }
    Ok(())
}
