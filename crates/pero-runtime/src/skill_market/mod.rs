//! Market inventory and version choices. Execution remains the Harness's concern.
mod acquisition;
mod acquisition_job;
pub use acquisition_job::{AcquisitionKind, AcquisitionResult, SkillAcquisition};
mod catalog;
pub use catalog::sanitize_catalog;
mod context;
pub use context::CONTEXT_SOURCE_PREFIX;
mod store;
pub use acquisition::AcquisitionControl;
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, path::PathBuf};
pub use store::{CatalogLocation, SkillMarketStore, read_installed_context};

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SkillSource {
    pub repository: String,
    pub commit: String,
    pub path: String,
    pub sha256: String,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub git_blob_sha: Option<String>,
    #[serde(default)]
    pub resource_fingerprint: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub archive: Option<String>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SkillLicense {
    pub spdx: Option<String>,
    pub status: String,
    #[serde(default)]
    pub evidence_url: Option<String>,
    #[serde(default)]
    pub declaration: Option<String>,
}
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct SkillCompatibility {
    #[serde(default)]
    pub declared: Vec<String>,
    #[serde(default)]
    pub status: String,
}
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct SkillVerification {
    #[serde(default)]
    pub content: String,
    #[serde(default)]
    pub runtime: String,
    #[serde(default)]
    pub notes: Vec<String>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SkillSection {
    pub heading: String,
    pub text: String,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SkillCatalogEntry {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub title_zh: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub description_zh: String,
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub category_zh: String,
    pub kind: String,
    pub source: SkillSource,
    pub license: SkillLicense,
    #[serde(default)]
    pub sources: Vec<SkillSource>,
    #[serde(default)]
    pub compatibility: SkillCompatibility,
    #[serde(default)]
    pub dependencies: Vec<SkillSection>,
    #[serde(default)]
    pub inputs: Vec<SkillSection>,
    #[serde(default)]
    pub outputs: Vec<SkillSection>,
    #[serde(default)]
    pub examples: Vec<SkillSection>,
    #[serde(default)]
    pub verification: SkillVerification,
    #[serde(default)]
    pub related_instruction_ids: Vec<String>,
}
impl SkillCatalogEntry {
    pub fn installable(&self) -> Result<(), String> {
        if !matches!(
            self.kind.as_str(),
            "research_skill" | "research_support" | "general_skill"
        ) {
            return Err(
                "This catalog record is a dependency or reference, not an independent skill".into(),
            );
        }
        if self
            .license
            .spdx
            .as_deref()
            .is_none_or(|s| s.is_empty() || s == "unknown" || s == "NOASSERTION")
            || !matches!(
                self.license.status.as_str(),
                "declared_in_skill" | "directory_license" | "reviewed_repository"
            )
            || self
                .license
                .evidence_url
                .as_deref()
                .is_none_or(str::is_empty)
        {
            return Err(
                "License evidence is missing; open the source and verify its terms first".into(),
            );
        }
        if self.kind == "general_skill" && self.compatibility.status != "static_instructions" {
            return Err("This general skill requires a compatibility review or host adaptation; review its requirements".into());
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillVersion {
    pub revision: String,
    pub sha256: String,
    pub invocation: String,
    pub directory: PathBuf,
    pub adapter_version: u32,
    pub entry: SkillCatalogEntry,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledSkill {
    pub id: String,
    pub revision: String,
    pub enabled: bool,
    pub selected: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous_revision: Option<String>,
    pub invocation: String,
    pub entry: SkillCatalogEntry,
    pub versions: Vec<SkillVersion>,
}
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct SkillMarketState {
    #[serde(default)]
    pub items: BTreeMap<String, InstalledSkill>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillSelection {
    pub id: String,
    pub revision: String,
    pub invocation: String,
    pub directory: PathBuf,
}
impl InstalledSkill {
    fn current_version(&self) -> Result<&SkillVersion, String> {
        self.versions
            .iter()
            .find(|version| version.revision == self.revision)
            .ok_or_else(|| "Installed skill version is missing".into())
    }
}
impl SkillMarketState {
    pub fn installed_versions(&self) -> Result<Vec<SkillVersion>, String> {
        self.items
            .values()
            .map(|record| record.current_version().cloned())
            .collect()
    }

    pub fn publish(&self, version: SkillVersion) -> Self {
        let entry = version.entry.clone();
        let mut next = self.clone();
        let record = next
            .items
            .entry(entry.id.clone())
            .or_insert_with(|| InstalledSkill {
                id: entry.id.clone(),
                revision: version.revision.clone(),
                enabled: false,
                selected: false,
                previous_revision: None,
                invocation: version.invocation.clone(),
                entry: entry.clone(),
                versions: vec![],
            });
        if record.revision != version.revision {
            record.previous_revision = Some(record.revision.clone());
        }
        record.revision = version.revision.clone();
        record.invocation = version.invocation.clone();
        record.entry = entry;
        if let Some(existing) = record
            .versions
            .iter_mut()
            .find(|v| v.revision == version.revision)
        {
            *existing = version;
        } else {
            record.versions.push(version);
        }
        next
    }
    pub fn enable(&self, id: &str, enabled: bool) -> Result<Self, String> {
        let mut next = self.clone();
        let record = next.items.get_mut(id).ok_or("Skill is not installed")?;
        record.enabled = enabled;
        record.selected = enabled;
        if next.items.values().filter(|s| s.selected).count() > 32 {
            return Err("Select at most 32 skills for a new conversation".into());
        }
        Ok(next)
    }
    pub fn remove(&self, id: &str) -> Result<Self, String> {
        let mut next = self.clone();
        next.items.remove(id).ok_or("Skill is not installed")?;
        Ok(next)
    }
    pub fn rollback(&self, id: &str, revision: Option<&str>) -> Result<Self, String> {
        let mut next = self.clone();
        let record = next.items.get_mut(id).ok_or("Skill is not installed")?;
        let target = revision
            .or(record.previous_revision.as_deref())
            .ok_or("No previous version is installed")?;
        let version = record
            .versions
            .iter()
            .find(|v| v.revision == target)
            .ok_or("Requested rollback version is not installed")?
            .clone();
        record.previous_revision = Some(record.revision.clone());
        record.revision = version.revision;
        record.invocation = version.invocation;
        record.entry = version.entry;
        Ok(next)
    }
    pub fn selections(&self) -> Result<Vec<SkillSelection>, String> {
        self.items
            .values()
            .filter(|record| record.enabled && record.selected)
            .map(|record| {
                let version = record.current_version()?;
                Ok(SkillSelection {
                    id: record.id.clone(),
                    revision: record.revision.clone(),
                    invocation: version.invocation.clone(),
                    directory: version.directory.clone(),
                })
            })
            .collect()
    }
}

#[derive(Debug, Deserialize)]
#[serde(tag = "operation", deny_unknown_fields)]
pub enum Request {
    #[serde(rename = "cancel")]
    Cancel { id: String },
    #[serde(rename = "catalog")]
    Catalog,
    #[serde(rename = "installed")]
    Installed,
    #[serde(rename = "install")]
    Install { id: String },
    #[serde(rename = "enable")]
    Enable { id: String, enabled: bool },
    #[serde(rename = "remove")]
    Remove { id: String },
    #[serde(rename = "check-update")]
    CheckUpdate { id: String },
    #[serde(rename = "update")]
    Update {
        id: String,
        revision: String,
        sha256: String,
    },
    #[serde(rename = "rollback")]
    Rollback {
        id: String,
        revision: Option<String>,
    },
}
impl Request {
    pub fn acquisition_id(&self) -> Option<&str> {
        match self {
            Self::Install { id } | Self::Update { id, .. } | Self::CheckUpdate { id } => Some(id),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests;
