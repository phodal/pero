//! App-authored instructions and fixed tools assembled for one Host conversation.
use super::definition::{AppDefinition, AppName, AppWriteRoute};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AppAgentPlugin {
    pub schema: String,
    pub instructions: String,
    /// Names refer to this App's existing contributes.writes declarations.
    pub tools: Vec<AppName>,
    pub max_calls: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prepare_tool: Option<AppName>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_schema: Option<serde_json::Value>,
    #[serde(skip)]
    pub(crate) preparation: Option<std::sync::Arc<super::agent_preparation::AgentContextPreparation>>,
}

/// A frozen declaration, not a second session or execution owner.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AppPluginAssembly {
    pub app: AppName,
    pub revision: String,
    pub instructions: String,
    pub tools: Vec<AppWriteRoute>,
    pub max_calls: u32,
    /// Only Host composition can lend a durable budget owner; manifests cannot.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub host_budgeted: bool,
}

impl AppDefinition {
    pub(super) fn validate_agent_plugin(&mut self) -> Result<(), String> {
        let mut dependencies = BTreeSet::new();
        if self.requires_agent_plugins.len() > 32
            || self
                .requires_agent_plugins
                .iter()
                .any(|name| !dependencies.insert(name))
        {
            return Err("App requiresAgentPlugins needs at most 32 unique plugin names".into());
        }
        if !self.requires_agent_plugins.is_empty()
            && !self.permissions.host.iter().any(|grant| grant == "agent")
        {
            return Err("App requiresAgentPlugins requires the agent Host permission".into());
        }
        let Some(plugin) = &mut self.contributes.agent_plugin else {
            return Ok(());
        };
        if self.backend.is_none()
            || !["agent", "agent-plugin"].iter().all(|grant| {
                self.permissions
                    .host
                    .iter()
                    .any(|declared| declared == grant)
            })
        {
            return Err(
                "App agentPlugin requires a backend and agent and agent-plugin Host permissions"
                    .into(),
            );
        }
        if plugin.schema != "pero.app-agent-plugin.v1"
            || plugin.instructions.trim().is_empty()
            || plugin.instructions.len() > 12_000
            || plugin.instructions.contains('\0')
            || !(1..=100).contains(&plugin.max_calls)
            || plugin.tools.is_empty()
        {
            return Err("App agentPlugin needs v1 instructions, tools and maxCalls 1–100".into());
        }
        let mut tools = BTreeSet::new();
        for name in &plugin.tools {
            if !tools.insert(name)
                || !self
                    .contributes
                    .writes
                    .iter()
                    .any(|route| route.name == *name)
                || format!("app__{}__{}", self.name.as_str(), name.as_str()).len() > 64
            {
                return Err("App agentPlugin tools must uniquely name declared writes with MCP names of at most 64 bytes".into());
            }
        }
        match (&plugin.prepare_tool, &plugin.context_schema) {
            (None,None) => {},
            (Some(name),Some(schema)) => {
                let route=self.contributes.writes.iter().find(|route| &route.name==name && !plugin.tools.contains(name))
                    .ok_or("App preparation must name a declared write outside the Agent tool allowlist")?;
                plugin.preparation=Some(std::sync::Arc::new(super::agent_preparation::AgentContextPreparation::compile(route.clone(),schema)?));
            }
            _ => return Err("App preparation needs both prepareTool and contextSchema".into()),
        }
        Ok(())
    }

    /// Declaration identity is shared by persistence and tool freshness checks.
    pub fn revision(&self) -> String {
        let bytes = serde_json::to_vec(self).expect("App declaration contains serializable values");
        format!("{:x}", Sha256::digest(bytes))
    }

