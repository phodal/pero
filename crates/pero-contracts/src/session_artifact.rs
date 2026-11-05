//! Explicit conversation deliveries. References and snapshots confer no verification verdict.
use crate::content_document::ContentFormat;
use serde::{Deserialize, Serialize};

pub const MAX_ARTIFACT_BYTES: u64 = 2 * 1024 * 1024;
pub const MAX_ARTIFACT_FILE_BYTES: u64 = 10 * 1024 * 1024;

/// A preview contract, not a claim that a file is scientifically valid or safe to execute.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum ArtifactMedia {
    Document { format: ContentFormat },
    Csv,
    Tsv,
    Image { mime_type: ArtifactImageType },
    Pdf,
    Html,
    Notebook,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum ArtifactImageType {
    #[serde(rename = "image/png")]
    Png,
    #[serde(rename = "image/jpeg")]
    Jpeg,
    #[serde(rename = "image/gif")]
    Gif,
    #[serde(rename = "image/webp")]
    Webp,
    #[serde(rename = "image/svg+xml")]
    Svg,
}
impl ArtifactImageType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Png => "image/png",
            Self::Jpeg => "image/jpeg",
            Self::Gif => "image/gif",
            Self::Webp => "image/webp",
            Self::Svg => "image/svg+xml",
        }
    }
}

impl ArtifactMedia {
    pub fn mime_type(&self) -> &'static str {
        match self {
            Self::Document {
                format: ContentFormat::Markdown,
            } => "text/markdown;charset=utf-8",
            Self::Document {
                format: ContentFormat::Json,
            } => "application/json",
            Self::Document {
                format: ContentFormat::JsonLines,
            } => "application/x-ndjson",
            Self::Document { .. } => "text/plain;charset=utf-8",
            Self::Csv => "text/csv;charset=utf-8",
            Self::Tsv => "text/tab-separated-values;charset=utf-8",
            Self::Image { mime_type } => mime_type.as_str(),
            Self::Pdf => "application/pdf",
            Self::Html => "text/html;charset=utf-8",
            Self::Notebook => "application/x-ipynb+json",
        }
    }
    pub fn content_format(&self) -> Option<&ContentFormat> {
        match self {
            Self::Document { format } => Some(format),
            _ => None,
        }
    }
    pub fn from_filename(filename: &str) -> Self {
        let extension = filename
            .rsplit_once('.')
            .map(|(_, extension)| extension)
            .unwrap_or("")
            .to_ascii_lowercase();
        match extension.as_str() {
            "csv" => Self::Csv,
            "tsv" => Self::Tsv,
            "png" => Self::Image {
                mime_type: ArtifactImageType::Png,
            },
            "jpg" | "jpeg" => Self::Image {
                mime_type: ArtifactImageType::Jpeg,
            },
            "gif" => Self::Image {
                mime_type: ArtifactImageType::Gif,
            },
            "webp" => Self::Image {
                mime_type: ArtifactImageType::Webp,
            },
            "svg" => Self::Image {
                mime_type: ArtifactImageType::Svg,
            },
            "pdf" => Self::Pdf,
            "html" | "htm" => Self::Html,
            "ipynb" => Self::Notebook,
            _ => Self::Document {
                format: ContentFormat::from_extension(&extension),
            },
        }
    }

    /// File syntax is interpreted by the viewer. The Host admits bounded bytes once.
    pub fn validate_snapshot(
        &self,
        bytes: &[u8],
        source: &ArtifactSource,
    ) -> Result<(), ArtifactError> {
        if bytes.len() as u64 > source.max_bytes() {
            return Err(ArtifactError::Snapshot);
        }
        if !matches!(
            self,
            Self::Pdf
                | Self::Image {
                    mime_type: ArtifactImageType::Png
                        | ArtifactImageType::Jpeg
                        | ArtifactImageType::Gif
                        | ArtifactImageType::Webp
                }
        ) && (bytes.contains(&0) || std::str::from_utf8(bytes).is_err())
        {
            return Err(ArtifactError::Media);
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum ArtifactSource {
    Text,
    File { path: String },
}
impl ArtifactSource {
    fn max_bytes(&self) -> u64 {
        match self {
            Self::Text => MAX_ARTIFACT_BYTES,
            Self::File { .. } => MAX_ARTIFACT_FILE_BYTES,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SessionArtifactVersion {
    pub version: u64,
    pub sha256: String,
    pub bytes: u64,
    pub format: ContentFormat,
    /// Absent in the original text-only catalog; format remains its compatibility projection.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub media: Option<ArtifactMedia>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub filename: Option<String>,
    pub source: ArtifactSource,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_message_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_tool_call_id: Option<String>,
    pub created_at: u64,
}

/// Shell-private reference to verified, immutable bytes. Never forward its path to an App or Wasm.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ArtifactSnapshot {
    pub thread_id: String,
    pub artifact_id: String,
    pub version: u64,
    pub filename: String,
    pub media: ArtifactMedia,
    pub sha256: String,
    pub bytes: u64,
    pub path: String,
}

/// Presentation identity only; the Host still resolves the version and owns its bytes.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ArtifactPreviewTarget {
    pub thread_id: String,
    pub artifact_id: String,
    pub version: u64,
}

/// Public presentation state for the retained browser; the Host still owns the catalog and bytes.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ArtifactBrowserState {
    pub thread_id: String,
    pub artifacts: Vec<SessionArtifact>,
    pub selected: Option<ArtifactPreviewTarget>,
    pub view: crate::workbench::ArtifactView,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SessionArtifact {
    pub id: String,
    pub thread_id: String,
    pub title: String,
    pub versions: Vec<SessionArtifactVersion>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ArtifactError {
    Identity,
    Title,
    Snapshot,
    Version,
    Source,
    Media,
}

impl std::fmt::Display for ArtifactError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::Identity => "Invalid conversation or artifact identity",
            Self::Title => "Enter an artifact title of at most 200 characters",
            Self::Snapshot => "Artifact snapshots require a SHA-256 digest; text is limited to 2 MiB and files to 10 MiB",
            Self::Version => "Artifact versions must be consecutive, starting at 1",
            Self::Source => "Invalid artifact source reference",
            Self::Media => "Choose a supported image, PDF, or UTF-8 document file",
        })
    }
}
impl std::error::Error for ArtifactError {}

