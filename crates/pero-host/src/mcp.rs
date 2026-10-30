//! Local settings admission. This path never reaches a remote Worker or starts MCP clients.
use super::Manager;
use pero_contracts::{
    HostEvent,
    mcp::{
        McpConfiguration, McpSettingsError, McpSettingsErrorProjection, McpSettingsProjection,
        McpSettingsRequest,
    },
};
use pero_runtime::settings;

impl Manager {
    pub(super) fn mcp_configuration(
        &self,
        agent: &pero_runtime::acp::AgentConfig,
    ) -> Result<McpConfiguration, McpSettingsError> {
        let configuration = self
            .settings_path
            .as_deref()
            .map(|path| settings::load_mcp(path, &agent.id))
            .transpose()?
            .unwrap_or_default();
        configuration.validate(&agent.mcp_server_names())?;
        Ok(configuration)
    }

    pub fn dispatch_mcp(&mut self, value: serde_json::Value) {
        let request_id = value
            .get("request_id")
            .and_then(|v| v.as_str())
            .map(str::to_owned);
        let agent_id = value
            .get("agent_id")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_owned();
        let result = (|| {
            let request: McpSettingsRequest =
                serde_json::from_value(value).map_err(|_| McpSettingsError::Invalid)?;
            if request_id
                .as_ref()
                .is_none_or(|id| id.is_empty() || id.len() > 128)
            {
                return Err(McpSettingsError::Invalid);
            }
            let agent = self
                .agents
                .iter()
                .find(|agent| agent.id == agent_id)
                .ok_or(McpSettingsError::Unavailable)?;
            let current = self.mcp_configuration(agent)?;
            match request {
                McpSettingsRequest::Get { .. } => Ok(current),
                McpSettingsRequest::Set {
                    revision, servers, ..
                } => {
                    let next = current.replace(revision, servers, &agent.mcp_server_names())?;
                    let path = self
                        .settings_path
                        .as_deref()
                        .ok_or(McpSettingsError::Unavailable)?;
                    settings::save_mcp(path, &agent_id, &next)
                        .map_err(|_| McpSettingsError::ReadWrite)?;
                    Ok(next)
                }
            }
        })();
        let mut event = HostEvent::new(
            if result.is_ok() {
                "mcp_settings"
            } else {
                "mcp_settings_error"
            },
            request_id,
            String::new(),
        );
        event.data = match result {
            Ok(configuration) => {
                serde_json::json!(McpSettingsProjection {
                    agent_id,
                    revision: configuration.revision,
                    servers: configuration.servers
                })
            }
            Err(reason) => serde_json::json!(McpSettingsErrorProjection { agent_id, reason }),
        };
        let _ = self.tx.send(event);
    }
}