    pub fn assemble_agent_plugin(
        &self,
        revision: String,
        dependency_instructions: &str,
    ) -> Option<AppPluginAssembly> {
        let plugin = self.contributes.agent_plugin.as_ref()?;
        let instructions = if dependency_instructions.is_empty() {
            plugin.instructions.clone()
        } else {
            format!("{}\n\n{}", plugin.instructions, dependency_instructions)
        };
        Some(AppPluginAssembly {
            app: self.name.clone(),
            revision,
            instructions,
            tools: plugin
                .tools
                .iter()
                .map(|name| {
                    self.contributes
                        .writes
                        .iter()
                        .find(|route| route.name == *name)
                        .expect("App plugin tool was validated at manifest entry")
                        .clone()
                })
                .collect(),
            max_calls: plugin.max_calls,
            host_budgeted: false,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    fn manifest() -> Value {
        json!({
            "schemaVersion":1,"name":"sample","version":"0.1.0","displayName":"Sample",
            "permissions":{"host":["agent","agent-plugin"]},
            "backend":{"type":"python","entry":"backend/server.py"},
            "requiresAgentPlugins":["literature"],
            "contributes":{
                "panels":[{"id":"main","title":"Sample","entry":"dist/index.html"}],
                "writes":[
                    {"name":"research","description":"Research","path":"/api/research","schema":{"type":"object"}},
                    {"name":"publish","description":"Publish","path":"/api/publish","schema":{"type":"object"}}
                ],
                "agentPlugin":{"schema":"pero.app-agent-plugin.v1","instructions":"Inspect sources.","tools":["research"],"maxCalls":4}
            }
        })
    }

    #[test]
    fn app_plugin_declaration_contract() {
        for (label, pointer, value, accepted) in [
            ("unpaired preparation", "/contributes/agentPlugin/prepareTool", json!("publish"), false),
            ("unpaired context", "/contributes/agentPlugin/contextSchema", json!({"type":"object"}), false),
            ("valid", "/contributes/agentPlugin/maxCalls", json!(4), true),
            (
                "wrong schema",
                "/contributes/agentPlugin/schema",
                json!("unsupported.app-agent-plugin.v1"),
                false,
            ),
            (
                "empty instructions",
                "/contributes/agentPlugin/instructions",
                json!("  "),
                false,
            ),
            (
                "oversized instructions",
                "/contributes/agentPlugin/instructions",
                json!("x".repeat(12_001)),
                false,
            ),
            (
                "missing grant",
                "/permissions/host",
                json!(["agent"]),
                false,
            ),
            (
                "missing agent",
                "/permissions/host",
                json!(["agent-plugin"]),
                false,
            ),
            ("missing backend", "/backend", Value::Null, false),
            (
                "no calls",
                "/contributes/agentPlugin/maxCalls",
                json!(0),
                false,
            ),
            (
                "budget overflow",
                "/contributes/agentPlugin/maxCalls",
                json!(101),
                false,
            ),
            (
                "no tools",
                "/contributes/agentPlugin/tools",
                json!([]),
                false,
            ),
            (
                "undeclared tool",
                "/contributes/agentPlugin/tools",
                json!(["other"]),
                false,
            ),
            (
                "duplicate tool",
                "/contributes/agentPlugin/tools",
                json!(["research", "research"]),
                false,
            ),
            (
                "both tools",
                "/contributes/agentPlugin/tools",
                json!(["research", "publish"]),
                true,
            ),
            (
                "duplicate dependency",
                "/requiresAgentPlugins",
                json!(["literature", "literature"]),
                false,
            ),
            (
                "too many dependencies",
                "/requiresAgentPlugins",
                json!((0..33).map(|i| format!("plugin-{i}")).collect::<Vec<_>>()),
                false,
            ),
            (
                "unsafe dependency",
                "/requiresAgentPlugins",
                json!(["../literature"]),
                false,
            ),
        ] {
            let mut candidate = manifest();
            let (parent,key)=pointer.rsplit_once('/').unwrap();
            candidate.pointer_mut(parent).unwrap()[key] = value;
            let result = AppDefinition::parse(&serde_json::to_vec(&candidate).unwrap());
            assert_eq!(result.is_ok(), accepted, "{label}: {result:?}");
        }
    }

    #[test]
    fn session_assembly_limits_tools_and_combines_domain_instructions() {
        let definition = AppDefinition::parse(&serde_json::to_vec(&manifest()).unwrap()).unwrap();
        let assembly = definition
            .assemble_agent_plugin(definition.revision(), "Read the literature skill.")
            .unwrap();
        assert_eq!(
            assembly
                .tools
                .iter()
                .map(|tool| tool.name.as_str())
                .collect::<Vec<_>>(),
            ["research"]
        );
        assert_eq!(
            assembly.instructions,
            "Inspect sources.\n\nRead the literature skill."
        );
        let mut changed = definition.clone();
        changed
            .contributes
            .agent_plugin
            .as_mut()
            .unwrap()
            .instructions
            .push_str(" Cite evidence.");
        assert_ne!(assembly.revision, changed.revision());
    }
}