fn identifier(value: &str) -> bool {
    !value.is_empty() && value.len() <= 128 && !value.chars().any(char::is_control)
}
fn title_valid(value: &str) -> bool {
    !value.trim().is_empty() && value.chars().count() <= 200 && !value.chars().any(char::is_control)
}
impl SessionArtifactVersion {
    pub fn resolved_media(&self) -> ArtifactMedia {
        self.media
            .clone()
            .unwrap_or_else(|| ArtifactMedia::Document {
                format: self.format.clone(),
            })
    }

    fn validate(&self) -> Result<(), ArtifactError> {
        if self.sha256.len() != 64
            || !self
                .sha256
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            || self.bytes > self.source.max_bytes()
        {
            return Err(ArtifactError::Snapshot);
        }
        if [&self.source_message_id, &self.source_tool_call_id]
            .into_iter()
            .flatten()
            .any(|value| {
                value.is_empty() || value.len() > 512 || value.chars().any(char::is_control)
            })
            || matches!(&self.source, ArtifactSource::File { path } if path.is_empty() || path.contains('\0'))
        {
            return Err(ArtifactError::Source);
        }
        if self.filename.as_ref().is_some_and(|name| {
            name.is_empty()
                || name.len() > 255
                || name.contains(['/', '\\'])
                || name.chars().any(char::is_control)
        }) || self.media.as_ref().is_some_and(|media| {
            media
                .content_format()
                .cloned()
                .unwrap_or(ContentFormat::Text)
                != self.format
        }) || matches!(&self.format, ContentFormat::Code(language) if language.len() > 64 || language.chars().any(char::is_control))
        {
            return Err(ArtifactError::Source);
        }
        Ok(())
    }
}
impl SessionArtifact {
    pub fn new(
        id: String,
        thread_id: String,
        title: String,
        version: SessionArtifactVersion,
    ) -> Result<Self, ArtifactError> {
        let artifact = Self {
            id,
            thread_id,
            title,
            versions: vec![version],
        };
        artifact.validate()?;
        Ok(artifact)
    }
    pub fn validate(&self) -> Result<(), ArtifactError> {
        if !identifier(&self.id) || !identifier(&self.thread_id) {
            return Err(ArtifactError::Identity);
        }
        if !title_valid(&self.title) {
            return Err(ArtifactError::Title);
        }
        if self.versions.is_empty() {
            return Err(ArtifactError::Version);
        }
        for (index, version) in self.versions.iter().enumerate() {
            if version.version != index as u64 + 1 {
                return Err(ArtifactError::Version);
            }
            version.validate()?;
        }
        Ok(())
    }
    pub fn latest(&self) -> &SessionArtifactVersion {
        self.versions
            .last()
            .expect("validated artifact has a version")
    }
    pub fn append(
        &self,
        title: String,
        version: SessionArtifactVersion,
    ) -> Result<Self, ArtifactError> {
        if !title_valid(&title) {
            return Err(ArtifactError::Title);
        }
        if self.latest().version.checked_add(1) != Some(version.version) {
            return Err(ArtifactError::Version);
        }
        version.validate()?;
        let mut next = self.clone();
        next.title = title;
        next.versions.push(version);
        Ok(next)
    }
}

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ArtifactMethod {
    #[default]
    Artifacts,
}

