use pero_contracts::{
    HostEvent,
    session_history::{SessionHistory, SessionHistorySaveFailure, SessionHistoryStatus},
};
use std::{
    fs::{self, File, OpenOptions},
    io::{self, BufRead, BufReader, Write},
    path::Path,
};

pub(super) struct SessionJournal {
    output: Option<File>,
    needs_separator: bool,
}

impl SessionJournal {
    pub(super) fn open(path: &Path) -> (SessionHistory, Self, SessionHistoryStatus) {
        let mut status = SessionHistoryStatus::default();
        let mut history = SessionHistory::default();
        let mut needs_separator = false;
        match File::open(path) {
            Ok(file) => {
                let mut reader = BufReader::new(file);
                let mut line = Vec::new();
                loop {
                    line.clear();
                    match reader.read_until(b'\n', &mut line) {
                        Ok(0) => break,
                        Ok(_) => {
                            needs_separator = !line.ends_with(b"\n");
                            if !line.iter().all(u8::is_ascii_whitespace) {
                                match serde_json::from_slice(&line) {
                                    Ok(event) => history.record(event),
                                    Err(_) => status.malformed_records = status.malformed_records.saturating_add(1),
                                }
                            }
                        }
                        Err(_) => {
                            status.read_failed = true;
                            break;
                        }
                    }
                }
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(_) => status.read_failed = true,
        }
        let output = match (|| {
            if let Some(parent) = path.parent().filter(|parent| !parent.as_os_str().is_empty()) {
                fs::create_dir_all(parent)?;
            }
            OpenOptions::new().create(true).append(true).open(path)
        })() {
            Ok(output) => Some(output),
            Err(_) => {
                status.save_failure = Some(SessionHistorySaveFailure::Open);
                None
            }
        };
        (history, Self { output, needs_separator: needs_separator || status.read_failed }, status)
    }

    pub(super) fn append(&mut self, event: &HostEvent) -> Result<(), String> {
        let output = self.output.as_mut().ok_or("Session journal is unavailable")?;
        let result = (|| {
            // A prior partial record cannot consume the next complete row.
            if self.needs_separator {
                output.write_all(b"\n").map_err(|error| error.to_string())?;
            }
            serde_json::to_writer(&mut *output, event).map_err(|error| error.to_string())?;
            output.write_all(b"\n").map_err(|error| error.to_string())
        })();
        self.needs_separator = result.is_err();
        result
    }

    pub(super) fn status_event(status: SessionHistoryStatus) -> HostEvent {
        let mut event = HostEvent::new("session_history_status", None, String::new());
        event.data = serde_json::to_value(status).expect("session history status is serializable");
        event
    }
}
