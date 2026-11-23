//! Agent-advertised composer capabilities, converted once at the ACP boundary.
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
pub struct AgentCapabilities {
    pub images: bool,
    pub embedded_context: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub science_session: bool,
}

impl AgentCapabilities {
    pub fn from_initialize(value: &Value) -> Result<Self, String> {
        #[derive(Default, Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Prompt {
            #[serde(default)]
            image: bool,
            #[serde(default)]
            embedded_context: bool,
        }
        #[derive(Default, Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Capabilities {
            #[serde(default)]
            prompt_capabilities: Prompt,
        }
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Initialize {
            #[serde(default)]
            agent_capabilities: Capabilities,
        }
        let initialize: Initialize =
            serde_json::from_value(value.clone()).map_err(|e| e.to_string())?;
        Ok(Self {
            science_session: false,
            images: initialize.agent_capabilities.prompt_capabilities.image,
            embedded_context: initialize
                .agent_capabilities
                .prompt_capabilities
                .embedded_context,
        })
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct AgentCommand {
    pub name: String,
    pub description: String,
    pub input_hint: Option<String>,
}

impl AgentCommand {
    pub fn from_update(value: &Value) -> Result<Vec<Self>, String> {
        #[derive(Deserialize)]
        struct Input {
            hint: String,
        }
        #[derive(Deserialize)]
        struct Command {
            name: String,
            description: String,
            #[serde(default)]
            input: Option<Input>,
        }
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Update {
            available_commands: Vec<Command>,
        }
        let update: Update = serde_json::from_value(value.clone()).map_err(|e| e.to_string())?;
        let mut names = std::collections::HashSet::new();
        update
            .available_commands
            .into_iter()
            .map(|command| {
                if command.name.is_empty()
                    || command.name.len() > 128
                    || command
                        .name
                        .chars()
                        .any(|c| c.is_whitespace() || c.is_control() || c == '/')
                    || !names.insert(command.name.clone())
                {
                    return Err("Invalid or duplicate Agent command".to_string());
                }
                Ok(Self {
                    name: command.name,
                    description: command.description,
                    input_hint: command.input.map(|input| input.hint),
                })
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn advertised_commands_are_replaced_as_one_catalog() {
        for (commands, valid) in [
            (json!([]), true),
            (
                json!([{"name":"compact","description":"Compact conversation","input":{"hint":"instructions"}}]),
                true,
            ),
            (
                json!([{"name":"compact","description":""},{"name":"compact","description":""}]),
                false,
            ),
            (json!([{"name":"/compact","description":""}]), false),
            (json!([{"name":"two words","description":""}]), false),
        ] {
            assert_eq!(
                AgentCommand::from_update(&json!({"availableCommands":commands})).is_ok(),
                valid
            );
        }
    }
}
