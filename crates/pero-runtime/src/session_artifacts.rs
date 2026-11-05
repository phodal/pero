//! Profile-owned conversation deliveries, independent of open document tabs.
use base64::{Engine, engine::general_purpose::STANDARD};
use pero_contracts::{
    content_document::{ContentDocument, ContentFormat, DocumentSource},
    content_origin::ContentOrigin,
    context::{ContextContent, ContextKind, ContextReference},
    session_artifact::{
        ArtifactError, ArtifactImageType, ArtifactMedia, ArtifactRequest, ArtifactSnapshot,
        ArtifactSource, MAX_ARTIFACT_FILE_BYTES, SessionArtifact, SessionArtifactVersion,
    },
};
use sha2::{Digest, Sha256};
use std::{
    io::Read,
    path::{Path, PathBuf},
};

pub struct SessionArtifacts {
    directory: PathBuf,
}

#[derive(Debug)]
pub enum ArtifactStoreError {
    Io(std::io::Error),
    Invalid(ArtifactError),
    Integrity,
    Unavailable,
    Unsupported,
    OutsideWorkspace,
}
impl std::fmt::Display for ArtifactStoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(error) => write!(f, "Artifact storage could not be read or written: {error}"),
            Self::Invalid(error) => std::fmt::Display::fmt(error, f),
            Self::Integrity => f.write_str(
                "The saved artifact is damaged; its snapshot does not match its recorded version",
            ),
            Self::Unavailable => f.write_str("This artifact or version is unavailable"),
            Self::Unsupported => {
                f.write_str("Choose UTF-8 text up to 2 MiB, or a supported document, image or PDF file up to 10 MiB")
            }
            Self::OutsideWorkspace => {
                f.write_str("Choose a file inside this conversation's original workspace")
            }
        }
    }
}
impl std::error::Error for ArtifactStoreError {}
impl From<std::io::Error> for ArtifactStoreError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}
impl From<ArtifactError> for ArtifactStoreError {
    fn from(error: ArtifactError) -> Self {
        Self::Invalid(error)
    }
}
impl ArtifactStoreError {
    pub fn reason(&self) -> &'static str {
        match self {
            Self::Io(_) => "read_write",
            Self::Invalid(_) => "invalid",
            Self::Integrity => "integrity",
            Self::Unavailable => "unavailable",
            Self::Unsupported => "unsupported",
            Self::OutsideWorkspace => "outside_workspace",
        }
    }
}

