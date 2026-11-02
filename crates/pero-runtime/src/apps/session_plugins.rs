//! Installed App declarations and local dependencies frozen for one Host session.
use super::{agent_plugin::AppPluginAssembly, AppName, AppStore};
use crate::agent_plugins::{AgentPluginSnapshot, AgentPluginStore};

pub struct AppSessionPlugins {
    pub app: AppName,
    pub assembly: Option<AppPluginAssembly>,
    pub dependencies: AgentPluginSnapshot,
    pub instructions: String,
}

impl AppStore {
    pub fn agent_plugins(&self) -> Result<AgentPluginStore, String> {
        AgentPluginStore::open(
            self.root
                .parent()
                .ok_or("App root needs a parent")?
                .join("agent-plugins"),
        )
    }

    pub(super) fn prepare_agent_plugins(
        &self,
        name: &AppName,
    ) -> Result<AgentPluginSnapshot, String> {
        let app = self.installed.get(name).ok_or("App is not installed")?;
        if app.definition.requires_agent_plugins.is_empty() {
            return Ok(AgentPluginSnapshot::default());
        }
        self.agent_plugins()?.ensure_dependencies(
            &app.definition.requires_agent_plugins,
            &self.root.join(name.as_str()),
        )
    }

    pub fn session_plugins(
        &self,
        name: &AppName,
        panel: &str,
    ) -> Result<Option<AppSessionPlugins>, String> {
        let app = self.installed.get(name).ok_or("App is not installed")?;
        if !app.enabled {
            return Err("App is disabled; enable it before starting a conversation".into());
        }
        if !app
            .definition
            .contributes
            .panels
            .iter()
            .any(|entry| entry.id.as_str() == panel)
        {
            return Err("App conversation panel is not declared".into());
        }
        if app.definition.contributes.agent_plugin.is_none()
            && app.definition.requires_agent_plugins.is_empty()
        {
            return Ok(None);
        }
        self.require_agent(name)?;
        let dependencies = self.prepare_agent_plugins(name)?;
        let mut instructions = dependencies.instructions.join("\n\n");
        for skill in &dependencies.skills {
            instructions.push_str(&format!(
                "\n\nPlugin {} Skill {}:\n{}",
                skill.plugin.as_str(),
                skill.path.display(),
                skill.content
            ));
        }
        let assembly = app
            .definition
            .assemble_agent_plugin(app.definition.revision(), &instructions);
        if let Some(value) = &assembly {
            instructions = value.instructions.clone();
        }
        if instructions.len() > 128_000 {
            return Err("App plugins exceed the 128 KB instruction budget".into());
        }
        Ok(Some(AppSessionPlugins {
            app: name.clone(),
            assembly,
            dependencies,
            instructions,
        }))
    }
}
