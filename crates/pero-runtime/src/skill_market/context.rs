//! Explicit chat context is a frozen installed version, independent of activation.
use super::SkillVersion;
use pero_contracts::context::{ContextCandidate, ContextContent, ContextKind, ContextReference};
use sha2::{Digest, Sha256};
use std::path::PathBuf;

pub const CONTEXT_SOURCE_PREFIX: &str = "pero-market-skill:";
impl SkillVersion {
    pub(super) fn context_source(&self) -> String {
        format!("{CONTEXT_SOURCE_PREFIX}{}@{}", self.entry.id, self.revision)
    }
    pub(super) fn context_candidate(&self, query: &str) -> Option<ContextCandidate> {
        let entry = &self.entry;
        if !format!(
            "{} {} {} {} {}",
            entry.id, entry.name, entry.title_zh, entry.description, entry.description_zh
        )
        .to_lowercase()
        .contains(&query.to_lowercase())
        {
            return None;
        }
        Some(ContextCandidate {
            kind: ContextKind::Skill,
            label: entry.name.clone(),
            source: self.context_source(),
            detail: format!(
                "installed · {} · {}@{:.12}",
                if entry.description_zh.is_empty() {
                    &entry.description
                } else {
                    &entry.description_zh
                },
                entry.source.repository,
                self.revision
            ),
        })
    }
    pub(super) fn skill_file(&self) -> PathBuf {
        self.directory.join("source").join(&self.entry.source.path)
    }
    pub(super) fn context_reference(&self, text: String) -> Result<ContextReference, String> {
        if format!("{:x}", Sha256::digest(text.as_bytes())) != self.sha256 {
            return Err(
                "Installed skill content changed; reinstall it before selecting context".into(),
            );
        }
        let reference = ContextReference {
            id: self.context_source(),
            kind: ContextKind::Skill,
            label: self.entry.name.clone(),
            source: self.context_source(),
            content: ContextContent::Text {
                text: format!(
                    "Installed skill: {}\nRevision: {}\nSkill file: {}\nResources root: {}\n\n{}",
                    self.entry.name,
                    self.revision,
                    self.skill_file().display(),
                    self.directory.join("source").display(),
                    text
                ),
            },
        };
        ContextReference::validate_all(std::slice::from_ref(&reference)).map_err(str::to_string)?;
        Ok(reference)
    }
}
