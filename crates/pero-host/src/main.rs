use pero_contracts::{
    EchoRequest, HostEvent, RemoteConnectionPreference, SetRemoteSettingsRequest,
};
use std::io::{self, BufRead, Write};
mod agents;
mod apps;
mod contributions;
mod local_worker;

fn emit(event: HostEvent) -> io::Result<()> {
    let mut stdout = io::stdout().lock();
    serde_json::to_writer(&mut stdout, &event)?;
    writeln!(stdout)?;
    stdout.flush()
}

fn main() -> io::Result<()> {
    if std::env::args().nth(1).as_deref() != Some("--stdio") {
        eprintln!("Usage: pero-host --stdio (bootstrap probe only)");
        std::process::exit(2);
    }
    let mut agents = agents::Manager::new(std::env::current_dir()?);
    let settings_path = std::env::var_os("PERO_SETTINGS_PATH").map(std::path::PathBuf::from);
    let mut apps = apps::Apps::new(settings_path.as_deref());
    let workers = local_worker::LocalWorkers::new(settings_path.as_deref());
    let locale = settings_path
        .as_deref()
        .and_then(pero_runtime::settings::load_locale)
        .unwrap_or_else(|| {
            pero_contracts::i18n::normalize(
                &std::env::var("PERO_LOCALE").unwrap_or_else(|_| "en".into()),
            )
            .into()
        });
    emit(HostEvent::new("settings", None, locale))?;
    emit(HostEvent::message("ready", None, "status.host_ready"))?;
    for line in io::stdin().lock().lines() {
        let line = line?;
        let value: serde_json::Value = serde_json::from_str(&line).unwrap_or_default();
        if value
            .get("method")
            .and_then(|v| v.as_str())
            .is_some_and(|method| method.starts_with("settings.workbench"))
        {
            use pero_contracts::workbench::WorkbenchSettingsRequest;
            let result = serde_json::from_value::<WorkbenchSettingsRequest>(value)
                .ok()
                .zip(settings_path.as_deref())
                .and_then(|(request, path)| match request {
                    WorkbenchSettingsRequest::Get => {
                        Some(pero_runtime::settings::load_workbench(path))
                    }
                    WorkbenchSettingsRequest::Set { preferences } => {
                        pero_runtime::settings::save_workbench(path, &preferences)
                            .ok()
                            .map(|_| preferences)
                    }
                });
            let event = if let Some(preferences) = result {
                let mut event = HostEvent::new("workbench_settings", None, String::new());
                event.data = serde_json::to_value(preferences)?;
                event
            } else {
                HostEvent::message("error", None, "error.preferences")
            };
            emit(event)?;
            continue;
        }
        if value.get("method").and_then(|v| v.as_str()) == Some("contribution") {
            contributions::dispatch(value);
            continue;
        }
        if value.get("method").and_then(|v| v.as_str()) == Some("apps") {
            emit(apps.dispatch(value, &mut agents))?;
            continue;
        }
        if value
            .get("action")
            .and_then(|action| action.as_str())
            .is_some_and(|action| action.starts_with("local_worker_"))
        {
            workers.dispatch(value, settings_path.as_deref());
            continue;
        }
        if value.get("action").is_some() {
            agents.dispatch(value);
            continue;
        }
        if value.get("method").and_then(|v| v.as_str()) == Some("settings.remote") {
            let request_id = value
                .get("id")
                .and_then(|id| id.as_str())
                .filter(|id| !id.is_empty() && id.len() <= 128)
                .map(str::to_string);
            let saved = serde_json::from_value::<SetRemoteSettingsRequest>(value)
                .ok()
                .filter(|request| !request.id.is_empty() && request.id.len() <= 128)
                .zip(settings_path.as_deref())
                .is_some_and(|(request, path)| {
                    let connection = match &request.connection {
                        RemoteConnectionPreference::Configured(connection) => Some(connection),
                        RemoteConnectionPreference::Disconnected(()) => None,
                    };
                    pero_runtime::settings::save_remote_connection(path, connection).is_ok()
                });
            emit(HostEvent::new(
                if saved {
                    "remote_settings_saved"
                } else {
                    "remote_settings_error"
                },
                request_id,
                String::new(),
            ))?;
            continue;
        }
        if value.get("method").and_then(|v| v.as_str()) == Some("settings.locale") {
            let locale = value
                .get("locale")
                .and_then(|v| v.as_str())
                .filter(|v| matches!(*v, "en" | "zh-CN"))
                .filter(|_| value.as_object().is_some_and(|object| object.len() == 2));
            let event = match (locale, settings_path.as_deref()) {
                (Some(locale), Some(path))
                    if pero_runtime::settings::save_locale(path, locale).is_ok() =>
                {
                    HostEvent::new("settings", None, locale.into())
                }
                _ => HostEvent::message("error", None, "error.settings"),
            };
            emit(event)?;
            continue;
        }
        let event = match serde_json::from_str::<EchoRequest>(&line) {
            Ok(request) => pero_runtime::echo(request),
            Err(_) => HostEvent::message("error", None, "error.invalid_request"),
        };
        emit(event)?;
    }
    Ok(())
}
