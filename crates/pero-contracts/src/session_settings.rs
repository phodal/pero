//! Advertised session settings. Only an Agent acknowledgement changes a value.
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct SettingChoice {
    pub value: String,
    pub label: String,
    #[serde(default)]
    pub description: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct SessionSetting {
    pub id: String,
    pub name: String,
    pub category: String,
    pub current: String,
    pub choices: Vec<SettingChoice>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
pub struct SessionSettings {
    pub options: Vec<SessionSetting>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct SettingSelection {
    pub id: String,
    pub value: String,
}

impl SessionSettings {
    pub fn new(options: Vec<SessionSetting>) -> Result<Self, &'static str> {
        let mut ids = std::collections::HashSet::new();
        for option in &options {
            if option.id.is_empty() || option.id.len() > 128 || !ids.insert(&option.id) {
                return Err("Invalid or duplicate session setting");
            }
            let mut values = std::collections::HashSet::new();
            if option.choices.is_empty()
                || option
                    .choices
                    .iter()
                    .any(|choice| choice.value.is_empty() || !values.insert(&choice.value))
            {
                return Err("Invalid or duplicate session setting choice");
            }
            if !option
                .choices
                .iter()
                .any(|choice| choice.value == option.current)
            {
                return Err("Agent selected an unadvertised setting value");
            }
        }
        Ok(Self { options })
    }

    pub fn select(&self, id: &str, value: &str) -> Result<SettingSelection, &'static str> {
        if !self.options.iter().any(|option| {
            option.id == id && option.choices.iter().any(|choice| choice.value == value)
        }) {
            return Err("Setting value is not advertised by this Agent");
        }
        Ok(SettingSelection {
            id: id.to_owned(),
            value: value.to_owned(),
        })
    }

    pub fn acknowledge(&mut self, id: &str, value: &str) -> Result<(), &'static str> {
        let selection = self.select(id,value)?;
        if let Some(option) = self.options.iter_mut().find(|option| option.id == selection.id) {
            option.current = selection.value;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn settings_accept_only_advertised_selections() {
        let settings = SessionSettings::new(vec![SessionSetting {
            id: "effort".into(),
            name: "Thinking effort".into(),
            category: "thought_level".into(),
            current: "high".into(),
            choices: vec![
                SettingChoice {
                    value: "high".into(),
                    label: "High".into(),
                    description: String::new(),
                },
                SettingChoice {
                    value: "low".into(),
                    label: "Low".into(),
                    description: String::new(),
                },
            ],
        }])
        .unwrap();
        for (id, value, valid) in [
            ("effort", "low", true),
            ("effort", "high", true),
            ("effort", "invented", false),
            ("missing", "low", false),
        ] {
            assert_eq!(settings.select(id, value).is_ok(), valid);
            assert_eq!(settings.options[0].current, "high");
        }
    }
}
