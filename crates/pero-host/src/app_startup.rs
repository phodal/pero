use pero_runtime::apps::{AppName, AppStartupFailure};
use std::{
    fs::{self, OpenOptions},
    io::{self, Write},
    path::Path,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

const MAX_LOG_BYTES: u64 = 256 * 1024;

pub(crate) fn record(
    settings: Option<&Path>,
    app: &AppName,
    request_id: &str,
    elapsed: Duration,
    failure: &AppStartupFailure,
) {
    let mut record = serde_json::to_vec(&serde_json::json!({
        "schema_version": 1,
        "event": "app_startup_failed",
        "host_version": env!("CARGO_PKG_VERSION"),
        "platform": std::env::consts::OS,
        "time_unix_ms": SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis(),
        "request_id": request_id,
        "app": app.as_str(),
        "elapsed_ms": elapsed.as_millis(),
        "failure": failure.diagnostic(),
    })).expect("App startup diagnostic is serializable");
    record.push(b'\n');

    if let Some(profile) = settings.and_then(Path::parent) {
        if let Err(error) = append(profile, &record) {
            eprintln!("Could not write App startup diagnostic: {error}");
        }
    }
    let _ = io::stderr().lock().write_all(&record);
}

fn append(profile: &Path, record: &[u8]) -> io::Result<()> {
    let path = profile.join("app-startup.jsonl");
    if fs::metadata(&path).is_ok_and(|file| file.len() + record.len() as u64 > MAX_LOG_BYTES) {
        fs::rename(&path, profile.join("app-startup.1.jsonl"))?;
    }
    let mut file = OpenOptions::new().create(true).append(true).open(path)?;
    file.write_all(record)
}
