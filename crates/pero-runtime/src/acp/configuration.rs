//! ACP conversion boundary for non-model session configuration.
use agent_client_protocol::{UntypedMessage, schema::v1::*};
use pero_contracts::session_settings::{
    SessionSetting, SessionSettings, SettingChoice, SettingSelection,
};
use serde::Deserialize;
use serde_json::{Value, json};

#[derive(Clone, Default)]
pub(super) struct Configuration {
    pub settings: SessionSettings,
    legacy_mode: bool,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum Choice {
    Value {
        value: String,
        name: String,
        #[serde(default)]
        description: Option<String>,
    },
    Group {
        #[serde(rename = "group")]
        _group: String,
        name: String,
        options: Vec<Choice>,
    },
}

fn choices(values: Vec<Choice>, prefix: &str, output: &mut Vec<SettingChoice>) {
    for value in values {
        match value {
            Choice::Value {
                value,
                name,
                description,
            } => output.push(SettingChoice {
                value,
                description: description.unwrap_or_default(),
                label: if prefix.is_empty() {
                    name
                } else {
                    format!("{prefix} / {name}")
                },
            }),
            Choice::Group { name, options, .. } => choices(options, &name, output),
        }
    }
}

impl Configuration {
    pub fn mode_changed(&mut self, value: &str) -> agent_client_protocol::Result<()> {
        if let Some(id) = self.settings.options.iter().find(|option| option.category == "mode").map(|option| option.id.clone()) {
            self.settings.acknowledge(&id,value).map_err(|error|agent_client_protocol::Error::new(-32602,error))?;
        }
        Ok(())
    }
    pub fn refresh(&mut self, session: &Value) -> agent_client_protocol::Result<()> {
        let mut options = vec![];
        for option in session["configOptions"].as_array().into_iter().flatten() {
            let category = option["category"].as_str().unwrap_or("");
            if !matches!(category, "mode" | "thought_level") || option["type"] != "select" {
                continue;
            }
            let selected: Vec<Choice> = serde_json::from_value(option["options"].clone())
                .map_err(agent_client_protocol::Error::into_internal_error)?;
            let mut available = vec![];
            choices(selected, "", &mut available);
            options.push(SessionSetting {
                id: option["id"].as_str().unwrap_or_default().into(),
                name: option["name"].as_str().unwrap_or_default().into(),
                category: category.into(),
                current: option["currentValue"].as_str().unwrap_or_default().into(),
                choices: available,
            });
        }
        let modern_mode = options
            .iter()
            .any(|option| option.category == "mode" || option.id == "mode");
        let mut legacy_mode = false;
        if !modern_mode {
            if let Some(modes) = session["modes"]["availableModes"].as_array() {
                legacy_mode = !modes.is_empty();
                if legacy_mode {
                    options.push(SessionSetting {
                        id: "mode".into(),
                        name: "Mode".into(),
                        category: "mode".into(),
                        current: session["modes"]["currentModeId"]
                            .as_str()
                            .unwrap_or_default()
                            .into(),
                        choices: modes
                            .iter()
                            .map(|mode| SettingChoice {
                                value: mode["id"].as_str().unwrap_or_default().into(),
                                label: mode["name"].as_str().unwrap_or_default().into(),
                                description: mode["description"]
                                    .as_str()
                                    .unwrap_or_default()
                                    .into(),
                            })
                            .collect(),
                    });
                }
            } else if self.legacy_mode {
                legacy_mode = true;
                options.extend(
                    self.settings
                        .options
                        .iter()
                        .filter(|option| option.id == "mode")
                        .cloned(),
                );
            }
        }
        self.settings = SessionSettings::new(options)
            .map_err(|error| agent_client_protocol::Error::new(-32602, error))?;
        self.legacy_mode = legacy_mode;
        Ok(())
    }

    pub fn request(
        &self,
        session: &SessionId,
        id: &str,
        value: &str,
    ) -> agent_client_protocol::Result<(SettingSelection, UntypedMessage)> {
        let selection = self
            .settings
            .select(id, value)
            .map_err(|error| agent_client_protocol::Error::new(-32602, error))?;
        let message = if self.legacy_mode && id == "mode" {
            UntypedMessage::new(
                "session/set_mode",
                json!({"sessionId":session,"modeId":value}),
            )?
        } else {
            UntypedMessage::new(
                "session/set_config_option",
                SetSessionConfigOptionRequest::new(
                    session.clone(),
                    SessionConfigId::new(id.to_owned()),
                    SessionConfigValueId::new(value.to_owned()),
                ),
            )?
        };
        Ok((selection, message))
    }

    pub fn acknowledged(
        &mut self,
        session: &mut Value,
        response: Value,
        selection: &SettingSelection,
    ) -> agent_client_protocol::Result<()> {
        if self.legacy_mode && selection.id == "mode" {
            if !response.is_object() {
                return Err(agent_client_protocol::Error::invalid_params());
            }
            session["modes"]["currentModeId"] = json!(selection.value);
        } else {
            let parsed: SetSessionConfigOptionResponse = serde_json::from_value(response)
                .map_err(agent_client_protocol::Error::into_internal_error)?;
            session["configOptions"] = serde_json::to_value(parsed.config_options)
                .map_err(agent_client_protocol::Error::into_internal_error)?;
        }
        self.refresh(session)
    }
}
