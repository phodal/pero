//! MCP protocol requests cross Host composition; server credentials stay in the shell.
use serde::{Deserialize, Serialize};
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum McpMethod {
    Mcp,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum McpAction {
    Open,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct McpSourceRequest {
    pub method: McpMethod,
    pub action: McpAction,
    pub request_id: String,
    #[serde(default)]
    pub thread_id: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct McpAppBinding {
    pub id: String,
    pub server: String,
    pub resource_uri: String,
    pub tool: String,
    pub tool_call: String,
    pub thread_id: String,
}