impl SessionArtifacts {
    pub fn new(settings: &Path) -> Self {
        Self {
            directory: settings.with_extension("artifacts"),
        }
    }
    fn thread_directory(&self, thread: &str) -> PathBuf {
        self.directory
            .join(format!("{:x}", Sha256::digest(thread.as_bytes())))
    }
    pub fn list(&self, thread: &str) -> Result<Vec<SessionArtifact>, ArtifactStoreError> {
        let bytes = match std::fs::read(self.thread_directory(thread).join("catalog.json")) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(error.into()),
        };
        let artifacts: Vec<SessionArtifact> =
            serde_json::from_slice(&bytes).map_err(|_| ArtifactStoreError::Integrity)?;
        let mut ids = std::collections::HashSet::new();
        for artifact in &artifacts {
            artifact
                .validate()
                .map_err(|_| ArtifactStoreError::Integrity)?;
            if artifact.thread_id != thread || !ids.insert(&artifact.id) {
                return Err(ArtifactStoreError::Integrity);
            }
        }
        Ok(artifacts)
    }
    pub fn register(
        &self,
        request: ArtifactRequest,
        workspace: Option<&Path>,
        created_at: u64,
    ) -> Result<SessionArtifact, ArtifactStoreError> {
        let (_, thread, requested_id) = request.scope();
        let mut artifacts = self.list(thread)?;
        let previous = requested_id
            .map(|id| {
                artifacts
                    .iter()
                    .find(|artifact| artifact.id == id)
                    .ok_or(ArtifactStoreError::Unavailable)
            })
            .transpose()?;
        let (title, bytes, media, filename, source, message, tool) = match &request {
            ArtifactRequest::RegisterText {
                title,
                text,
                format,
                source_message_id,
                source_tool_call_id,
                ..
            } => {
                let format = format.clone().unwrap_or(ContentFormat::Markdown);
                let extension = match &format {
                    ContentFormat::Markdown => "md",
                    ContentFormat::Json => "json",
                    ContentFormat::JsonLines => "jsonl",
                    ContentFormat::Text => "txt",
                    ContentFormat::Code(language) => match language.as_str() {
                        "rust" => "rs",
                        "python" => "py",
                        "javascript" => "js",
                        "typescript" => "ts",
                        language => language,
                    },
                };
                let filename = format!("artifact.{extension}");
                (
                    title.clone(),
                    text.as_bytes().to_vec(),
                    ArtifactMedia::Document { format },
                    filename,
                    ArtifactSource::Text,
                    source_message_id.clone(),
                    source_tool_call_id.clone(),
                )
            }
            ArtifactRequest::RegisterFile {
                title,
                path,
                source_message_id,
                source_tool_call_id,
                ..
            } => {
                let workspace =
                    std::fs::canonicalize(workspace.ok_or(ArtifactStoreError::Unavailable)?)?;
                let requested = Path::new(path);
                let path = std::fs::canonicalize(if requested.is_absolute() {
                    requested.to_path_buf()
                } else {
                    workspace.join(requested)
                })?;
                if !path.starts_with(&workspace) {
                    return Err(ArtifactStoreError::OutsideWorkspace);
                }
                let mut bytes = Vec::new();
                let file = std::fs::File::open(&path)?;
                if !file.metadata()?.is_file() {
                    return Err(ArtifactStoreError::Unsupported);
                }
                file.take(MAX_ARTIFACT_FILE_BYTES + 1)
                    .read_to_end(&mut bytes)?;
                let filename = path
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into_owned();
                let media = ArtifactMedia::from_filename(&filename);
                let title = title
                    .clone()
                    .or_else(|| previous.map(|artifact| artifact.title.clone()))
                    .unwrap_or_else(|| {
                        path.file_name()
                            .unwrap_or_default()
                            .to_string_lossy()
                            .into_owned()
                    });
                (
                    title,
                    bytes,
                    media,
                    filename,
                    ArtifactSource::File {
                        path: path.to_string_lossy().into_owned(),
                    },
                    source_message_id.clone(),
                    source_tool_call_id.clone(),
                )
            }
            _ => return Err(ArtifactStoreError::Unavailable),
        };
        media
            .validate_snapshot(&bytes, &source)
            .map_err(|_| ArtifactStoreError::Unsupported)?;
        let sha256 = format!("{:x}", Sha256::digest(&bytes));
        let version = SessionArtifactVersion {
            version: previous.map_or(1, |artifact| artifact.latest().version + 1),
            sha256: sha256.clone(),
            bytes: bytes.len() as u64,
            format: media
                .content_format()
                .cloned()
                .unwrap_or(ContentFormat::Text),
            media: Some(media),
            filename: Some(filename),
            source,
            source_message_id: message,
            source_tool_call_id: tool,
            created_at,
        };
        let artifact = if let Some(previous) = previous {
            previous.append(title, version)?
        } else {
            SessionArtifact::new(
                uuid::Uuid::new_v4().to_string(),
                thread.to_owned(),
                title,
                version,
            )?
        };
        if let Some(previous) = artifacts
            .iter_mut()
            .find(|previous| previous.id == artifact.id)
        {
            *previous = artifact.clone();
        } else {
            artifacts.push(artifact.clone());
        }
        let directory = self.thread_directory(thread);
        std::fs::create_dir_all(directory.join("snapshots"))?;
        // Publish bytes before the catalog. An interrupted write never points at an incomplete snapshot.
        crate::workspace_store::write(
            &directory.join("snapshots").join(format!("{sha256}.bin")),
            &bytes,
        )?;
        let bytes = serde_json::to_vec(&artifacts).map_err(|_| ArtifactStoreError::Integrity)?;
        crate::workspace_store::write(&directory.join("catalog.json"), &bytes)?;
        Ok(artifact)
    }
    pub fn read(
        &self,
        thread: &str,
        id: &str,
        version: Option<u64>,
    ) -> Result<ContentDocument, ArtifactStoreError> {
        let (snapshot, bytes, title) = self.load_snapshot(thread, id, version)?;
        let ArtifactMedia::Document { format } = snapshot.media else {
            return Err(ArtifactStoreError::Unsupported);
        };
        let text = String::from_utf8(bytes).map_err(|_| ArtifactStoreError::Integrity)?;
        Ok(ContentDocument::new(
            DocumentSource {
                id: format!("session-artifact:{}:v{}", id, snapshot.version),
                title,
                origin: ContentOrigin::Conversation {
                    thread_id: thread.into(),
                },
            },
            snapshot.version,
            text,
            format,
        ))
    }

    pub fn resolve_snapshot(
        &self,
        thread: &str,
        id: &str,
        version: u64,
    ) -> Result<ArtifactSnapshot, ArtifactStoreError> {
        self.load_snapshot(thread, id, Some(version))
            .map(|(snapshot, _, _)| snapshot)
    }

    pub fn context(
        &self,
        thread: &str,
        id: &str,
        version: u64,
    ) -> Result<ContextReference, ArtifactStoreError> {
        let (snapshot, bytes, _) = self.load_snapshot(thread, id, Some(version))?;
        let source = format!("session-artifact:{id}:v{version}");
        let content = match &snapshot.media {
            ArtifactMedia::Image { mime_type } if *mime_type != ArtifactImageType::Svg => {
                ContextContent::Image {
                    data: STANDARD.encode(&bytes),
                    mime_type: mime_type.as_str().into(),
                }
            }
            _ if snapshot.media != ArtifactMedia::Pdf && bytes.len() <= 128_000 => {
                ContextContent::Text {
                    text: String::from_utf8(bytes).map_err(|_| ArtifactStoreError::Integrity)?,
                }
            }
            _ => ContextContent::Text {
                text: format!(
                    "Artifact snapshot reference only; file contents are not included.\nFilename: {}\nVersion: {}\nSHA-256: {}\nBytes: {}\nRead-only snapshot: {}\nRead this exact frozen snapshot to inspect the file. Do not substitute the original workspace file, which may have changed. No scientific validation is implied.",
                    snapshot.filename, version, snapshot.sha256, snapshot.bytes, snapshot.path,
                ),
            },
        };
        let reference = ContextReference {
            id: source.clone(),
            kind: if matches!(content, ContextContent::Image { .. }) {
                ContextKind::Image
            } else {
                ContextKind::File
            },
            label: format!("{} v{version}", snapshot.filename),
            source,
            content,
        };
        ContextReference::validate_all(std::slice::from_ref(&reference))
            .map_err(|_| ArtifactStoreError::Unsupported)?;
        Ok(reference)
    }

    fn load_snapshot(
        &self,
        thread: &str,
        id: &str,
        version: Option<u64>,
    ) -> Result<(ArtifactSnapshot, Vec<u8>, String), ArtifactStoreError> {
        let artifact = self
            .list(thread)?
            .into_iter()
            .find(|artifact| artifact.id == id)
            .ok_or(ArtifactStoreError::Unavailable)?;
        let version = match version {
            Some(number) => artifact
                .versions
                .iter()
                .find(|version| version.version == number)
                .ok_or(ArtifactStoreError::Unavailable)?,
            None => artifact.latest(),
        };
        let directory = self.thread_directory(thread).join("snapshots");
        let mut path = directory.join(format!("{}.bin", version.sha256));
        let bytes = match std::fs::File::open(&path) {
            Ok(file) => {
                let mut bytes = Vec::new();
                file.take(MAX_ARTIFACT_FILE_BYTES + 1)
                    .read_to_end(&mut bytes)?;
                bytes
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                // Original text catalogs used .txt. Their bytes and recorded digest remain authoritative.
                path = directory.join(format!("{}.txt", version.sha256));
                let mut bytes = Vec::new();
                std::fs::File::open(&path)?
                    .take(MAX_ARTIFACT_FILE_BYTES + 1)
                    .read_to_end(&mut bytes)?;
                bytes
            }
            Err(error) => return Err(error.into()),
        };
        if bytes.len() as u64 != version.bytes
            || format!("{:x}", Sha256::digest(&bytes)) != version.sha256
        {
            return Err(ArtifactStoreError::Integrity);
        }
        let media = version.resolved_media();
        media
            .validate_snapshot(&bytes, &version.source)
            .map_err(|_| ArtifactStoreError::Integrity)?;
        let filename = version
            .filename
            .clone()
            .or_else(|| match &version.source {
                ArtifactSource::File { path } => Path::new(path)
                    .file_name()
                    .map(|name| name.to_string_lossy().into_owned()),
                ArtifactSource::Text => None,
            })
            .unwrap_or_else(|| "artifact.txt".into());
        Ok((
            ArtifactSnapshot {
                thread_id: thread.into(),
                artifact_id: artifact.id.clone(),
                version: version.version,
                filename,
                media,
                sha256: version.sha256.clone(),
                bytes: version.bytes,
                path: std::fs::canonicalize(path)?.to_string_lossy().into_owned(),
            },
            bytes,
            artifact.title,
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pero_contracts::session_artifact::ArtifactMethod;
    #[test]
    fn deliveries_keep_exact_versions_across_restart_and_refuse_outside_files() {
        let root =
            std::env::temp_dir().join(format!("pero-session-artifacts-{}", uuid::Uuid::new_v4()));
        let workspace = root.join("work");
        std::fs::create_dir_all(&workspace).unwrap();
        let settings = root.join("settings.json");
        let path = workspace.join("report.md");
        std::fs::write(&path, "first\n").unwrap();
        let request = |path: &Path, artifact_id| ArtifactRequest::RegisterFile {
            method: ArtifactMethod::Artifacts,
            request_id: "test".into(),
            thread_id: "chat".into(),
            artifact_id,
            title: None,
            path: path.to_string_lossy().into_owned(),
            source_message_id: None,
            source_tool_call_id: Some("write".into()),
        };
        let store = SessionArtifacts::new(&settings);
        let first = store
            .register(request(&path, None), Some(&workspace), 10)
            .unwrap();
        // Upgrade an original text-only catalog in place, preserving its .txt snapshot.
        let mut legacy = serde_json::to_value(vec![first.clone()]).unwrap();
        let metadata = legacy[0]["versions"][0].as_object_mut().unwrap();
        metadata.remove("media");
        metadata.remove("filename");
        let directory = store.thread_directory("chat");
        std::fs::write(
            directory.join("catalog.json"),
            serde_json::to_vec(&legacy).unwrap(),
        )
        .unwrap();
        std::fs::rename(
            directory
                .join("snapshots")
                .join(format!("{}.bin", first.latest().sha256)),
            directory
                .join("snapshots")
                .join(format!("{}.txt", first.latest().sha256)),
        )
        .unwrap();
        std::fs::write(&path, "second\n").unwrap();
        let second = store
            .register(request(&path, Some(first.id.clone())), Some(&workspace), 20)
            .unwrap();
        assert_eq!(second.latest().version, 2);
        let restored = SessionArtifacts::new(&settings);
        assert_eq!(restored.list("chat").unwrap().len(), 1);
        assert_eq!(
            restored.read("chat", &first.id, Some(1)).unwrap().source(),
            "first\n"
        );
        assert_eq!(
            restored.read("chat", &first.id, None).unwrap().source(),
            "second\n"
        );
        assert!(restored.read("other", &first.id, None).is_err());
        let outside = root.join("outside.md");
        std::fs::write(&outside, "outside").unwrap();
        assert!(matches!(
            restored.register(request(&outside, None), Some(&workspace), 30),
            Err(ArtifactStoreError::OutsideWorkspace)
        ));
        let text = restored
            .register(
                ArtifactRequest::RegisterText {
                    method: ArtifactMethod::Artifacts,
                    request_id: "text".into(),
                    thread_id: "chat".into(),
                    artifact_id: None,
                    title: "Summary".into(),
                    text: "# Saved reply\n".into(),
                    format: Some(ContentFormat::Markdown),
                    source_message_id: Some("message:1".into()),
                    source_tool_call_id: None,
                },
                None,
                30,
            )
            .unwrap();
        assert_eq!(
            restored.read("chat", &text.id, Some(1)).unwrap().source(),
            "# Saved reply\n"
        );
        assert_eq!(
            SessionArtifacts::new(&settings).list("chat").unwrap().len(),
            2
        );
        let digest = &second.latest().sha256;
        std::fs::write(
            restored
                .thread_directory("chat")
                .join("snapshots")
                .join(format!("{digest}.bin")),
            "changed",
        )
        .unwrap();
        assert!(matches!(
            restored.read("chat", &first.id, None),
            Err(ArtifactStoreError::Integrity)
        ));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rich_versions_preserve_binary_bytes_and_freeze_prompt_context() {
        let root =
            std::env::temp_dir().join(format!("pero-rich-artifacts-{}", uuid::Uuid::new_v4()));
        let workspace = root.join("workspace");
        std::fs::create_dir_all(&workspace).unwrap();
        let settings = root.join("settings.json");
        let store = SessionArtifacts::new(&settings);
        for (name, bytes) in [
            ("plot.png", b"\x89PNG\r\n\x1a\n\0\xff".as_slice()),
            ("paper.pdf", b"%PDF-1.4\n\0\xff".as_slice()),
            ("report.html", b"<h1>Frozen</h1>".as_slice()),
            ("data.csv", b"x,y\n1,2\n".as_slice()),
            ("analysis.ipynb", b"{\"cells\":[]}".as_slice()),
            ("plot.svg", b"<svg/>".as_slice()),
            ("analysis.py", b"value = 1\n".as_slice()),
        ] {
            let path = workspace.join(name);
            std::fs::write(&path, bytes).unwrap();
            let request = |artifact_id| ArtifactRequest::RegisterFile {
                method: ArtifactMethod::Artifacts,
                request_id: "capture".into(),
                thread_id: "thread".into(),
                artifact_id,
                title: None,
                path: name.into(),
                source_message_id: None,
                source_tool_call_id: None,
            };
            let first = store.register(request(None), Some(&workspace), 10).unwrap();
            std::fs::write(&path, b"changed").unwrap();
            let next = store
                .register(request(Some(first.id.clone())), Some(&workspace), 20)
                .unwrap();
            assert_eq!(next.latest().version, 2);
            std::fs::remove_file(&path).unwrap();
            let reopened = SessionArtifacts::new(&settings);
            let frozen = reopened.resolve_snapshot("thread", &first.id, 1).unwrap();
            assert_eq!(std::fs::read(&frozen.path).unwrap(), bytes, "{name}");
            assert_eq!(frozen.sha256, format!("{:x}", Sha256::digest(bytes)));
            assert_eq!(frozen.filename, name);
            assert_eq!(frozen.bytes, bytes.len() as u64);
            assert!(reopened.resolve_snapshot("other", &first.id, 1).is_err());
            assert!(reopened.resolve_snapshot("thread", &first.id, 3).is_err());
            assert_eq!(
                reopened.read("thread", &first.id, Some(1)).is_ok(),
                name.ends_with(".py")
            );
            let context = reopened.context("thread", &first.id, 1).unwrap();
            assert_eq!(context.source, format!("session-artifact:{}:v1", first.id));
            match context.content {
                ContextContent::Image { data, mime_type } => {
                    assert_eq!(name, "plot.png");
                    assert_eq!(mime_type, "image/png");
                    assert_eq!(STANDARD.decode(data).unwrap(), bytes);
                }
                ContextContent::Text { text } if name.ends_with(".pdf") => {
                    assert!(text.contains("reference only"));
                    assert!(text.contains(&frozen.path));
                    assert!(text.contains(&frozen.sha256));
                }
                ContextContent::Text { text } => assert_eq!(text.as_bytes(), bytes),
            }
            std::fs::write(&frozen.path, b"damaged").unwrap();
            assert!(matches!(
                reopened.resolve_snapshot("thread", &first.id, 1),
                Err(ArtifactStoreError::Integrity)
            ));
        }
        let large_text = workspace.join("large.md");
        std::fs::write(&large_text, vec![b'x'; 128_001]).unwrap();
        let artifact = store
            .register(
                ArtifactRequest::RegisterFile {
                    method: ArtifactMethod::Artifacts,
                    request_id: "large".into(),
                    thread_id: "thread".into(),
                    artifact_id: None,
                    title: None,
                    path: "large.md".into(),
                    source_message_id: None,
                    source_tool_call_id: None,
                },
                Some(&workspace),
                30,
            )
            .unwrap();
        let ContextContent::Text { text } =
            store.context("thread", &artifact.id, 1).unwrap().content
        else {
            panic!("text reference");
        };
        assert!(text.contains("reference only"));
        assert!(text.len() < 128_000);
        std::fs::remove_dir_all(root).unwrap();
    }
}
