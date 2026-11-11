//! Installation inputs and actual observations remain distinct identities.
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, path::PathBuf};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct PythonObservation {
    pub version: String,
    pub build: String,
    pub platform: String,
    pub machine: String,
    pub executable_sha256: String,
    pub packages: BTreeMap<String, String>,
    pub packages_sha256: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct LockedPythonProfile {
    pub root: PathBuf,
    pub project_sha256: String,
    pub lock_sha256: String,
    pub python_request: String,
    pub python_archive_url: String,
    pub python_archive_sha256: String,
    pub uv_version: String,
    pub uv_sha256: String,
    pub observation: PythonObservation,
}
impl LockedPythonProfile {
    pub fn require(&self, observed: &PythonObservation) -> Result<(), super::EnvironmentError> {
        if &self.observation != observed {
            return Err(super::EnvironmentError::IdentityChanged);
        }
        Ok(())
    }
}
