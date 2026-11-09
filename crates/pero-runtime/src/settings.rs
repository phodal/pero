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
    try_update(path, |value| { edit(value); Ok(()) })
}

fn try_update(path: &Path, edit: impl FnOnce(&mut serde_json::Value) -> io::Result<()>) -> io::Result<()> {
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
    edit(&mut value)?;
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

pub fn save_app_python_binding(path: &Path, app: &str, root: &Path) -> io::Result<()> {
    let root = root.to_string_lossy().into_owned();
    update(path, |value| {
        if !value.get("app_python").is_some_and(|item| item.is_object()) {
            value["app_python"] = serde_json::json!({});
        }
        if !value["app_python"].get("apps").is_some_and(|item| item.is_object()) {
            value["app_python"]["apps"] = serde_json::json!({});
        }
        value["app_python"]["apps"][app] = serde_json::json!(root);
    })
}

pub fn save_locale(path: &Path, locale: &str) -> io::Result<()> {
    update(path, |value| {
        value["locale"] = pero_contracts::i18n::normalize(locale).into()
    })
}

pub fn load_computer_enabled(path: &Path) -> bool {
    std::fs::read(path).ok()
        .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
        .and_then(|settings| settings.get("computer_use")?.get("enabled")?.as_bool())
        .unwrap_or(false)
}
pub fn save_computer_enabled(path: &Path, enabled: bool) -> io::Result<()> {
    update(path, |settings| settings["computer_use"] = serde_json::json!({ "enabled": enabled }))
}

pub fn load_chat_agent(path: &Path) -> Option<String> {
    let value: serde_json::Value = serde_json::from_slice(&std::fs::read(path).ok()?).ok()?;
    value["chat_agent"].as_str().map(str::to_owned)
}

pub fn load_icon_theme(path: &Path) -> Option<String> {
    serde_json::from_slice::<serde_json::Value>(&std::fs::read(path).ok()?).ok()?["icon_theme"].as_str().map(str::to_owned)
}
pub fn save_icon_theme(path: &Path, id: Option<&str>) -> io::Result<()> {
    update(path, |settings| settings["icon_theme"] = serde_json::json!(id))
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

/// Read association state strictly: malformed settings must not look like no projects.
pub fn load_notebook_projects(path: &Path) -> io::Result<pero_contracts::workbench::WorkbenchPreferences> {
    let bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Default::default()),
        Err(error) => return Err(error),
    };
    let value: serde_json::Value = serde_json::from_slice(&bytes)?;
    notebook_project_preferences(&value)
}
fn notebook_project_preferences(value: &serde_json::Value) -> io::Result<pero_contracts::workbench::WorkbenchPreferences> {
    let preferences: pero_contracts::workbench::WorkbenchPreferences = if value.get("workbench").is_none() {
        Default::default()
    } else { serde_json::from_value(value["workbench"].clone())? };
    if !preferences.valid() { return Err(io::Error::new(io::ErrorKind::InvalidData, "Invalid workbench preferences")); }
    Ok(preferences)
}
/// Preserve all unrelated preferences and resources while applying one domain transition.
pub fn save_notebook_project_link(path: &Path, change: &pero_contracts::research_project::NotebookProjectLink) -> io::Result<pero_contracts::workbench::WorkbenchPreferences> {
    let mut result = None;
    try_update(path, |value| {
        let mut preferences = notebook_project_preferences(value)?;
        let project = preferences.research_projects.iter_mut().find(|project| project.id == change.project_id)
            .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "Host project is unavailable"))?;
        change.apply(project).map_err(|error| io::Error::new(io::ErrorKind::InvalidInput, error))?;
        value["workbench"] = serde_json::to_value(&preferences)?;
        result = Some(preferences);
        Ok(())
    })?;
    Ok(result.expect("Successful settings transition"))
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
    fn notebook_project_link_is_narrow_durable_and_does_not_rewrite_stale_settings() {
        use pero_contracts::research_project::{NotebookProjectLink,ResearchProject};
        let path = std::env::temp_dir().join(format!("pero-notebook-project-{}.json",std::process::id()));
        std::fs::write(&path,r#"{"unrelated":{"retained":true}}"#).unwrap();
        let mut preferences = pero_contracts::workbench::WorkbenchPreferences::default();
        preferences.research_projects.push(ResearchProject::new("actual-project".into(),"Actual project".into(),"Study".into(),Some("/private/workspace".into())).unwrap());
        save_workbench(&path,&preferences).unwrap();
        let change = NotebookProjectLink {project_id:"actual-project".into(),entry_id:"a".repeat(32),revision:1,
            expected_revision:None,linked:true,read_only:false};
        let next=save_notebook_project_link(&path,&change).unwrap();
        assert_eq!(load_notebook_projects(&path).unwrap(),next);
        assert_eq!(next.research_projects[0].resources[0].revision,"1");
        let bytes=std::fs::read(&path).unwrap();
        let saved:serde_json::Value=serde_json::from_slice(&bytes).unwrap();
        assert_eq!(saved["unrelated"]["retained"],true);
        assert_eq!(next.research_projects[0].workspace,Some("/private/workspace".into()));
        assert!(save_notebook_project_link(&path,&change).is_err());
        assert_eq!(std::fs::read(&path).unwrap(),bytes);
        std::fs::write(&path,b"not JSON").unwrap();
        assert!(load_notebook_projects(&path).is_err());
        assert!(save_notebook_project_link(&path,&change).is_err());
        assert_eq!(std::fs::read(&path).unwrap(),b"not JSON");
        let _=std::fs::remove_file(path);
    }

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
        assert!(restored.research_projects.is_empty());
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
            shortcuts: Default::default(),
            appearance: pero_contracts::workbench::Appearance::Dark,
            accent: pero_contracts::appearance::AccentColor::Blue,
            typography: serde_json::from_str(r#"{"ui_size":18,"chat_size":20}"#).unwrap(),
            projects: vec![pero_contracts::workbench::ProjectBinding {
                workspace: "/work/pero".into(), project_id: "pero".into(),
            }],
            research_projects: vec![pero_contracts::research_project::ResearchProject::new(
                "research-1".into(), "Control comparison".into(), "Compare held-out scenarios".into(),
                Some("/work/pero".into()),
            ).unwrap()],
            layout: {
                let mut layout = pero_contracts::workbench::LayoutPreferences::default();
                layout.resize_chat(512.);
                layout.chat_open = true;
                layout
            },
        };
        save_harness(&path, &pero_contracts::harness_settings::HarnessSettings {
            endpoint: "https://api.deepseek.com".into(), model: "deepseek-chat".into(), encrypted_api_key: Some("Y2lwaGVy".into()),
        }).unwrap();
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
        assert_eq!(value["harness"]["model"], "deepseek-chat");
        assert_eq!(value["harness"]["encrypted_api_key"], "Y2lwaGVy");
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

/// User-managed MCP settings are local Host preferences, never worker credentials.
pub fn load_mcp(
    path: &Path,
    agent_id: &str,
) -> Result<pero_contracts::mcp::McpConfiguration, pero_contracts::mcp::McpSettingsError> {
    use pero_contracts::mcp::{McpConfiguration, McpSettingsError};
    let bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Ok(McpConfiguration::default());
        }
        Err(_) => return Err(McpSettingsError::ReadWrite),
    };
    let value: serde_json::Value =
        serde_json::from_slice(&bytes).map_err(|_| McpSettingsError::ReadWrite)?;
    if !value.is_object() {
        return Err(McpSettingsError::ReadWrite);
    }
    let Some(configurations) = value.get("local_mcp") else {
        return Ok(McpConfiguration::default());
    };
    let configurations = configurations
        .as_object()
        .ok_or(McpSettingsError::ReadWrite)?;
    let Some(configuration) = configurations.get(agent_id) else {
        return Ok(McpConfiguration::default());
    };
    let configuration: McpConfiguration =
        serde_json::from_value(configuration.clone()).map_err(|_| McpSettingsError::Invalid)?;
    Ok(configuration)
}

pub fn save_mcp(
    path: &Path,
    agent_id: &str,
    configuration: &pero_contracts::mcp::McpConfiguration,
) -> io::Result<()> {
    let configuration = serde_json::to_value(configuration)?;
    update(path, |value| {
        if value.get("local_mcp").is_none() {
            value["local_mcp"] = serde_json::json!({});
        }
        value["local_mcp"][agent_id] = configuration;
    })
}

pub fn save_harness(path: &Path, settings: &pero_contracts::harness_settings::HarnessSettings) -> io::Result<()> {
    update(path, |value| value["harness"] = serde_json::to_value(settings).expect("harness settings"))
}

pub fn load_engram(path: &Path) -> pero_contracts::engram::EngramSettings {
    std::fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
        .and_then(|value| serde_json::from_value(value.get("engram")?.clone()).ok())
        .unwrap_or_default()
}

pub fn save_engram(path: &Path, settings: &pero_contracts::engram::EngramSettings) -> io::Result<()> {
    if !settings.valid() {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "engram"));
    }
    let settings = serde_json::to_value(settings)?;
    update(path, |value| value["engram"] = settings)
}
