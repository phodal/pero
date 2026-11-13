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
    Adopt,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum McpSourceMode {
    #[default]
    Standalone,
    Session,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct McpSourceRequest {
    pub method: McpMethod,
    pub action: McpAction,
    #[serde(default)]
    pub mode: McpSourceMode,
    pub request_id: String,
    #[serde(default)]
    pub thread_id: Option<String>,
    #[serde(default,skip_serializing_if="Option::is_none")]
    pub server: Option<String>,
    #[serde(default,skip_serializing_if="Option::is_none")]
    pub generation: Option<u64>,
    #[serde(default,skip_serializing_if="Option::is_none")]
    pub tool_call: Option<String>,
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
/// A trusted Agent projection names a previously executed tool result, not an execution request.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct McpAppDescriptor {
    pub server: String,
    pub generation: u64,
    pub resource_uri: String,
    pub tool_call: String,
}
impl McpAppDescriptor {
    pub fn from_update(update: &serde_json::Value) -> Option<Self> {
        let value: Self = serde_json::from_value(update["_meta"]["pero.mcpApp"].clone()).ok()?;
        if value.tool_call != update["toolCallId"].as_str()?
            || value.server.is_empty()
            || value.generation == 0
            || !value.resource_uri.starts_with("ui://")
        {
            return None;
        }
        Some(value)
    }
}

impl McpSourceRequest {
    pub fn validate(&self)->Result<(), &'static str> {
        let bounded=|value:&str,max|!value.is_empty()&&value.len()<=max&&!value.chars().any(char::is_control);
        let adopt=matches!(self.action,McpAction::Adopt);
        if !bounded(&self.request_id,128) || self.thread_id.as_ref().is_some_and(|v|!bounded(v,128))
            || adopt!=self.server.is_some() || adopt!=self.generation.is_some() || adopt!=self.tool_call.is_some()
            || self.server.as_ref().is_some_and(|v|!bounded(v,128)) || self.tool_call.as_ref().is_some_and(|v|!bounded(v,256))
            || self.generation.is_some_and(|v|v==0||v>9_007_199_254_740_991)
            || adopt&&(!matches!(self.mode,McpSourceMode::Session)||self.thread_id.is_none()) {return Err("Invalid MCP source request");}
        Ok(())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn source_intents_distinguish_manual_open_from_original_result_adoption(){
        for (value,valid) in [
            (json!({"method":"mcp","action":"open","request_id":"manual"}),true),
            (json!({"method":"mcp","action":"adopt","mode":"session","thread_id":"thread","request_id":"inline","server":"docs","generation":1,"tool_call":"call"}),true),
            (json!({"method":"mcp","action":"adopt","request_id":"inline"}),false),
            (json!({"method":"mcp","action":"open","request_id":"manual","tool_call":"call"}),false),
            (json!({"method":"mcp","action":"adopt","mode":"standalone","thread_id":"thread","request_id":"inline","server":"docs","generation":1,"tool_call":"call"}),false),
        ] {let request:McpSourceRequest=serde_json::from_value(value).unwrap();assert_eq!(request.validate().is_ok(),valid);}
    }
    #[test]
    fn view_descriptor_belongs_to_its_actual_tool_call(){
        let mut update=json!({"toolCallId":"call","_meta":{"pero.mcpApp":{"server":"docs","generation":1,"resource_uri":"ui://docs/view","tool_call":"call"}}});
        assert!(McpAppDescriptor::from_update(&update).is_some());
        update["toolCallId"]=json!("other");assert!(McpAppDescriptor::from_update(&update).is_none());
    }
}
