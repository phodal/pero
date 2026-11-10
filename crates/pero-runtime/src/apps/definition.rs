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
    #[serde(default, rename = "frameOrigins", skip_serializing_if = "Vec::is_empty")]
    pub frame_origins: Vec<AppFrameOrigin>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub events: Vec<String>,
    #[serde(default)]
    pub host: Vec<String>,
}

/// Exact HTTPS origins an App may embed; never a CSP expression or URL prefix.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(try_from = "String", into = "String")]
pub struct AppFrameOrigin(String);
impl TryFrom<String> for AppFrameOrigin {
    type Error = String;
    fn try_from(value: String) -> Result<Self, String> {
        let parsed = url::Url::parse(&value).map_err(|_| "Invalid App frame origin")?;
        if value.len() > 256 || parsed.scheme() != "https" || parsed.origin().ascii_serialization() != value {
            return Err("App frame origins must be exact HTTPS origins without paths or credentials".into());
        }
        Ok(Self(value))
    }
}
impl From<AppFrameOrigin> for String {
    fn from(value: AppFrameOrigin) -> Self { value.0 }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct AppWriteRoute {
    pub name: AppName,
    pub description: String,
    pub path: String,
    pub schema: serde_json::Value,
}

/// Actions an App contributes to the host main column's ColumnHeader.
/// Empty actions means that header has no app actions.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct AppColumnHeader {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub actions: Vec<AppColumnHeaderAction>,
}

impl AppColumnHeader {
    pub(crate) fn is_empty(&self) -> bool {
        self.actions.is_empty()
    }
}

