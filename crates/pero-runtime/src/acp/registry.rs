use super::memory::{MemoryConfig, MemoryState, SERVER_NAME};
use agent_client_protocol::schema::v1::{McpCapabilities, McpServer};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashSet},
    path::{Path, PathBuf},
};

#[derive(Clone, Serialize, Deserialize)]
pub struct AgentConfig {
    pub id: String,
    pub name: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    #[serde(default)]
    pub model: Option<String>,
    /// Trusted operator configuration only; never inferred from prompts or discovered.
    #[serde(default, deserialize_with = "deserialize_mcp_servers")]
    pub mcp_servers: Vec<McpServer>,
    /// Optional Engram memory. Absent or `enabled: false` changes nothing.
    #[serde(default)]
    pub memory: Option<MemoryConfig>,
}
impl AgentConfig {
    pub fn available(&self) -> bool {
        let p = Path::new(&self.command);
        if p.is_absolute() {
            return p.is_file();
        }
        std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default())
            .any(|dir| dir.join(p).is_file())
    }
    pub fn public(&self) -> serde_json::Value {
        serde_json::json!({"id":self.id,"name":self.name,"available":self.available(),"command":self.command,"model":self.model})
    }
}
pub fn registry(root: &Path) -> Result<Vec<AgentConfig>, String> {
    let grok_env=BTreeMap::from([("OPENCODE_CONFIG_CONTENT".into(),serde_json::json!({"model":"xai/grok-code-fast-1","provider":{"xai":{"npm":"@ai-sdk/xai","name":"xAI","models":{"grok-code-fast-1":{"name":"Grok Code Fast 1"}}}}}).to_string())]);
    let mut agents = vec![
        AgentConfig {
            id: "codex".into(),
            name: "Codex".into(),
            command: "codex-acp".into(),
            args: vec![],
            env: BTreeMap::new(),
            model: None,
            mcp_servers: vec![],
            memory: None,
        },
        AgentConfig {
            id: "claude".into(),
            name: "Claude".into(),
            command: root
                .join("node_modules/.bin/claude-agent-acp")
                .to_string_lossy()
                .into(),
            args: vec![],
            env: BTreeMap::new(),
            model: None,
            mcp_servers: vec![],
            memory: None,
        },
        AgentConfig {
            id: "grok".into(),
            name: "Grok · OpenCode".into(),
            command: "opencode".into(),
            args: vec!["acp".into()],
            env: grok_env,
            model: None,
            mcp_servers: vec![],
            memory: None,
        },
    ];
    let file = std::env::var_os("PERO_AGENTS_FILE")
        .map(PathBuf::from)
        .unwrap_or_else(|| root.join("agents.local.json"));
    if file.exists() {
        let custom: Vec<AgentConfig> =
            serde_json::from_slice(&std::fs::read(file).map_err(|e| e.to_string())?)
                .map_err(|_| "Invalid agent configuration".to_owned())?;
        for agent in custom {
            agent.validate_mcp()?;
            agents.retain(|a| a.id != agent.id);
            agents.push(agent);
        }
    }
    Ok(agents)
}

impl AgentConfig {
    /// Validate before spawning the ACP agent. Errors intentionally omit operator values.
    pub(crate) fn validate_mcp(&self) -> Result<(), String> {
        let mut names = HashSet::new();
        for server in &self.mcp_servers {
            let name = match server {
                McpServer::Stdio(s) => {
                    if !s.command.is_absolute()
                        || s.command.to_string_lossy().contains('\0')
                        || s.args.iter().any(|a| a.contains('\0'))
                    {
                        return Err("Invalid MCP stdio command or arguments".into());
                    }
                    let mut keys = HashSet::new();
                    if s.env.iter().any(|e| {
                        e.name.is_empty()
                            || e.name.contains(['=', '\0'])
                            || e.value.contains('\0')
                            || !keys.insert(&e.name)
                    }) {
                        return Err("Invalid MCP environment".into());
                    }
                    &s.name
                }
                McpServer::Http(s) => {
                    validate_remote(&s.url, &s.headers)?;
                    &s.name
                }
                McpServer::Sse(s) => {
                    validate_remote(&s.url, &s.headers)?;
                    &s.name
                }
                _ => return Err("Unsupported MCP transport".into()),
            };
            if name.trim().is_empty() || name.chars().any(char::is_control) || !names.insert(name) {
                return Err("Invalid or duplicate MCP server name".into());
            }
        }
        if let Some(memory) = self.memory.as_ref().filter(|m| m.enabled) {
            memory.validate()?;
        }
        Ok(())
    }

