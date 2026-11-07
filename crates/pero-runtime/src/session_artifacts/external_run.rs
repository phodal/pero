use super::{ArtifactStoreError, open_regular_artifact_file};
use pero_contracts::session_artifact::{
    ArtifactMedia, ArtifactRelationRole, ArtifactSource, ExternalRunManifest, MAX_ARTIFACT_FILE_BYTES,
};
use sha2::{Digest, Sha256};
use std::{io::Read, path::Path};

pub(super) struct CapturedFile {
    pub filename: String,
    pub source: ArtifactSource,
    pub media: ArtifactMedia,
    pub bytes: Vec<u8>,
    pub digest: String,
}

impl CapturedFile {
    pub fn read(workspace: &Path, path: &Path, limit: u64) -> Result<Self, ArtifactStoreError> {
        let path = std::fs::canonicalize(workspace.join(path))?;
        if !path.starts_with(workspace) {
            return Err(ArtifactStoreError::OutsideWorkspace);
        }
        let mut bytes = Vec::new();
        open_regular_artifact_file(&path)?.take(limit + 1).read_to_end(&mut bytes)?;
        if bytes.len() as u64 > limit {
            return Err(ArtifactStoreError::Unsupported);
        }
        let filename = path.file_name().unwrap_or_default().to_string_lossy().into_owned();
        let media = ArtifactMedia::from_filename(&filename);
        let source = ArtifactSource::File { path: path.to_string_lossy().into_owned() };
        media.validate_snapshot(&bytes, &source).map_err(|_| ArtifactStoreError::Unsupported)?;
        let digest = format!("{:x}", Sha256::digest(&bytes));
        Ok(Self { filename, media, source, bytes, digest })
    }

    pub fn run_evidence(&self, workspace: &Path) -> Result<Vec<(ArtifactRelationRole, Self)>, ArtifactStoreError> {
        let ArtifactSource::File { path } = &self.source else { return Ok(Vec::new()); };
        let manifest_path = format!("{path}.pero-run.json");
        match std::fs::symlink_metadata(&manifest_path) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            result => { result?; }
        }
        let receipt = Self::read(workspace, Path::new(&manifest_path), 64 * 1024)?;
        let manifest: ExternalRunManifest = serde_json::from_slice(&receipt.bytes)
            .map_err(|_| ArtifactStoreError::Invalid(pero_contracts::session_artifact::ArtifactError::Source))?;
        manifest.validate()?;
        if manifest.output_sha256 != self.digest {
            return Err(ArtifactStoreError::Integrity);
        }
        let mut total = receipt.bytes.len() as u64;
        let mut files = vec![(ArtifactRelationRole::RunRecord, receipt)];
        for evidence in manifest.evidence {
            let limit = MAX_ARTIFACT_FILE_BYTES.min(64 * 1024 * 1024 - total);
            let file = Self::read(workspace, Path::new(&evidence.path), limit)?;
            if file.digest != evidence.sha256 {
                return Err(ArtifactStoreError::Integrity);
            }
            total += file.bytes.len() as u64;
            files.push((evidence.role, file));
        }
        Ok(files)
    }
}