/// The Host supplies the actual session scope for Agent tool calls. Source IDs are attribution only.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
pub enum ArtifactRequest {
    List {
        #[serde(default)]
        method: ArtifactMethod,
        request_id: String,
        thread_id: String,
    },
    RegisterText {
        #[serde(default)]
        method: ArtifactMethod,
        request_id: String,
        thread_id: String,
        #[serde(default)]
        artifact_id: Option<String>,
        title: String,
        text: String,
        #[serde(default)]
        format: Option<ContentFormat>,
        #[serde(default)]
        source_message_id: Option<String>,
        #[serde(default)]
        source_tool_call_id: Option<String>,
    },
    RegisterFile {
        #[serde(default)]
        method: ArtifactMethod,
        request_id: String,
        thread_id: String,
        #[serde(default)]
        artifact_id: Option<String>,
        #[serde(default)]
        title: Option<String>,
        path: String,
        #[serde(default)]
        source_message_id: Option<String>,
        #[serde(default)]
        source_tool_call_id: Option<String>,
    },
    Read {
        #[serde(default)]
        method: ArtifactMethod,
        request_id: String,
        thread_id: String,
        artifact_id: String,
        #[serde(default)]
        version: Option<u64>,
    },
    ResolveSnapshot {
        #[serde(default)]
        method: ArtifactMethod,
        request_id: String,
        thread_id: String,
        artifact_id: String,
        version: u64,
    },
    Context {
        #[serde(default)]
        method: ArtifactMethod,
        request_id: String,
        thread_id: String,
        artifact_id: String,
        version: u64,
    },
}
impl ArtifactRequest {
    pub fn scope(&self) -> (&str, &str, Option<&str>) {
        match self {
            Self::List {
                request_id,
                thread_id,
                ..
            } => (request_id, thread_id, None),
            Self::RegisterText {
                request_id,
                thread_id,
                artifact_id,
                ..
            }
            | Self::RegisterFile {
                request_id,
                thread_id,
                artifact_id,
                ..
            } => (request_id, thread_id, artifact_id.as_deref()),
            Self::Read {
                request_id,
                thread_id,
                artifact_id,
                ..
            }
            | Self::ResolveSnapshot {
                request_id,
                thread_id,
                artifact_id,
                ..
            }
            | Self::Context {
                request_id,
                thread_id,
                artifact_id,
                ..
            } => (request_id, thread_id, Some(artifact_id)),
        }
    }
    pub fn validate_identity(&self) -> Result<(), ArtifactError> {
        let (request, thread, artifact) = self.scope();
        if !identifier(request) || !identifier(thread) || artifact.is_some_and(|id| !identifier(id))
        {
            return Err(ArtifactError::Identity);
        }
        if matches!(
            self,
            Self::ResolveSnapshot { version: 0, .. }
                | Self::Context { version: 0, .. }
                | Self::Read {
                    version: Some(0),
                    ..
                }
        ) {
            return Err(ArtifactError::Version);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn version(number: u64) -> SessionArtifactVersion {
        SessionArtifactVersion {
            version: number,
            sha256: "a".repeat(64),
            bytes: 5,
            format: ContentFormat::Text,
            media: None,
            filename: None,
            source: ArtifactSource::Text,
            source_message_id: Some("message:0".into()),
            source_tool_call_id: None,
            created_at: 10,
        }
    }
    #[test]
    fn artifact_versions_retain_snapshots_and_require_consecutive_revisions() {
        let first =
            SessionArtifact::new("a".into(), "thread".into(), "Report".into(), version(1)).unwrap();
        for (title, next, expected) in [
            ("Report", version(2), Ok(2)),
            ("Report", version(3), Err(ArtifactError::Version)),
            (" ", version(2), Err(ArtifactError::Title)),
            (
                "Report",
                SessionArtifactVersion {
                    bytes: MAX_ARTIFACT_BYTES + 1,
                    ..version(2)
                },
                Err(ArtifactError::Snapshot),
            ),
        ] {
            let result = first
                .append(title.into(), next)
                .map(|artifact| artifact.latest().version);
            assert_eq!(result, expected);
            assert_eq!(first.latest().version, 1);
        }
        let mut corrupt = first.clone();
        corrupt.versions[0].sha256 = "path/escape".into();
        assert_eq!(corrupt.validate(), Err(ArtifactError::Snapshot));
    }

    #[test]
    fn media_admits_bounded_bytes_without_interpreting_scientific_content() {
        let file = ArtifactSource::File {
            path: "/work/output".into(),
        };
        for (name, bytes, expected) in [
            (
                "plot.PNG",
                b"\x89PNG\r\n\x1a\n\0\xff".as_slice(),
                Ok(ArtifactMedia::Image {
                    mime_type: ArtifactImageType::Png,
                }),
            ),
            (
                "paper.pdf",
                b"%PDF-1.4\n\0\xff".as_slice(),
                Ok(ArtifactMedia::Pdf),
            ),
            (
                "report.md",
                b"# Report".as_slice(),
                Ok(ArtifactMedia::Document {
                    format: ContentFormat::Markdown,
                }),
            ),
            (
                "analysis.py",
                b"print(1)".as_slice(),
                Ok(ArtifactMedia::Document {
                    format: ContentFormat::Code("python".into()),
                }),
            ),
            ("data.csv", b"x,y\n1,2".as_slice(), Ok(ArtifactMedia::Csv)),
            ("data.tsv", b"x\ty\n1\t2".as_slice(), Ok(ArtifactMedia::Tsv)),
            (
                "report.html",
                b"<h1>Report</h1>".as_slice(),
                Ok(ArtifactMedia::Html),
            ),
            (
                "analysis.ipynb",
                b"{\"cells\":[]}".as_slice(),
                Ok(ArtifactMedia::Notebook),
            ),
            (
                "plot.svg",
                b"<svg/>".as_slice(),
                Ok(ArtifactMedia::Image {
                    mime_type: ArtifactImageType::Svg,
                }),
            ),
            ("data.csv", b"\xff".as_slice(), Err(ArtifactError::Media)),
            ("plot.svg", b"<svg>\0".as_slice(), Err(ArtifactError::Media)),
        ] {
            let media = ArtifactMedia::from_filename(name);
            assert_eq!(
                media.validate_snapshot(bytes, &file).map(|()| media),
                expected,
                "{name}"
            );
        }
        let large = vec![b'x'; MAX_ARTIFACT_BYTES as usize + 1];
        let document = ArtifactMedia::Document {
            format: ContentFormat::Text,
        };
        assert_eq!(
            document.validate_snapshot(&large, &ArtifactSource::Text),
            Err(ArtifactError::Snapshot)
        );
        assert_eq!(document.validate_snapshot(&large, &file), Ok(()));
        assert_eq!(
            ArtifactMedia::Pdf
                .validate_snapshot(&vec![0; MAX_ARTIFACT_FILE_BYTES as usize + 1], &file),
            Err(ArtifactError::Snapshot)
        );
        let mut mismatched = version(1);
        mismatched.media = Some(ArtifactMedia::Document {
            format: ContentFormat::Markdown,
        });
        assert_eq!(mismatched.validate(), Err(ArtifactError::Source));
    }
}