/// One action the host places in the main column's ColumnHeader.
/// `id` stays stable across states; `icon` is a shared icon name.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct AppColumnHeaderAction {
    pub id: AppName,
    pub label: String,
    /// Chinese label. The shell picks this when the workbench locale is Chinese.
    #[serde(default, rename = "zh", skip_serializing_if = "Option::is_none")]
    pub chinese_label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct AppContributions {
    pub panels: Vec<AppPanel>,
    #[serde(default,skip_serializing_if="Vec::is_empty")]
    pub writes: Vec<AppWriteRoute>,
    #[serde(default, rename = "agentPlugin", skip_serializing_if = "Option::is_none")]
    pub agent_plugin: Option<super::agent_plugin::AppAgentPlugin>,
    #[serde(default, rename = "columnHeader", skip_serializing_if = "AppColumnHeader::is_empty")]
    pub column_header: AppColumnHeader,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct AppBackend {
    #[serde(rename = "type")]
    pub kind: BackendKind,
    pub entry: String,
    /// Interpreter minor, such as `3.12`. Preparation installs it when the
    /// selected environment is a different minor.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub python: Option<PythonMinor>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub dependencies: Vec<PythonDependency>,
}

/// A CPython minor. The Host can install the bundled minor and can ask uv for another.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(try_from = "String", into = "String")]
pub struct PythonMinor(String);
impl PythonMinor {
    pub fn as_str(&self) -> &str {
        &self.0
    }
}
impl TryFrom<String> for PythonMinor {
    type Error = String;
    fn try_from(value: String) -> Result<Self, String> {
        let Some((major, minor)) = value.split_once('.') else {
            return Err("Python version must be a minor such as 3.12".into());
        };
        if value.len() > 8
            || major.is_empty()
            || minor.is_empty()
            || !major.bytes().all(|byte| byte.is_ascii_digit())
            || !minor.bytes().all(|byte| byte.is_ascii_digit())
        {
            return Err("Python version must be a minor such as 3.12".into());
        }
        Ok(Self(value))
    }
}
impl From<PythonMinor> for String {
    fn from(value: PythonMinor) -> Self {
        value.0
    }
}

/// A pinned package requirement, never a pip option, URL or setup command.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(try_from = "String", into = "String")]
pub struct PythonDependency(String);
impl PythonDependency {
    pub fn as_str(&self) -> &str { &self.0 }
}
impl TryFrom<String> for PythonDependency {
    type Error = String;
    fn try_from(value: String) -> Result<Self, String> {
        let (name, version) = value.split_once("==").ok_or("Python dependency must be pinned as package==version")?;
        if name.is_empty() || version.is_empty() || value.len() > 200
            || !name.starts_with(|c: char| c.is_ascii_alphanumeric())
            || !name.bytes().all(|c| c.is_ascii_alphanumeric() || b"-_.".contains(&c))
            || !version.bytes().all(|c| c.is_ascii_alphanumeric() || b".+!-_".contains(&c)) {
            return Err("Invalid pinned Python dependency".into());
        }
        Ok(Self(value))
    }
}
impl From<PythonDependency> for String {
    fn from(value: PythonDependency) -> Self { value.0 }
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
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub requires_agent_plugins: Vec<AppName>,
    pub backend: Option<AppBackend>,
}

/// Public catalog projection. Backend credentials and filesystem paths stay private.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSummary {
    pub name: AppName,
    pub version: String,
    pub revision: String,
    pub display_name: String,
    pub description: String,
    pub enabled: bool,
    pub tenure: super::Tenure,
    pub panels: Vec<AppPanel>,
    #[serde(skip_serializing_if="Vec::is_empty")]
    pub writes: Vec<AppWriteRoute>,
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
        let mut value: Self = serde_json::from_slice(bytes).map_err(|error| error.to_string())?;
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
        let mut seen = std::collections::BTreeSet::new();
        if value.permissions.frame_origins.len() > 16 {
            return Err("App frame permissions allow at most 16 origins".into());
        }
        for grant in &value.permissions.host {
            if !matches!(grant.as_str(), "agent" | "agent-plugin" | "insights" | "connectors" | "automation" | "research-assets" | "environments" | "skills") || !seen.insert(grant.as_str()) {
                return Err(
                    "This Host supports only the App agent, agent-plugin, insights, connectors, automation, research-assets, environments and skills permissions".into(),
                );
            }
        }
        if let Some(paths) = &value.permissions.api {
            if paths.len() > 64 || paths.iter().any(|path| !path.starts_with("/api") || (path != "/api" && !path.starts_with("/api/")) || path.contains(['?', '#', '\\']) || !relative_entry(&path[1..])) {
                return Err("App API permissions require at most 64 local /api prefixes".into());
            }
        }
        if value.permissions.events.len() > 64 || value.permissions.events.iter().any(|event| event.is_empty() || event.len() > 128 || !event.bytes().all(|byte| byte.is_ascii_alphanumeric() || b"_.:-*".contains(&byte))) {
            return Err("App event permissions require at most 64 named events".into());
        }
        if value.contributes.panels.is_empty() || value.contributes.panels.len() > 8 {
            return Err("This Host supports one to eight App panels".into());
        }
        if value.contributes.column_header.actions.len() > 16 {
            return Err("App columnHeader allows at most 16 actions".into());
        }
        let mut action_ids = std::collections::BTreeSet::new();
        for action in &value.contributes.column_header.actions {
            let icon_ok = action
                .icon
                .as_ref()
                .is_none_or(|icon| AppName::try_from(icon.clone()).is_ok());
            let chinese_ok = action.chinese_label.as_ref().is_none_or(|label| {
                !label.trim().is_empty() && label.len() <= 200
            });
            if !action_ids.insert(action.id.as_str())
                || action.label.trim().is_empty()
                || action.label.len() > 200
                || !icon_ok
                || !chinese_ok
            {
                return Err(
                    "App columnHeader action needs a unique id, a label, and an optional icon name"
                        .into(),
                );
            }
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
        if value.contributes.writes.len()>32 || !value.contributes.writes.is_empty()&&value.backend.is_none(){return Err("App write routes require a backend and at most 32 declarations".into());}
        let mut names=std::collections::BTreeSet::new();
        for route in &value.contributes.writes {
            if !names.insert(route.name.as_str())||route.description.trim().is_empty()||route.description.len()>1000||!route.path.starts_with("/api/")||!relative_entry(&route.path[1..])||!route.schema.is_object()||serde_json::to_vec(&route.schema).map_err(|e|e.to_string())?.len()>16384{return Err("App write route needs a unique name, description, local /api path and bounded schema".into());}
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
            if (backend.python.is_some() && !matches!(backend.kind, BackendKind::Python))
                || backend.dependencies.len() > 64
                || matches!(backend.kind, BackendKind::Node) && !backend.dependencies.is_empty()
            {
                return Err(
                    "Python dependencies and a Python version require a Python backend, with at most 64 pinned packages".into(),
                );
            }
            if !relative_entry(&backend.entry) || !supported {
                return Err(
                    "Backend entry must be relative and match its runtime extension".into(),
                );
            }
        }
        value.validate_agent_plugin()?;
        Ok(value)
    }

    pub fn summary(&self, enabled: bool) -> AppSummary {
        AppSummary {
            name: self.name.clone(),
            version: self.version.clone(),
            revision: self.revision(),
            display_name: self.display_name.clone(),
            description: self.description.clone(),
            enabled,
            tenure: super::Tenure::Optional,
            panels: self.contributes.panels.clone(),
            writes: self.contributes.writes.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn frame_origins_are_exact_https_origins() {
        for (origin, accepted) in [
            ("https://arxiv.org", true), ("https://example.org:8443", true),
            ("http://arxiv.org", false), ("https://arxiv.org/html/1234.56789v1", false),
            ("https://user@arxiv.org", false), ("https://arxiv.org/", false),
            ("*", false), ("https://arxiv.org; script-src *", false),
        ] {
            assert_eq!(AppFrameOrigin::try_from(origin.to_owned()).is_ok(), accepted, "{origin}");
        }
    }
    #[test]
    fn builtin_paper_manifest_and_write_capacity() {
        // Exercise the actual packaged manifest at the Host validation boundary:
        // a valid JSON/UI build alone does not guarantee App registration.
        let bytes = include_bytes!("../../../../apps/paper-agent/app.json");
        let paper = AppDefinition::parse(bytes).expect("builtin Paper manifest must register");
        assert!(paper.contributes.writes.iter().any(|route| route.name.as_str() == "scientific-document"));
        let mut candidate: serde_json::Value = serde_json::from_slice(bytes).unwrap();
        for (count, accepted) in [(32, true), (33, false)] {
            candidate["contributes"]["writes"] = serde_json::json!((0..count).map(|index| {
                serde_json::json!({"name":format!("route-{index}"), "description":"Bounded route",
                    "path":format!("/api/route-{index}"), "schema":{"type":"object"}})
            }).collect::<Vec<_>>());
            let result = AppDefinition::parse(&serde_json::to_vec(&candidate).unwrap());
            assert_eq!(result.is_ok(), accepted, "{count} unique routes: {result:?}");
            if !accepted { assert!(result.unwrap_err().contains("at most 32 declarations")); }
        }
    }

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
            ("permissions", serde_json::json!({"api":["/api/data"],"events":["app:written"]}), true),
            ("permissions", serde_json::json!({"api":["https://example.invalid/api"]}), false),
            ("permissions", serde_json::json!({"api":["/api/../private"]}), false),
            ("permissions", serde_json::json!({"api":["/api/data?token=x"]}), false),
            ("permissions", serde_json::json!({"events":[""]}), false),
            ("permissions", serde_json::json!({"host":["shell"]}), false),
            ("permissions", serde_json::json!({"host":["agent"]}), true),
            ("permissions", serde_json::json!({"host":["insights"]}), true),
            ("permissions", serde_json::json!({"host":["connectors"]}), true),
            ("permissions", serde_json::json!({"host":["research-assets"]}), true),
            ("permissions", serde_json::json!({"host":["environments"]}), true),
            ("permissions", serde_json::json!({"host":["skills"]}), true),
            ("permissions", serde_json::json!({"host":["skills","skills"]}), false),
            ("permissions", serde_json::json!({"host":["environments","environments"]}), false),
            ("permissions", serde_json::json!({"host":["agent","insights"]}), true),
            ("permissions", serde_json::json!({"host":["agent","agent"]}), false),
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
            ("backend", serde_json::json!({"type":"python","entry":"server.py","dependencies":["numpy==2.2.6"]}), true),
            ("backend", serde_json::json!({"type":"python","entry":"server.py","python":"3.12"}), true),
            ("backend", serde_json::json!({"type":"python","entry":"server.py","python":"3.12.1"}), false),
            ("backend", serde_json::json!({"type":"node","entry":"server.mjs","python":"3.12"}), false),
            ("backend", serde_json::json!({"type":"python","entry":"server.py","dependencies":["--index-url==bad"]}), false),
            ("backend", serde_json::json!({"type":"python","entry":"server.py","dependencies":["https://example.org/pkg"]}), false),
            ("backend", serde_json::json!({"type":"python","entry":"server.py","dependencies":["numpy"]}), false),
            ("backend", serde_json::json!({"type":"node","entry":"server.mjs","dependencies":["numpy==2.2.6"]}), false),
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
        for (path, backend, schema, copies, accepted) in [
            ("/api/import", true, serde_json::json!({"type":"object"}), 1, true),
            ("/api/import", false, serde_json::json!({"type":"object"}), 1, false),
            ("https://example.org/api/import", true, serde_json::json!({"type":"object"}), 1, false),
            ("/api/../../private", true, serde_json::json!({"type":"object"}), 1, false),
            ("/host/agent", true, serde_json::json!({"type":"object"}), 1, false),
            ("/api/import", true, serde_json::json!([]), 1, false),
            ("/api/import", true, serde_json::json!({"type":"object"}), 2, false),
            ("/api/import", true, serde_json::json!({"type":"object"}), 17, false),
        ] {
            let mut candidate=valid.clone();
            if backend {candidate["backend"]=serde_json::json!({"type":"python","entry":"server.py"});}
            candidate["contributes"]["writes"]=serde_json::json!(vec![serde_json::json!({"name":"import","description":"Import a document","path":path,"schema":schema});copies]);
            assert_eq!(AppDefinition::parse(&serde_json::to_vec(&candidate).unwrap()).is_ok(),accepted,"{path}, {copies} writes");
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

    #[test]
    fn column_header_actions() {
        let base = serde_json::json!({"schemaVersion":1,"name":"virtual-cell","version":"0.1.0",
            "displayName":"Virtual Cell","contributes":{"panels":[{"id":"main","title":"Cell","entry":"dist/index.html"}]}});
        let too_many = serde_json::json!({
            "actions": (0..17).map(|index| serde_json::json!({"id": format!("action-{index}"), "label": "Action"})).collect::<Vec<_>>()
        });
        let long_label = "x".repeat(201);
        for (header, accepted) in [
            (None, true),
            (Some(serde_json::json!({"actions":[{"id":"import","label":"Import","zh":"导入","icon":"upload"}]})), true),
            (Some(serde_json::json!({"actions":[{"id":"import","label":"Import","icon":"upload"}]})), true),
            (Some(serde_json::json!({"actions":[{"id":"import","label":"Import"}]})), true),
            (Some(serde_json::json!({"actions":[{"id":"chevron-right","label":"Next","icon":"chevron-right"}]})), true),
            (Some(serde_json::json!({"actions":[]})), true),
            (Some(serde_json::json!({})), true),
            (Some(serde_json::json!({"actions":[{"label":"Import"}]})), false),
            (Some(serde_json::json!({"actions":[{"id":"import"}]})), false),
            (Some(serde_json::json!({"actions":[{"id":"","label":"Import"}]})), false),
            (Some(serde_json::json!({"actions":[{"id":"Import","label":"Import"}]})), false),
            (Some(serde_json::json!({"actions":[{"id":"import","label":""}]})), false),
            (Some(serde_json::json!({"actions":[{"id":"import","label":" "}]})), false),
            (Some(serde_json::json!({"actions":[{"id":"import","label": long_label}]})), false),
            (Some(serde_json::json!({"actions":[{"id":"import","label":"Import","zh":""}]})), false),
            (Some(serde_json::json!({"actions":[{"id":"import","label":"Import","zh":" "}]})), false),
            (Some(serde_json::json!({"actions":[{"id":"import","label":"Import","icon":"../upload.svg"}]})), false),
            (Some(serde_json::json!({"actions":[{"id":"import","label":"Import","icon":""}]})), false),
            (Some(serde_json::json!({"actions":[{"id":"import","label":"Import"}],"primary":"App"})), false),
            (Some(serde_json::json!({"actions":[{"id":"import","label":"Import","shortcut":true}]})), false),
            (Some(serde_json::json!({"actions":[{"id":"import","label":"Import"},{"id":"import","label":"Again"}]})), false),
            (Some(too_many), false),
        ] {
            let mut candidate = base.clone();
            if let Some(header) = &header {
                candidate["contributes"]["columnHeader"] = header.clone();
            }
            let result = AppDefinition::parse(&serde_json::to_vec(&candidate).unwrap());
            assert_eq!(result.is_ok(), accepted, "{header:?} {result:?}");
        }

        let declared = AppDefinition::parse(&serde_json::to_vec(&base).unwrap()).unwrap();
        assert!(declared.contributes.column_header.actions.is_empty());
        assert!(serde_json::to_value(&declared).unwrap()["contributes"].get("columnHeader").is_none());
        let mut empty = base.clone();
        empty["contributes"]["columnHeader"] = serde_json::json!({"actions":[]});
        let empty = AppDefinition::parse(&serde_json::to_vec(&empty).unwrap()).unwrap();
        assert!(empty.contributes.column_header.actions.is_empty());
        assert_eq!(declared.revision(), empty.revision());

        let mut ready = base.clone();
        ready["contributes"]["columnHeader"] = serde_json::json!({"actions":[{"id":"import","label":"Import","icon":"upload"}]});
        let ready = AppDefinition::parse(&serde_json::to_vec(&ready).unwrap()).unwrap();
        let action = &ready.contributes.column_header.actions[0];
        assert_eq!(action.id.as_str(), "import");
        assert_eq!(action.label, "Import");
        assert_eq!(action.icon.as_deref(), Some("upload"));
        assert!(action.chinese_label.is_none());
        let mut localized = base.clone();
        localized["contributes"]["columnHeader"] = serde_json::json!({"actions":[{"id":"import","label":"Import","zh":"导入"}]});
        let localized = AppDefinition::parse(&serde_json::to_vec(&localized).unwrap()).unwrap();
        assert_eq!(
            localized.contributes.column_header.actions[0].chinese_label.as_deref(),
            Some("导入")
        );
    }
}
