//! One versioned SkillHub acquisition, published through the installed inventory.
use super::*;
use sha2::{Digest, Sha256};
use std::{fs, process::Command};

#[derive(Clone)]
pub struct SkillHubIdentity {
    publisher: String,
    slug: String,
}

impl SkillHubIdentity {
    pub fn new(publisher: String, slug: String) -> Result<Self, String> {
        for segment in [&publisher, &slug] {
            if segment.is_empty()
                || segment.len() > 100
                || !segment
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
            {
                return Err("Invalid SkillHub release identity".into());
            }
        }
        Ok(Self { publisher, slug })
    }

    pub fn publisher(&self) -> &str {
        &self.publisher
    }

    pub fn slug(&self) -> &str {
        &self.slug
    }
}

pub struct SkillHubInstall {
    pub name: String,
    pub description: String,
    pub description_zh: String,
    pub version: String,
    pub version_id: u64,
}

pub struct SkillHubAcquisition {
    identity: SkillHubIdentity,
    id: String,
    root: PathBuf,
    harness: String,
    control: AcquisitionControl,
    uncommitted: Option<PathBuf>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Receipt {
    directory: PathBuf,
    revision: String,
    sha256: String,
    invocation: String,
    adapter_version: u32,
}

impl SkillHubAcquisition {
    pub(super) fn begin(
        identity: SkillHubIdentity,
        root: PathBuf,
        harness: String,
        control: AcquisitionControl,
    ) -> Result<Self, String> {
        let id = format!("skillhub:{}/{}", identity.publisher(), identity.slug());
        control.begin(&id)?;
        Ok(Self {
            identity,
            id,
            root,
            harness,
            control,
            uncommitted: None,
        })
    }

    pub fn run(&mut self, release: SkillHubInstall) -> Result<SkillVersion, String> {
        let snapshots = self.root.join("snapshots");
        fs::create_dir_all(&snapshots).map_err(|error| error.to_string())?;
        let cache = snapshots.join(format!("skillhub-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&cache).map_err(|error| error.to_string())?;
        self.uncommitted = Some(cache.clone());
        let mut command = Command::new(&self.harness);
        command
            .args(["plugins", "fetch-skillhub"])
            .arg(&cache)
            .args([
                self.identity.publisher(),
                self.identity.slug(),
                &release.version,
                &release.version_id.to_string(),
            ]);
        let output = self.control.run(&self.id, command)?;
        let receipt: Receipt = serde_json::from_str(&output)
            .map_err(|_| "Harness returned an invalid SkillHub receipt")?;
        let directory =
            dunce::canonicalize(receipt.directory).map_err(|error| error.to_string())?;
        if !directory.starts_with(dunce::canonicalize(cache).map_err(|error| error.to_string())?)
            || !super::store::hex(&receipt.revision, 64)
            || !super::store::hex(&receipt.sha256, 64)
        {
            return Err("SkillHub install receipt did not match the snapshot store".into());
        }
        let repository = format!("{}/{}", self.identity.publisher(), self.identity.slug());
        let entry = SkillCatalogEntry {
            id: self.id.clone(),
            name: release.name.clone(),
            title_zh: release.name.clone(),
            description: release.description.clone(),
            description_zh: release.description_zh.clone(),
            category: "skillhub".into(),
            category_zh: "SkillHub".into(),
            kind: "general_skill".into(),
            source: SkillSource {
                url: format!("https://skillhub.cn/skills/{repository}"),
                repository,
                commit: receipt.revision.clone(),
                path: "SKILL.md".into(),
                release: Some(release.version.clone()),
                sha256: receipt.sha256.clone(),
                release_id: Some(release.version_id),
                git_blob_sha: None,
                resource_fingerprint: None,
                archive: None,
            },
            license: SkillLicense {
                spdx: None,
                status: "community_unreviewed".into(),
                evidence_url: None,
                declaration: None,
            },
            compatibility: SkillCompatibility {
                declared: vec![],
                status: "static_instructions".into(),
            },
            verification: SkillVerification {
                content: "package_checked".into(),
                runtime: "not_run".into(),
                notes: vec![],
            },
            sources: vec![],
            dependencies: vec![],
            inputs: vec![],
            outputs: vec![],
            examples: vec![],
            related_instruction_ids: vec![],
        };
        Ok(SkillVersion {
            revision: inventory_revision(release.version_id, &receipt.revision),
            sha256: receipt.sha256,
            invocation: receipt.invocation,
            directory,
            adapter_version: receipt.adapter_version,
            entry,
        })
    }

    pub(super) fn publish<T>(
        &mut self,
        retain_snapshot: bool,
        write: impl FnOnce() -> Result<T, String>,
    ) -> Result<T, String> {
        let result = self.control.publish(&self.id, write)?;
        if retain_snapshot {
            self.uncommitted = None;
        }
        Ok(result)
    }
}

impl Drop for SkillHubAcquisition {
    fn drop(&mut self) {
        if let Some(directory) = self.uncommitted.take() {
            let _ = fs::remove_dir_all(directory);
        }
        self.control.finish(&self.id);
    }
}

fn inventory_revision(version_id: u64, package_digest: &str) -> String {
    let mut hash = Sha256::new();
    hash.update(version_id.to_be_bytes());
    hash.update(package_digest);
    format!("{:x}", hash.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn inventory_revision_tracks_release_and_package_bytes() {
        let first = inventory_revision(17, &"a".repeat(64));
        assert_eq!(first, inventory_revision(17, &"a".repeat(64)));
        assert_ne!(first, inventory_revision(18, &"a".repeat(64)));
        assert_ne!(first, inventory_revision(17, &"b".repeat(64)));
    }

    #[test]
    fn only_committed_acquisitions_keep_their_snapshots() {
        let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        let control = AcquisitionControl::default();
        let id = "skillhub:publisher/skill";
        let identity = SkillHubIdentity::new("publisher".into(), "skill".into()).unwrap();
        for outcome in ["published", "reused", "cancelled", "write failed"] {
            let mut job = SkillHubAcquisition::begin(
                identity.clone(),
                root.clone(),
                String::new(),
                control.clone(),
            )
            .unwrap();
            let cache = root.join(outcome);
            fs::create_dir_all(&cache).unwrap();
            job.uncommitted = Some(cache.clone());
            assert!(control.ensure_idle(id).is_err());
            if outcome == "cancelled" {
                control.cancel(id).unwrap();
            }
            let result = job.publish(outcome != "reused", || {
                assert_ne!(outcome, "cancelled");
                if outcome == "write failed" {
                    Err("Write failed".into())
                } else {
                    Ok(())
                }
            });
            assert_eq!(result.is_ok(), matches!(outcome, "published" | "reused"));
            drop(job);
            assert_eq!(cache.exists(), outcome == "published");
            assert!(root.join("published").is_dir());
            control.ensure_idle(id).unwrap();
        }
        fs::remove_dir_all(root).unwrap();
    }
}
