use serde::{Deserialize, Serialize};
use std::path::{Component, Path};

/// An installed App's stable identity. It is also its directory and URL segment.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(try_from = "String", into = "String")]
pub struct AppName(String);

impl AppName {
    pub fn as_str(&self) -> &str {
        &self.0
    }
}
impl TryFrom<String> for AppName {
    type Error = String;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        if value.is_empty()
            || value.len() > 64
            || value.starts_with('-')
            || value.ends_with('-')
            || value.contains("--")
            || !value
                .bytes()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
        {
            return Err(
                "App name must contain lowercase letters, digits and interior hyphens".into(),
            );
        }
        Ok(Self(value))
    }
}
impl From<AppName> for String {
    fn from(value: AppName) -> Self {
        value.0
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct AppPanel {
    pub id: AppName,
    pub title: String,
    pub entry: String,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct AppPermissions {
    #[serde(default)]
    pub host: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct AppContributions {
    pub panels: Vec<AppPanel>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct AppBackend {
    #[serde(rename = "type")]
    pub kind: BackendKind,
    pub entry: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum BackendKind {
    Python,
    Node,
}

/// Versioned package declaration. Parsing is the one manifest validation boundary.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AppDefinition {
    pub schema_version: u32,
    pub name: AppName,
    pub version: String,
    pub display_name: String,
    #[serde(default)]
    pub description: String,
    pub contributes: AppContributions,
    #[serde(default)]
    pub permissions: AppPermissions,
    pub backend: Option<AppBackend>,
}

/// Public catalog projection. Backend credentials and filesystem paths stay private.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSummary {
    pub name: AppName,
    pub version: String,
    pub display_name: String,
    pub description: String,
    pub enabled: bool,
    pub panels: Vec<AppPanel>,
}

pub(super) fn relative_entry(value: &str) -> bool {
    !value.is_empty()
        && !value.contains(['\\', ':', '\0'])
        && Path::new(value)
            .components()
            .all(|part| matches!(part, Component::Normal(_)))
}

impl AppDefinition {
    pub fn parse(bytes: &[u8]) -> Result<Self, String> {
        if bytes.len() > 64 * 1024 {
            return Err("App manifest exceeds 64 KiB".into());
        }
        let value: Self = serde_json::from_slice(bytes).map_err(|error| error.to_string())?;
        if value.schema_version != 1 {
            return Err("Unsupported App schemaVersion; expected 1".into());
        }
        if value.version.is_empty()
            || value.version.len() > 64
            || value.display_name.trim().is_empty()
            || value.display_name.len() > 200
            || value.description.len() > 4096
        {
            return Err("Invalid App version, displayName or description".into());
        }
        // This first surface exposes only the App's own backend. Adding Host grants
        // requires a corresponding operation at the owning Host boundary.
        if !value.permissions.host.is_empty() {
            return Err("This Host does not support App host permissions yet".into());
        }
        if value.contributes.panels.len() != 1 {
            return Err("This Host requires exactly one App panel".into());
        }
        for panel in &value.contributes.panels {
            if panel.title.trim().is_empty()
                || panel.title.len() > 200
                || !relative_entry(&panel.entry)
                || !panel.entry.ends_with(".html")
            {
                return Err("App panel needs a title and relative HTML entry".into());
            }
        }
        if let Some(backend) = &value.backend {
            let supported = match backend.kind {
                BackendKind::Python => backend.entry.ends_with(".py"),
                BackendKind::Node => {
                    backend.entry.ends_with(".mjs")
                        || backend.entry.ends_with(".js")
                        || backend.entry.ends_with(".cjs")
                }
            };
            if !relative_entry(&backend.entry) || !supported {
                return Err(
                    "Backend entry must be relative and match its runtime extension".into(),
                );
            }
        }
        Ok(value)
    }

    pub fn summary(&self, enabled: bool) -> AppSummary {
        AppSummary {
            name: self.name.clone(),
            version: self.version.clone(),
            display_name: self.display_name.clone(),
            description: self.description.clone(),
            enabled,
            panels: self.contributes.panels.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn manifest_contract() {
        let valid = serde_json::json!({"schemaVersion":1,"name":"virtual-cell","version":"0.1.0",
            "displayName":"Virtual Cell","contributes":{"panels":[{"id":"main","title":"Cell","entry":"dist/index.html"}]}});
        for (key, value, accepted) in [
            ("schemaVersion", serde_json::json!(1), true),
            ("schemaVersion", serde_json::json!(2), false),
            ("name", serde_json::json!("../escape"), false),
            ("name", serde_json::json!("-cell"), false),
            ("displayName", serde_json::json!(" "), false),
            ("permissions", serde_json::json!({"host":["shell"]}), false),
            (
                "backend",
                serde_json::json!({"type":"python","entry":"../server.py"}),
                false,
            ),
            (
                "backend",
                serde_json::json!({"type":"node","entry":"server.mjs"}),
                true,
            ),
            (
                "backend",
                serde_json::json!({"type":"node","entry":"../server.mjs"}),
                false,
            ),
            (
                "backend",
                serde_json::json!({"type":"node","entry":"server.py"}),
                false,
            ),
            (
                "backend",
                serde_json::json!({"type":"ruby","entry":"server.rb"}),
                false,
            ),
            ("extra", serde_json::json!(true), false),
        ] {
            let mut candidate = valid.clone();
            candidate[key] = value;
            assert_eq!(
                AppDefinition::parse(&serde_json::to_vec(&candidate).unwrap()).is_ok(),
                accepted,
                "{key}"
            );
        }
        for entry in [
            "/index.html",
            "../index.html",
            "dist\\index.html",
            "dist/index.js",
            "C:/index.html",
        ] {
            let mut candidate = valid.clone();
            candidate["contributes"]["panels"][0]["entry"] = entry.into();
            assert!(
                AppDefinition::parse(&serde_json::to_vec(&candidate).unwrap()).is_err(),
                "{entry}"
            );
        }
    }
}
