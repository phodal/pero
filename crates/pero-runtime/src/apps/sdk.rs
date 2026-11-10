//! Public SDK context contains declarations, never backend paths or credentials.
use super::definition::AppColumnHeader;
use super::{AppName, AppStore};
use serde::Serialize;

#[derive(Serialize)]
pub struct Permissions { api: Vec<String>, events: Vec<String>, host: Vec<String> }
#[derive(Serialize)]
pub struct DeclaredPanel { id: AppName, title: String }
#[derive(Serialize)]
pub struct DeclaredAction { name: AppName, description: String }
#[derive(Serialize)]
pub struct DeclaredCanvas { id: AppName, title: String, inputs: serde_json::Value }
/// Discovery is a projection of installed declarations, never an execution grant.
#[derive(Serialize)]
pub struct InstalledAppViews {
    app: AppName, title: String, version: String, revision: String, enabled: bool,
    panels: Vec<DeclaredPanel>, actions: Vec<DeclaredAction>,
    #[serde(skip_serializing_if="Vec::is_empty")]
    canvases: Vec<DeclaredCanvas>,
}
#[derive(Serialize)]
pub struct Context {
    name: AppName, version: String, permissions: Permissions,
    #[serde(rename = "appViews", skip_serializing_if = "Option::is_none")]
    app_views: Option<Vec<InstalledAppViews>>,
    /// Copied from the installed definition. The catalog summary does not carry it.
    #[serde(rename = "columnHeader", skip_serializing_if = "AppColumnHeader::is_empty")]
    column_header: AppColumnHeader,
}

impl AppStore {
    pub fn sdk_context(&self, name: &AppName) -> Result<Context, String> {
        let app = self.installed.get(name).filter(|app| app.enabled).ok_or("App is not installed or enabled")?;
        let definition = &app.definition;
        let api = definition.permissions.api.clone().unwrap_or_else(|| {
            if definition.backend.is_some() { vec!["/api".into()] }
            else if definition.permissions.host.iter().any(|grant| grant == "agent") { vec!["/api/workspaces".into(), "/api/harnesses".into()] }
            else { Vec::new() }
        });
        let app_views = (name.as_str() == "notebook").then(|| self.installed.values().map(|app| {
            let definition = &app.definition;
            InstalledAppViews {
                app: definition.name.clone(), title: definition.display_name.clone(),
                version: definition.version.clone(), revision: definition.revision(), enabled: app.enabled,
                panels: definition.contributes.panels.iter().map(|panel| DeclaredPanel {
                    id: panel.id.clone(), title: panel.title.clone(),
                }).collect(),
                canvases: definition.contributes.canvases.iter().map(|view| DeclaredCanvas {
                    id: view.id.clone(), title: view.title.clone(), inputs: view.inputs.clone(),
                }).collect(),
                actions: definition.contributes.writes.iter().map(|action| DeclaredAction {
                    name: action.name.clone(), description: action.description.clone(),
                }).collect(),
            }
        }).collect());
        Ok(Context {
            name: name.clone(),
            version: definition.version.clone(),
            app_views,
            permissions: Permissions {
                api, events: definition.permissions.events.clone(), host: definition.permissions.host.clone(),
            },
            column_header: definition.contributes.column_header.clone(),
        })
    }
}

impl Permissions {
    fn require_api(&self,path:&str)->Result<(),String> {
        if self.api.iter().any(|prefix| path==prefix || path.strip_prefix(prefix).is_some_and(|tail| tail.starts_with('/'))) {Ok(())}
        else {Err("App API path is not declared".into())}
    }
}
impl AppStore {
    pub fn require_api(&self,name:&AppName,path:&str)->Result<(),String> { self.sdk_context(name)?.permissions.require_api(path) }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn declared_api_prefix() {
        let permissions=Permissions{api:vec!["/api/data".into()],events:vec![],host:vec![]};
        for (path,allowed) in [("/api/data",true),("/api/data/item",true),("/api/data-other",false),("/api/private",false),("https://example.invalid/api/data",false)] {
            assert_eq!(permissions.require_api(path).is_ok(),allowed,"{path}");
        }
    }
}
