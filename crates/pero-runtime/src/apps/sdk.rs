//! Public SDK context contains declarations, never backend paths or credentials.
use super::{AppName, AppStore};
use serde::Serialize;

#[derive(Serialize)]
pub struct Permissions { api: Vec<String>, events: Vec<String>, host: Vec<String> }
#[derive(Serialize)]
pub struct Context { name: AppName, version: String, permissions: Permissions }

impl AppStore {
    pub fn sdk_context(&self, name: &AppName) -> Result<Context, String> {
        let app = self.installed.get(name).filter(|app| app.enabled).ok_or("App is not installed or enabled")?;
        let definition = &app.definition;
        let api = definition.permissions.api.clone().unwrap_or_else(|| {
            if definition.backend.is_some() { vec!["/api".into()] }
            else if definition.permissions.host.iter().any(|grant| grant == "agent") { vec!["/api/workspaces".into(), "/api/harnesses".into()] }
            else { Vec::new() }
        });
        Ok(Context { name: name.clone(), version: definition.version.clone(), permissions: Permissions {
            api, events: definition.permissions.events.clone(), host: definition.permissions.host.clone(),
        } })
    }
}
