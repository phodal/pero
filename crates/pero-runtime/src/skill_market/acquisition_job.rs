//! Frozen inputs for one acquisition, executable without the installed-state lock.
use super::*;
use sha2::{Digest, Sha256};
use std::{path::PathBuf, process::Command};

pub enum AcquisitionKind {
    Install,
    Update,
    CheckUpdate,
}
pub struct SkillAcquisition {
    pub(super) entry: SkillCatalogEntry,
    pub(super) current_revision: Option<String>,
    pub(super) installed_sha256: String,
    pub(super) pinned_revision: Option<String>,
    pub(super) pinned_sha256: Option<String>,
    pub(super) kind: AcquisitionKind,
    pub(super) root: PathBuf,
    pub(super) harness: String,
    pub(super) control: AcquisitionControl,
}
pub enum AcquisitionResult {
    Installed(SkillVersion),
    Upstream {
        latest_revision: String,
        latest_sha256: String,
    },
}
#[derive(Deserialize)]
struct Receipt {
    directory: PathBuf,
    revision: String,
    sha256: String,
    invocation: String,
    #[serde(rename = "adapterVersion")]
    adapter_version: u32,
}
impl Drop for SkillAcquisition {
    fn drop(&mut self) {
        self.control.finish(&self.entry.id);
    }
}

impl SkillAcquisition {
    fn command(&self, args: &[String]) -> Result<String, String> {
        let mut command = Command::new(&self.harness);
        command.arg("plugins").args(args);
        self.control.run(&self.entry.id, command)
    }
    pub fn run(&self) -> Result<AcquisitionResult, String> {
        let mut entry = self.entry.clone();
        if matches!(self.kind, AcquisitionKind::CheckUpdate) {
            let value = self.command(&[
                "skill-observe".into(),
                format!("https://github.com/{}.git", entry.source.repository),
                entry.source.path.clone(),
            ])?;
            let mut fields = value.split_whitespace();
            let revision = fields.next().unwrap_or("").to_owned();
            let digest = fields.next().unwrap_or("").to_owned();
            if fields.next().is_some()
                || !super::store::hex(&revision, 40)
                || !super::store::hex(&digest, 64)
            {
                return Err("Upstream did not return a pinned revision and content digest".into());
            }
            return Ok(AcquisitionResult::Upstream {
                latest_revision: revision,
                latest_sha256: digest,
            });
        }
        let revision = match self.kind {
            AcquisitionKind::Install => entry.source.commit.clone(),
            AcquisitionKind::Update => self
                .pinned_revision
                .clone()
                .ok_or("Update requires the observed revision")?,
            AcquisitionKind::CheckUpdate => unreachable!("check-update returns before fetch"),
        };
        let namespace = format!("market-{:x}", Sha256::digest(entry.id.as_bytes()));
        let expected = match self.kind {
            AcquisitionKind::Install => entry.source.sha256.clone(),
            AcquisitionKind::Update => self
                .pinned_sha256
                .clone()
                .ok_or("Update requires the observed content digest")?,
            AcquisitionKind::CheckUpdate => unreachable!("check-update returns before fetch"),
        };
        if !super::store::hex(&expected, 64) {
            return Err("Skill acquisition requires a pinned content digest".into());
        }
        let output = self.command(&[
            "fetch-skill".into(),
            format!("https://github.com/{}.git", entry.source.repository),
            self.root.join("snapshots").to_string_lossy().into(),
            revision.clone(),
            entry.source.path.clone(),
            namespace[..31].into(),
            expected.clone(),
        ])?;
        let receipt: Receipt = serde_json::from_str(&output)
            .map_err(|_| "Harness returned an invalid skill receipt")?;
        let root = dunce::canonicalize(self.root.join("snapshots")).map_err(|e| e.to_string())?;
        let directory = dunce::canonicalize(&receipt.directory).map_err(|e| e.to_string())?;
        if !directory.starts_with(root)
            || receipt.revision != revision
            || !super::store::hex(&receipt.sha256, 64)
            || !receipt.sha256.eq_ignore_ascii_case(&expected)
        {
            return Err("Harness skill receipt does not match the requested source".into());
        }
        if receipt.revision != entry.source.commit {
            entry.verification.notes.push("This updated source passed package checks; curated descriptions, dependencies and license evidence still refer to the earlier catalog review, not a new content or scientific review.".into());
            entry.source.git_blob_sha = None;
            entry.source.resource_fingerprint = None;
            entry.related_instruction_ids.clear();
            entry.sources.clear();
        }
        entry.source.commit = receipt.revision.clone();
        entry.source.sha256 = receipt.sha256.clone();
        entry.source.url = format!(
            "https://github.com/{}/blob/{}/{}",
            entry.source.repository, entry.source.commit, entry.source.path
        );
        Ok(AcquisitionResult::Installed(SkillVersion {
            revision: receipt.revision,
            sha256: receipt.sha256,
            invocation: receipt.invocation,
            directory,
            adapter_version: receipt.adapter_version,
            entry,
        }))
    }
    pub(super) fn publish<T>(
        &self,
        write: impl FnOnce() -> Result<T, String>,
    ) -> Result<T, String> {
        self.control.publish(&self.entry.id, write)
    }
}
