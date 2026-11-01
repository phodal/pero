//! Compatibility routes use installed Pero declarations, not foreign manifests.
use super::{AppName, AppStore};
impl AppStore {
    pub fn point_catalog_permission(&self, name: &AppName, path: &str) -> Result<(), String> {
        if !matches!(path, "/api/workspaces" | "/api/harnesses") { return Err("Unsupported App catalog".into()); }
        self.require_agent(name)
    }
    /// Declaration compatibility, not package signature or untrusted-code isolation.
    pub fn agent_declaration_revision(&self, name: &AppName) -> Result<String, String> {
        use sha2::{Digest, Sha256};
        self.require_agent(name)?;
        let bytes = serde_json::to_vec(&self.installed[name].definition).map_err(|e| e.to_string())?;
        Ok(format!("{:x}", Sha256::digest(bytes)))
    }
    pub fn point_agent_panel(&self, name: &AppName) -> Result<String, String> {
        self.require_agent(name)?;
        self.installed[name].definition.contributes.panels.first()
            .map(|panel| panel.id.as_str().to_owned()).ok_or_else(|| "App panel is missing".into())
    }
}
