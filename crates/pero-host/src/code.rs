use pero_codemode::{CodeMode, CodeNotice, run};
use pero_contracts::{CodeCommand, HostEvent};
use std::{
    path::PathBuf,
    sync::{Arc, mpsc},
    thread,
};

pub fn open(settings: Option<PathBuf>) -> Arc<CodeMode> {
    let (tx, rx) = mpsc::channel();
    let mode = CodeMode::open(pero_codemode::paths_from_env(settings), tx);
    thread::spawn(move || {
        for notice in rx {
            if super::emit(event(notice)).is_err() {
                break;
            }
        }
    });
    mode
}

pub fn handle(mode: &Arc<CodeMode>, value: serde_json::Value, workspace: PathBuf) {
    let id = value
        .get("id")
        .and_then(|id| id.as_str())
        .filter(|id| run::valid_ident(id, run::MAX_REQUEST_ID))
        .map(str::to_string);
    match serde_json::from_value::<CodeCommand>(value) {
        Ok(CodeCommand::RunCode {
            id,
            env_id,
            program,
        }) => {
            mode.run(id, env_id, program, workspace);
        }
        Ok(CodeCommand::CancelCode { id }) => mode.cancel(id),
        Err(_) => mode.reject(id, "invalid"),
    }
}

fn event(notice: CodeNotice) -> HostEvent {
    match notice {
        CodeNotice::Receipt { id, receipt } => {
            let text = match receipt.stop {
                run::Stop::Exit => "exit",
                run::Stop::Cancel => "cancel",
                run::Stop::Deadline => "deadline",
                run::Stop::Unknown => "unknown",
            };
            let mut event = HostEvent::new("code_run", Some(id), text.into());
            event.data = serde_json::to_value(receipt).unwrap_or(serde_json::Value::Null);
            event
        }
        CodeNotice::Rejected { id, reason } => HostEvent::new("error", id, reason.into()),
    }
}
