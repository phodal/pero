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
    let agent_root = std::env::var_os("PERO_AGENT_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|| root.to_path_buf());
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let local_cli = |relative: &str, command: &str| {
        home.as_ref().map(|home| home.join(relative)).filter(|path| path.is_file())
            .map(|path| path.to_string_lossy().into_owned()).unwrap_or_else(|| command.to_owned())
    };
    // The Homebrew `grok` is a different program. Only use xAI's own installation
    // location (or its unambiguous grok-build command), never a bare `grok` lookup.
    let grok = home.as_ref().map(|home| home.join(".grok/bin/grok"))
        .filter(|path| path.is_file()).map(|path| path.to_string_lossy().into_owned())
        .unwrap_or_else(|| "grok-build".into());
    let mut agents = vec![
        AgentConfig {
            id: "codex".into(),
            name: "Codex".into(),
            command: agent_root
                .join("node_modules/.bin/codex-acp")
                .to_string_lossy()
                .into(),
            args: vec![],
            env: BTreeMap::new(),
            model: None,
            mcp_servers: vec![],
        },
        AgentConfig {
            id: "claude".into(),
            name: "Claude".into(),
            command: agent_root
                .join("node_modules/.bin/claude-agent-acp")
                .to_string_lossy()
                .into(),
            args: vec![],
            env: BTreeMap::new(),
            model: None,
            mcp_servers: vec![],
        },
        AgentConfig {
            id: "copilot".into(), name: "GitHub Copilot".into(), command: "copilot".into(),
            args: vec!["--acp".into(), "--stdio".into()], env: BTreeMap::new(), model: None,
            mcp_servers: vec![],
        },
        AgentConfig {
            id: "grok".into(), name: "Grok".into(), command: grok,
            args: vec!["--no-auto-update".into(), "agent".into(), "stdio".into()],
            env: BTreeMap::new(), model: None,
            mcp_servers: vec![],
        },
        AgentConfig {
            id: "qoder".into(), name: "Qoder".into(),
            command: local_cli(".local/bin/qodercli", "qodercli"),
            args: vec!["--acp".into()], env: BTreeMap::new(), model: None,
            mcp_servers: vec![],
        },
        AgentConfig {
            id: "opencode".into(), name: "OpenCode".into(),
            command: local_cli(".opencode/bin/opencode", "opencode"),
            args: vec!["acp".into()], env: BTreeMap::new(), model: None,
            mcp_servers: vec![],
        },
    ];
    // Packaged adapters use Electron's Node runtime directly on every OS.
    // In particular, Windows CreateProcess does not execute npm .cmd shims.
    if let Some(node) = std::env::var_os("PERO_ADAPTER_NODE") {
        for (id, script, key, cli) in [
            ("codex", "codex-acp.mjs", "CODEX_PATH", "codex"),
            ("claude", "claude-agent-acp.mjs", "CLAUDE_CODE_EXECUTABLE", "claude"),
        ] {
            let agent = agents.iter_mut().find(|agent| agent.id == id).unwrap();
            agent.command = node.to_string_lossy().into_owned();
            agent.args = vec![agent_root.join("adapters").join(script).to_string_lossy().into_owned()];
            agent.env.insert("ELECTRON_RUN_AS_NODE".into(), "1".into());
            agent.env.insert(key.into(), std::env::var(key).unwrap_or_else(|_| cli.into()));
        }
    }
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
        Ok(())
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
