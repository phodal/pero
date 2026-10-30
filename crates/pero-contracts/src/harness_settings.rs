//! Public provider state excludes credentials; stored settings hold only ciphertext.
use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HarnessSettings {
    pub endpoint: String,
    pub model: String,
    pub encrypted_api_key: Option<String>,
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HarnessState {
    pub endpoint: String,
    pub model: String,
    pub credential_configured: bool,
    pub source: String,
    pub persistence_available: bool,
    pub status: String,
    pub error: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "action")]
pub enum HarnessControl {
    #[serde(rename = "harness_get")]
    Get,
    #[serde(rename = "harness_save")]
    Save {
        endpoint: String,
        model: String,
        api_key: String,
        clear_key: bool,
    },
}
