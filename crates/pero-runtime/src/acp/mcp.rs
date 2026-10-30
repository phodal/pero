//! Conversion at the ACP boundary; managed configuration never replaces operator servers.
use super::AgentConfig;
use agent_client_protocol::schema::v1::{McpServer, McpServerHttp, McpServerStdio};
use pero_contracts::mcp::{McpConfiguration, McpTransport};

impl AgentConfig {
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
        agent.mcp_servers.extend(
            configuration
                .servers
                .iter()
                .filter(|server| server.enabled)
                .map(|server| match &server.transport {
                    McpTransport::Stdio { command, args } => McpServer::Stdio(
                        McpServerStdio::new(server.name.clone(), command).args(args.clone()),
                    ),
                    McpTransport::Http { url } => {
                        McpServer::Http(McpServerHttp::new(server.name.clone(), url.clone()))
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
        let agent: AgentConfig = serde_json::from_value(serde_json::json!({
            "id":"fixture","name":"Fixture","command":"/fixture",
            "mcp_servers":[{"name":"operator","type":"http","url":"https://example.test","headers":[{"name":"Authorization","value":"synthetic-secret"}]}]
        })).unwrap();
        let configuration: McpConfiguration = serde_json::from_value(serde_json::json!({"revision":1,"servers":[
            {"name":"granted","enabled":true,"transport":{"type":"stdio","command":"/fixture/mcp","args":["--docs"]}},
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
}
