//! PTYs belong to this Host process. Closing Desktop closes the shells.
use pero_contracts::{
    HostEvent,
    terminal::{TerminalEvent, TerminalRequest, TerminalSize},
};
use portable_pty::{ChildKiller, CommandBuilder, MasterPty, PtySize};
use std::{
    collections::BTreeMap,
    io::{Read, Write},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};

struct Shell {
    exited: Arc<AtomicBool>,
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}
impl Drop for Shell {
    fn drop(&mut self) {
        if !self.exited.load(Ordering::Acquire) {
            let _ = self.killer.kill();
        }
    }
}
#[derive(Default)]
pub struct Terminals {
    shells: BTreeMap<u32, Shell>,
}
fn emit(event: TerminalEvent) {
    let mut envelope = HostEvent::new("terminal", None, String::new());
    envelope.data = serde_json::to_value(event).expect("terminal event");
    let _ = super::emit(envelope);
}
fn size(value: TerminalSize) -> PtySize {
    PtySize {
        rows: value.rows,
        cols: value.cols,
        pixel_width: 0,
        pixel_height: 0,
    }
}
impl Terminals {
    pub fn dispatch(&mut self, mut value: serde_json::Value) {
        // Method is transport routing; the typed request owns the operation.
        if let Some(object) = value.as_object_mut() {
            object.remove("method");
        }
        let id = value["id"]
            .as_u64()
            .and_then(|v| u32::try_from(v).ok())
            .unwrap_or(0);
        let result = serde_json::from_value::<TerminalRequest>(value)
            .map_err(|e| e.to_string())
            .and_then(|request| self.apply(request));
        if let Err(message) = result {
            emit(TerminalEvent::Error { id, message });
        }
    }
    fn apply(&mut self, request: TerminalRequest) -> Result<(), String> {
        match request {
            TerminalRequest::Open {
                id,
                cwd,
                size: dimensions,
            } => {
                if self.shells.contains_key(&id) {
                    return Err("Terminal already exists".into());
                }
                let cwd = if cwd.is_empty() {
                    std::env::current_dir()
                } else {
                    std::fs::canonicalize(cwd)
                }
                .map_err(|e| e.to_string())?;
                if !cwd.is_dir() {
                    return Err("Terminal working directory is unavailable".into());
                }
                let pair = portable_pty::native_pty_system()
                    .openpty(size(dimensions))
                    .map_err(|e| e.to_string())?;
                let shell = std::env::var("SHELL").unwrap_or_else(|_| {
                    if cfg!(windows) {
                        "powershell.exe"
                    } else {
                        "/bin/sh"
                    }
                    .into()
                });
                let mut command = CommandBuilder::new(shell);
                command.cwd(&cwd);
                command.env("TERM", "xterm-256color");
                if !cfg!(windows) {
                    command.arg("-l");
                }
                let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
                let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
                let mut child = pair
                    .slave
                    .spawn_command(command)
                    .map_err(|e| e.to_string())?;
                drop(pair.slave);
                let exited = Arc::new(AtomicBool::new(false));
                self.shells.insert(
                    id,
                    Shell {
                        master: pair.master,
                        writer,
                        killer: child.clone_killer(),
                        exited: exited.clone(),
                    },
                );
                emit(TerminalEvent::Opened {
                    id,
                    cwd: cwd.to_string_lossy().into_owned(),
                });
                std::thread::spawn(move || {
                    let mut bytes = [0; 8192];
                    loop {
                        match reader.read(&mut bytes) {
                            Ok(0) | Err(_) => break,
                            Ok(count) => emit(TerminalEvent::Output {
                                id,
                                bytes: bytes[..count].to_vec(),
                            }),
                        }
                    }
                    exited.store(true, Ordering::Release);
                    let code = child.wait().map(|status| status.exit_code()).unwrap_or(1);
                    emit(TerminalEvent::Exited { id, code });
                });
                Ok(())
            }
            TerminalRequest::Close { id } => {
                self.shells.remove(&id);
                Ok(())
            }
            TerminalRequest::Write { id, bytes } => self
                .shells
                .get_mut(&id)
                .ok_or("Terminal is closed".to_string())?
                .writer
                .write_all(&bytes)
                .map_err(|e| e.to_string()),
            TerminalRequest::Resize {
                id,
                size: dimensions,
            } => self
                .shells
                .get(&id)
                .ok_or("Terminal is closed".to_string())?
                .master
                .resize(size(dimensions))
                .map_err(|e| e.to_string()),
        }
    }
}
