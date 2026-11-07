//! Operator switch for the external Engram process. Engram owns its database.
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct EngramSettings {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub binary: String,
}

impl EngramSettings {
    /// An enabled setting names an absolute executable. Existence is checked at session admission.
    pub fn valid(&self) -> bool {
        if !self.enabled {
            return self.binary.len() <= 4096 && !self.binary.contains('\0');
        }
        let path = Path::new(&self.binary);
        self.binary.len() <= 4096
            && !self.binary.contains('\0')
            && path.is_absolute()
            && path.components().all(|component| {
                !matches!(component, std::path::Component::ParentDir)
            })
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "method", deny_unknown_fields)]
pub enum EngramSettingsRequest {
    #[serde(rename = "settings.engram.get")]
    Get,
    #[serde(rename = "settings.engram")]
    Set { enabled: bool, binary: String },
}
