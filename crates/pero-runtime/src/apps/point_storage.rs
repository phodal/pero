//! Point's App config API, under the existing installed App/data authority.
use super::super::{AppName, AppStore};
use serde::Deserialize;

#[derive(Deserialize)]
struct Manifest { permissions: Permissions, #[serde(default)] contributes: Contributions }
#[derive(Default, Deserialize)]
struct Contributions { #[serde(default, rename="panelTabs")] panels: Vec<PointPanel> }
#[derive(Deserialize)]
struct PointPanel { id: String }
#[derive(Deserialize)]
struct Permissions { #[serde(default)] storage: bool, #[serde(default)] api: Vec<String>, #[serde(default)] host: Vec<String> }

impl AppStore {
    pub fn point_config(&mut self, name: &AppName, value: Option<serde_json::Value>) -> Result<serde_json::Value, String> {
        let app = self.installed.get(name).ok_or("App is not installed")?;
        if !app.enabled { return Err("App is disabled".into()); }
        let metadata = self.root.join(name.as_str()).join("point-source/app.json");
        let manifest: Manifest = serde_json::from_slice(&std::fs::read(metadata).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        let route = format!("/api/apps/{}/config", name.as_str());
        if !manifest.permissions.storage || !manifest.permissions.api.contains(&route) { return Err("Point App storage permission denied".into()); }
        let directory = self.data.join(name.as_str());
        let path = directory.join("config.json");
        if let Some(value) = value {
            let bytes = serde_json::to_vec(&value).map_err(|e| e.to_string())?;
            if !value.is_object() || bytes.len() > 1048576 { return Err("Point App config must be a JSON object within 1 MiB".into()); }
            std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
            let pending = directory.join(format!(".config-{}.json", uuid::Uuid::new_v4()));
            std::fs::write(&pending, bytes).map_err(|e| e.to_string())?;
            if let Err(error) = std::fs::rename(&pending, &path) {
                let _ = std::fs::remove_file(pending);
                return Err(error.to_string());
            }
        }
        if !path.exists() { return Ok(serde_json::json!({})); }
        let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
        if bytes.len() > 1048576 { return Err("Stored Point App config exceeds 1 MiB".into()); }
        serde_json::from_slice(&bytes).map_err(|e| e.to_string())
    }
}

impl AppStore {
    /// One local Project journal shared by Apps, under the Pero data home.
    pub fn point_project_root(&self, name: &AppName, path: &str) -> Result<std::path::PathBuf, String> {
        let app = self.installed.get(name).ok_or("App is not installed")?;
        if !app.enabled { return Err("App is disabled".into()); }
        let pathname = path.split('?').next().unwrap_or(path);
        if pathname != "/api/projects" && !pathname.starts_with("/api/projects/") { return Err("Unsupported Point Host API".into()); }
        let metadata = self.root.join(name.as_str()).join("point-source/app.json");
        let manifest: Manifest = serde_json::from_slice(&std::fs::read(metadata).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        if !manifest.permissions.api.iter().any(|route| pathname == route || pathname.starts_with(&format!("{route}/"))) { return Err("Point Project permission denied".into()); }
        Ok(self.root.parent().ok_or("App root needs a parent")?.join("point-projects"))
    }
}

impl AppStore {
    pub fn point_catalog_permission(&self,name:&AppName,path:&str)->Result<(),String> {
        if !matches!(path,"/api/workspaces"|"/api/harnesses"){return Err("Unsupported Point catalog".into());}
        let app=self.installed.get(name).ok_or("App is not installed")?;
        if !app.enabled{return Err("App is disabled".into());}
        let manifest:Manifest=serde_json::from_slice(&std::fs::read(self.root.join(name.as_str()).join("point-source/app.json")).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
        if !manifest.permissions.api.iter().any(|route|route==path){return Err("Point catalog permission denied".into());}Ok(())
    }
    pub fn point_agent_panel(&self,name:&AppName)->Result<String,String> {
        self.require_agent(name)?;
        let manifest:Manifest=serde_json::from_slice(&std::fs::read(self.root.join(name.as_str()).join("point-source/app.json")).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
        if !manifest.permissions.host.iter().any(|grant|grant=="agent"){return Err("Point Agent permission denied".into());}
        manifest.contributes.panels.first().map(|panel|panel.id.clone()).ok_or_else(||"Point App panel is missing".into())
    }
}
