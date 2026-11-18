//! One versioned SkillHub acquisition, published through the installed inventory.
use super::*;
use std::process::Command;

pub struct SkillHubInstall {
    pub publisher: String,
    pub slug: String,
    pub name: String,
    pub description: String,
    pub description_zh: String,
    pub version: String,
    pub version_id: u64,
}

pub struct SkillHubAcquisition {
    release: SkillHubInstall,
    id: String,
    root: PathBuf,
    harness: String,
    control: AcquisitionControl,
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
        release: SkillHubInstall,
        root: PathBuf,
        harness: String,
        control: AcquisitionControl,
    ) -> Result<Self, String> {
        let id = format!("skillhub:{}/{}", release.publisher, release.slug);
        control.begin(&id)?;
        Ok(Self {
            release,
            id,
            root,
            harness,
            control,
        })
    }

    pub fn run(&self) -> Result<SkillVersion, String> {
        let release = &self.release;
        let cache = self.root.join("snapshots");
        let mut command = Command::new(&self.harness);
        command
            .args(["plugins", "fetch-skillhub"])
            .arg(&cache)
            .args([
                &release.publisher,
                &release.slug,
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
        let repository = format!("{}/{}", release.publisher, release.slug);
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
            revision: receipt.revision,
            sha256: receipt.sha256,
            invocation: receipt.invocation,
            directory,
            adapter_version: receipt.adapter_version,
            entry,
        })
    }

    pub(super) fn publish<T>(
        &self,
        write: impl FnOnce() -> Result<T, String>,
    ) -> Result<T, String> {
        self.control.publish(&self.id, write)
    }
}

impl Drop for SkillHubAcquisition {
    fn drop(&mut self) {
        self.control.finish(&self.id);
    }
}
