//! Runtime-owned preferences. Desktop forwards changes rather than owning a second store.
use crate::apps::PythonEnvironments;
use pero_contracts::RemoteConnectionSettings;
use std::{
    io::{self, Write},
    path::Path,
};

pub fn load_locale(path: &Path) -> Option<String> {
    let value: serde_json::Value = serde_json::from_slice(&std::fs::read(path).ok()?).ok()?;
    value
        .get("locale")?
        .as_str()
        .map(|locale| pero_contracts::i18n::normalize(locale).into())
}

/// Trusted Host configuration; an invalid explicit binding must never become
/// an implicit request to run an App with system Python.
pub fn load_app_python(path: &Path) -> Result<PythonEnvironments, String> {
    #[derive(serde::Deserialize)]
    struct AppSettings {
        #[serde(default)]
        app_python: PythonEnvironments,
    }
    let bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Ok(PythonEnvironments::default());
        }
        Err(error) => {
            return Err(format!(
                "Cannot read App Python settings {}: {error}",
                path.display()
            ));
        }
    };
    serde_json::from_slice::<AppSettings>(&bytes)
        .map(|settings| settings.app_python)
        .map_err(|error| format!("Invalid App Python settings {}: {error}", path.display()))
}

fn update(path: &Path, edit: impl FnOnce(&mut serde_json::Value)) -> io::Result<()> {
    let mut value = match std::fs::read(path) {
        Ok(bytes) => serde_json::from_slice::<serde_json::Value>(&bytes)?,
        Err(error) if error.kind() == io::ErrorKind::NotFound => serde_json::json!({}),
        Err(error) => return Err(error),
    };
    if !value.is_object() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Settings must be an object",
        ));
    }
    edit(&mut value);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let pending = path.with_extension(format!(
        "{}.{}.pending",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    ));
    let result = (|| {
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&pending)?;
        file.write_all(&serde_json::to_vec_pretty(&value)?)?;
        file.sync_all()?;
        std::fs::rename(&pending, path)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&pending);
    }
    result
}

pub fn save_locale(path: &Path, locale: &str) -> io::Result<()> {
    update(path, |value| {
        value["locale"] = pero_contracts::i18n::normalize(locale).into()
    })
}

pub fn load_chat_agent(path: &Path) -> Option<String> {
    let value: serde_json::Value = serde_json::from_slice(&std::fs::read(path).ok()?).ok()?;
    value["chat_agent"].as_str().map(str::to_owned)
}

pub fn save_chat_agent(path: &Path, agent: &str) -> io::Result<()> {
    update(path, |value| value["chat_agent"] = agent.into())
}

pub fn load_workbench(path: &Path) -> pero_contracts::workbench::WorkbenchPreferences {
    std::fs::read(path).ok()
        .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
        .and_then(|value| serde_json::from_value(value["workbench"].clone()).ok())
        .filter(pero_contracts::workbench::WorkbenchPreferences::valid)
        .unwrap_or_default()
}

pub fn save_workbench(path: &Path, preferences: &pero_contracts::workbench::WorkbenchPreferences) -> io::Result<()> {
    if !preferences.valid() {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "Invalid workbench preferences"));
    }
    let preferences = serde_json::to_value(preferences)?;
    update(path, |value| value["workbench"] = preferences)
}

pub fn save_remote_connection(
    path: &Path,
    connection: Option<&RemoteConnectionSettings>,
) -> io::Result<()> {
    if connection.is_some_and(|connection| !connection.valid()) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Invalid remote preference",
        ));
    }
    let remote = serde_json::to_value(connection)?;
    update(path, |value| value["remote_connection"] = remote)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preferences_survive_restart_and_preserve_other_settings() {
        let path =
            std::env::temp_dir().join(format!("pero-i18n-settings-{}.json", std::process::id()));
        std::fs::write(
            &path,
            r#"{"other":{"enabled":true},"workbench":{"appearance":"dark","projects":[]}}"#,
        ).unwrap();
        let restored = load_workbench(&path);
        assert_eq!(restored.appearance, pero_contracts::workbench::Appearance::Dark);
        assert_eq!(restored.layout.chat_width(), 420.);
        assert!(!restored.layout.chat_open);
        save_locale(&path, "en").unwrap();
        save_chat_agent(&path, "fixture").unwrap();
        assert_eq!(load_chat_agent(&path).as_deref(), Some("fixture"));
        assert_eq!(load_locale(&path).as_deref(), Some("en"));
        save_locale(&path, "zh-CN").unwrap();
        assert_eq!(load_locale(&path).as_deref(), Some("zh-CN"));
        let value: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(value["other"]["enabled"], true);
        let connection = RemoteConnectionSettings {
            url: "https://app.openpero.com".into(),
            mode: pero_contracts::RemoteConnectionMode::Client,
            encrypted_token: "ZW5jcnlwdGVk".into(),
        };
        save_remote_connection(&path, Some(&connection)).unwrap();
        let preferences = pero_contracts::workbench::WorkbenchPreferences {
            appearance: pero_contracts::workbench::Appearance::Dark,
            accent: pero_contracts::appearance::AccentColor::Blue,
            typography: serde_json::from_str(r#"{"ui_size":18,"chat_size":20}"#).unwrap(),
            projects: vec![pero_contracts::workbench::ProjectBinding {
                workspace: "/work/pero".into(), project_id: "pero".into(),
            }],
            layout: {
                let mut layout = pero_contracts::workbench::LayoutPreferences::default();
                layout.resize_chat(512.);
                layout.chat_open = true;
                layout
            },
        };
        save_workbench(&path, &preferences).unwrap();
        assert_eq!(load_workbench(&path), preferences);
        save_locale(&path, "en").unwrap();
        let value: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(value["remote_connection"]["mode"], "client");
        assert_eq!(
            value["remote_connection"]["encrypted_token"],
            "ZW5jcnlwdGVk"
        );
        save_remote_connection(&path, None).unwrap();
        let value: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert!(value["remote_connection"].is_null());
        assert_eq!(load_locale(&path).as_deref(), Some("en"));
        assert_eq!(load_workbench(&path), preferences);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        std::fs::write(&path, "invalid").unwrap();
        assert!(save_locale(&path, "en").is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "invalid");
        std::fs::remove_file(path).unwrap();
    }
}
