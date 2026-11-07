//! Conversion at the ACP boundary; managed configuration never replaces operator servers.
use super::AgentConfig;
use agent_client_protocol::schema::v1::{McpServer, McpServerHttp, McpServerStdio};
use pero_contracts::mcp::{McpConfiguration, McpTransport};

pub const TOOL_POLICY_CAPABILITY: &str = "pero.mcpToolPolicy";

impl AgentConfig {
    /// Policy-bearing snapshots cannot silently downgrade on external Agents.
    pub(super) fn validate_mcp_tool_policy_capability(
        &self,
        negotiated: bool,
    ) -> Result<(), String> {
        if !negotiated
            && self.mcp_servers.iter().any(|server| {
                let meta = match server {
                    McpServer::Stdio(server) => &server.meta,
                    McpServer::Http(server) => &server.meta,
                    McpServer::Sse(server) => &server.meta,
                    _ => return false,
                };
                meta.as_ref()
                    .is_some_and(|meta| meta.contains_key(TOOL_POLICY_CAPABILITY))
            })
        {
            return Err("Agent does not support MCP tool policy enforcement".into());
        }
        Ok(())
    }

    pub fn mcp_server_names(&self) -> Vec<String> {
        self.mcp_servers
            .iter()
            .filter_map(|server| match server {
                McpServer::Stdio(server) => Some(server.name.clone()),
                McpServer::Http(server) => Some(server.name.clone()),
                McpServer::Sse(server) => Some(server.name.clone()),
                _ => None,
            })
            .collect()
    }

    /// Consumes an already admitted preferences snapshot, leaving all live sessions unchanged.
    pub fn with_managed_mcp(&self, configuration: &McpConfiguration) -> Self {
        let mut agent = self.clone();
        agent.managed_mcp = Some(configuration.clone());
        agent.mcp_servers.extend(
            configuration
                .servers
                .iter()
                .filter(|server| server.enabled)
                .map(|server| {
                    let meta = server.tool_policy.as_ref().map(|policy| {
                        let mut meta = serde_json::Map::new();
                        meta.insert(TOOL_POLICY_CAPABILITY.into(), serde_json::json!(policy));
                        meta
                    });
                    match &server.transport {
                        McpTransport::Stdio { command, args } => {
                            let mut endpoint = McpServerStdio::new(server.name.clone(), command)
                                .args(args.clone());
                            endpoint.meta = meta;
                            McpServer::Stdio(endpoint)
                        }
                        McpTransport::Http { url } => {
                            let mut endpoint = McpServerHttp::new(server.name.clone(), url.clone());
                            endpoint.meta = meta;
                            McpServer::Http(endpoint)
                        }
                    }
                }),
        );
        agent
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn managed_grants_are_added_to_new_snapshots_without_overwriting_operator_configuration() {
        let command = std::env::current_exe().unwrap();
        let agent: AgentConfig = serde_json::from_value(serde_json::json!({
            "id":"fixture","name":"Fixture","command":command,
            "mcp_servers":[{"name":"operator","type":"http","url":"https://example.test","headers":[{"name":"Authorization","value":"synthetic-secret"}]}]
        })).unwrap();
        let configuration: McpConfiguration = serde_json::from_value(serde_json::json!({"revision":1,"servers":[
            {"name":"granted","enabled":true,"transport":{"type":"stdio","command":command,"args":["--docs"]}},
            {"name":"disabled","transport":{"type":"http","url":"https://example.test/mcp"}}
        ]})).unwrap();
        configuration.validate(&agent.mcp_server_names()).unwrap();
        let snapshot = agent.with_managed_mcp(&configuration);
        assert_eq!(snapshot.mcp_servers.len(), 2);
        assert_eq!(
            serde_json::to_value(&snapshot.mcp_servers[0]).unwrap(),
            serde_json::to_value(&agent.mcp_servers[0]).unwrap()
        );
        assert_eq!(agent.mcp_servers.len(), 1);
        let next = configuration
            .replace(1, vec![], &agent.mcp_server_names())
            .unwrap();
        assert_eq!(agent.with_managed_mcp(&next).mcp_servers.len(), 1);
        assert_eq!(snapshot.mcp_servers.len(), 2);
    }
    #[test]
    fn managed_policy_is_frozen_transmitted_and_requires_negotiation() {
        let command = std::env::current_exe().unwrap();
        let agent: AgentConfig = serde_json::from_value(serde_json::json!({
            "id":"fixture", "name":"Fixture", "command":command
        }))
        .unwrap();
        for transport in [
            serde_json::json!({"type":"stdio","command":command}),
            serde_json::json!({"type":"http","url":"https://example.test/mcp"}),
        ] {
            let configuration: McpConfiguration = serde_json::from_value(serde_json::json!({
                "revision":1,"servers":[{"name":"docs","enabled":true,"transport":transport,
                    "tool_policy":{"default":"deny","tools":{"read":"allow","write":"ask"}}}]
            }))
            .unwrap();
            configuration.validate(&[]).unwrap();
            let snapshot = agent.with_managed_mcp(&configuration);
            let wire = serde_json::to_value(&snapshot.mcp_servers[0]).unwrap();
            assert_eq!(
                wire["_meta"][TOOL_POLICY_CAPABILITY],
                serde_json::json!({
                    "default":"deny","tools":{"read":"allow","write":"ask"}
                })
            );
            assert!(snapshot.validate_mcp_tool_policy_capability(false).is_err());
            assert!(snapshot.validate_mcp_tool_policy_capability(true).is_ok());
            let mut updated = configuration.clone();
            updated.servers[0].tool_policy.as_mut().unwrap().default =
                pero_contracts::mcp::McpToolDecision::Ask;
            let next = agent.with_managed_mcp(&updated);
            assert_ne!(serde_json::to_value(&next.mcp_servers[0]).unwrap(), wire);
            assert_eq!(
                serde_json::to_value(&snapshot.mcp_servers[0]).unwrap(),
                wire
            );
            updated.servers[0].enabled = false;
            assert!(
                agent
                    .with_managed_mcp(&updated)
                    .validate_mcp_tool_policy_capability(false)
                    .is_ok()
            );
        }
        assert!(agent.validate_mcp_tool_policy_capability(false).is_ok());
    }
}
