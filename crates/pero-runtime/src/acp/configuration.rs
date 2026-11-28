//! ACP conversion boundary for non-model session configuration.
use agent_client_protocol::{schema::v1::*, UntypedMessage};
use pero_contracts::session_settings::{
    SessionSetting, SessionSettings, SettingChoice, SettingSelection,
};
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Clone, Copy)]
pub enum SupervisedPermission {
    ReadOnlyDsh,
    AskDsh,
}

impl SupervisedPermission {
    /// `read-only` without an approval binding; `full-access` when one is pinned.
    pub fn mode(self) -> &'static str {
        match self {
            Self::ReadOnlyDsh => "read-only",
            Self::AskDsh => "full-access",
        }
    }

    /// `pero-agent-acp` must acknowledge `mode`. Any other peer is admitted only
    /// when `gate_only` is the explicit agents-file opt-in, and then no selector
    /// is set. The agent name is never that opt-in.
    pub fn admit(self, agent_name: Option<&str>, gate_only: bool) -> Result<Option<&'static str>, &'static str> {
        if agent_name == Some("pero-agent-acp") {
            Ok(Some(self.mode()))
        } else if gate_only {
            Ok(None)
        } else {
            Err("Supervised session refused: peer is not a DSH that supports the permission selector and did not opt in to gate-only supervision")
        }
    }
}

const PERMISSION_CHANGED: &str = "Agent changed the inherited permission after acknowledgement; no prompt was started";

#[derive(Clone, Default)]
pub(super) struct Configuration {
    pub settings: SessionSettings,
    legacy_mode: bool,
    /// Settings acknowledged before the first prompt. Later config replacements must keep them.
    pinned: Vec<(String, String)>,
    revoked: bool,
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
    pub fn retain(&mut self, id: &str, value: &str) -> Result<(), &'static str> {
        if !self.settings.options.iter().any(|option| option.id == id && option.current == value) {
            return Err("Agent did not acknowledge the inherited permission; no prompt was started");
        }
        self.pinned.push((id.to_owned(), value.to_owned()));
        Ok(())
    }

    pub fn retained(&self) -> Result<(), &'static str> {
        if self.revoked || !self.pins_hold(&self.settings) {
            Err(PERMISSION_CHANGED)
        } else {
            Ok(())
        }
    }

    fn pins_hold(&self, settings: &SessionSettings) -> bool {
        self.pinned.iter().all(|(id, value)| {
            settings.options.iter().any(|option| option.id == *id && option.current == *value)
        })
    }

    fn revoke(&mut self) -> agent_client_protocol::Error {
        self.revoked = true;
        agent_client_protocol::Error::new(-32603, PERMISSION_CHANGED)
    }

    pub fn mode_changed(&mut self, value: &str) -> agent_client_protocol::Result<()> {
        if let Some(id) = self
            .settings
            .options
            .iter()
            .find(|option| option.category == "mode")
            .map(|option| option.id.clone())
        {
            self.settings
                .acknowledge(&id, value)
                .map_err(|error| agent_client_protocol::Error::new(-32602, error))?;
        }
        if !self.pins_hold(&self.settings) {
            return Err(self.revoke());
        }
        Ok(())
    }
    pub fn refresh(&mut self, session: &Value) -> agent_client_protocol::Result<()> {
        let mut options = vec![];
        for option in session["configOptions"].as_array().into_iter().flatten() {
            let category = option["category"].as_str().unwrap_or("");
            // Categories are presentation hints, not a capability allowlist.
            // Permission/profile selectors and future Agent settings must retain
            // the exact advertised choices and acknowledgement semantics.
            if category == "model" || option["id"] == "model" || option["type"] != "select" {
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
        let settings = SessionSettings::new(options)
            .map_err(|error| agent_client_protocol::Error::new(-32602, error))?;
        // Model responses, config_option_update notifications, and later
        // set_config_option results all rebuild through refresh. A pinned
        // permission must still be the acknowledged value. current_mode_update
        // goes through mode_changed and the same pin.
        if !self.pins_hold(&settings) {
            return Err(self.revoke());
        }
        self.settings = settings;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn supervised_permission_admits_only_the_named_dsh_or_an_explicit_gate() {
        for permission in [SupervisedPermission::ReadOnlyDsh, SupervisedPermission::AskDsh] {
            assert!(permission.admit(None, false).is_err());
            assert!(permission.admit(Some("other-agent"), false).is_err());
            assert!(permission.admit(Some("codex"), false).is_err());
            assert!(permission.admit(Some("codex-acp"), false).is_err());
            assert_eq!(permission.admit(Some("pero-agent-acp"), false).unwrap(), Some(permission.mode()));
            assert_eq!(permission.admit(Some("pero-agent-acp"), true).unwrap(), Some(permission.mode()));
            assert_eq!(permission.admit(Some("codex-acp"), true).unwrap(), None);
            assert_eq!(permission.admit(None, true).unwrap(), None);
        }
        assert_eq!(SupervisedPermission::ReadOnlyDsh.mode(), "read-only");
        assert_eq!(SupervisedPermission::AskDsh.mode(), "full-access");
    }

    #[test]
    fn a_later_refresh_cannot_replace_a_retained_permission() {
        let mut configuration = Configuration::default();
        let options = json!([{"value":"read-only","name":"View"},{"value":"full-access","name":"Full"}]);
        let session = |current| json!({"configOptions":[{
            "id":"permission","name":"Permission","category":"mode","type":"select",
            "currentValue":current,"options":options
        }]});
        configuration.refresh(&session("read-only")).unwrap();
        configuration.retain("permission", "read-only").unwrap();
        assert!(configuration.refresh(&session("full-access")).is_err());
        assert!(configuration.retained().is_err());
        configuration.mode_changed("full-access").unwrap_err();
        assert!(configuration.retained().is_err());
    }

    #[test]
    fn selectors_use_advertised_semantics_including_custom_permissions() {
        for (category, id, included) in [
            ("mode", "mode", true),
            ("thought_level", "effort", true),
            ("_permission", "approval", true),
            ("", "custom-setting", true),
            ("model", "provider-model", false),
        ] {
            let mut configuration = Configuration::default();
            configuration.refresh(&json!({"configOptions":[{
                "category":category,"id":id,"name":"Agent setting","type":"select",
                "currentValue":"ask","options":[{"value":"ask","name":"Ask","description":"Request approval"}]
            }]})).unwrap();
            assert_eq!(configuration.settings.options.len(), usize::from(included));
            if included {
                let (_, request) = configuration
                    .request(&SessionId::new("thread"), id, "ask")
                    .unwrap();
                assert_eq!(request.method, "session/set_config_option");
                assert_eq!(request.params["configId"], id);
                assert_eq!(
                    configuration.settings.options[0].choices[0].description,
                    "Request approval"
                );
            }
        }
    }
}