    /// The `mcpServers` list for `session/new`: the operator's servers plus
    /// Engram when memory is enabled. An enabled configuration whose binary is
    /// missing is an error here, before any agent process is started.
    pub(crate) fn session_mcp_servers(&self) -> Result<Vec<McpServer>, String> {
        let mut servers = self.mcp_servers.clone();
        let Some(memory) = self.memory.as_ref().filter(|m| m.enabled) else {
            return Ok(servers);
        };
        memory.validate()?;
        if memory.state() == MemoryState::MissingBinary {
            return Err("Memory is enabled but the configured Engram binary is not available".into());
        }
        if servers.iter().any(|s| matches!(s, McpServer::Stdio(s) if s.name == SERVER_NAME)) {
            return Err("Memory server name conflicts with a configured MCP server".into());
        }
        servers.push(memory.mcp_server()?);
        Ok(servers)
    }

    pub(crate) fn validate_mcp_capabilities(
        &self,
        capabilities: &McpCapabilities,
    ) -> Result<(), String> {
        for server in &self.mcp_servers {
            match server {
                McpServer::Http(_) if !capabilities.http => {
                    return Err("Agent does not support MCP HTTP transport".into());
                }
                McpServer::Sse(_) if !capabilities.sse => {
                    return Err("Agent does not support MCP SSE transport".into());
                }
                _ => {}
            }
        }
        Ok(())
    }
}

fn validate_remote(
    url: &str,
    headers: &[agent_client_protocol::schema::v1::HttpHeader],
) -> Result<(), String> {
    let parsed = url::Url::parse(url).map_err(|_| "Invalid MCP HTTP/SSE URL".to_owned())?;
    if !matches!(parsed.scheme(), "http" | "https")
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.fragment().is_some()
        || url.contains('\\')
        || url.chars().any(|c| c.is_whitespace() || c.is_control())
    {
        return Err("Invalid MCP HTTP/SSE URL".into());
    }
    let mut names = HashSet::new();
    for header in headers {
        if header.name.is_empty()
            || !header
                .name
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"!#$%&'*+-.^_`|~".contains(&b))
            || header.value.chars().any(|c| c.is_control() && c != '\t')
            || !names.insert(header.name.to_ascii_lowercase())
        {
            return Err("Invalid MCP header".into());
        }
    }
    Ok(())
}

// The protocol's untagged stdio fallback otherwise accepts unknown transport tags.
fn deserialize_mcp_servers<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Vec<McpServer>, D::Error> {
    let values = Vec::<serde_json::Value>::deserialize(deserializer)?;
    values
        .into_iter()
        .map(|value| {
            let parsed = match value.get("type").and_then(serde_json::Value::as_str) {
                Some("http") => serde_json::from_value(value).map(McpServer::Http),
                Some("sse") => serde_json::from_value(value).map(McpServer::Sse),
                None if value.get("type").is_none() => {
                    serde_json::from_value(value).map(McpServer::Stdio)
                }
                _ => return Err(serde::de::Error::custom("Unsupported MCP transport")),
            };
            parsed.map_err(|_| serde::de::Error::custom("Invalid MCP server configuration"))
        })
        .collect()
}

impl std::fmt::Debug for AgentConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AgentConfig")
            .field("id", &self.id)
            .field("name", &self.name)
            .field("mcp_server_count", &self.mcp_servers.len())
            .finish_non_exhaustive()
    }
}
