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
    /// Empty binary is markdown-only memory. A filled path must be absolute.
    pub fn valid(&self) -> bool {
        if self.binary.len() > 4096 || self.binary.contains('\0') {
            return false;
        }
        if !self.enabled || self.binary.is_empty() {
            return true;
        }
        let path = Path::new(&self.binary);
        path.is_absolute()
            && path.components().all(|component| {
                !matches!(component, std::path::Component::ParentDir)
            })
    }
}

/// What the Memory settings page shows. The two texts are files, not settings keys.
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct MemoryPage {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub binary: String,
    #[serde(default)]
    pub global: String,
    #[serde(default)]
    pub project: String,
    #[serde(default)]
    pub workspace: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "method", deny_unknown_fields)]
pub enum EngramSettingsRequest {
    #[serde(rename = "settings.engram.get")]
    Get,
    #[serde(rename = "settings.engram")]
    Set { enabled: bool, binary: String },
    #[serde(rename = "settings.engram.document")]
    Document { scope: String, text: String },
}
