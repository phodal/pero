//! Reviewed webpage text and its immutable identity in a local Project.
use serde::{Deserialize, Serialize};

pub const MAX_PROJECT_SOURCE_BYTES: usize = 16_384;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum WebCaptureScope {
    Page,
    Selection,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(try_from = "String", into = "String")]
pub struct ProjectSourceId(String);

impl ProjectSourceId {
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for ProjectSourceId {
    type Error = &'static str;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        if value.len() == 36
            && value.bytes().enumerate().all(|(index, byte)| {
                if matches!(index, 8 | 13 | 18 | 23) {
                    byte == b'-'
                } else {
                    byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)
                }
            })
        {
            Ok(Self(value))
        } else {
            Err("Invalid source capture ID")
        }
    }
}

impl From<ProjectSourceId> for String {
    fn from(id: ProjectSourceId) -> Self {
        id.0
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WebSourceInput {
    pub id: ProjectSourceId,
    pub url: String,
    pub title: String,
    pub content: String,
    pub reason: String,
    pub question: String,
    pub scope: WebCaptureScope,
    pub truncated: bool,
    pub captured_at: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(try_from = "WebSourceInput", into = "WebSourceInput")]
pub struct ReviewedWebSource(WebSourceInput);

impl TryFrom<WebSourceInput> for ReviewedWebSource {
    type Error = &'static str;

    fn try_from(input: WebSourceInput) -> Result<Self, Self::Error> {
        let source = Self(input);
        let data = source.capture();
        let url = url::Url::parse(&data.url).map_err(|_| "Invalid source URL")?;
        if data.url.len() > 4096
            || data.url.chars().any(char::is_whitespace)
            || data.url.chars().any(char::is_control)
            || !matches!(url.scheme(), "http" | "https")
            || url.host().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
        {
            return Err("Use an HTTP(S) source URL without credentials");
        }
        if data.title.trim().is_empty()
            || data.title.len() > 160
            || data.title.chars().any(char::is_control)
        {
            return Err("Enter a source title of at most 160 UTF-8 bytes");
        }
        if data.content.trim().is_empty()
            || data.captured_at == 0
            || [&data.content, &data.reason, &data.question]
                .into_iter()
                .any(|text| {
                    text.chars()
                        .any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t'))
                })
        {
            return Err("Enter readable source text from a browser capture");
        }
        if data.reason.len() > 2048
            || data.question.len() > 2048
            || source.markdown().len() > MAX_PROJECT_SOURCE_BYTES
        {
            return Err("The reviewed source exceeds its UTF-8 byte limit");
        }
        Ok(source)
    }
}

impl From<ReviewedWebSource> for WebSourceInput {
    fn from(source: ReviewedWebSource) -> Self {
        source.0
    }
}

impl ReviewedWebSource {
    pub fn capture(&self) -> &WebSourceInput {
        &self.0
    }

    pub fn markdown(&self) -> String {
        let data = self.capture();
        let scope = match data.scope {
            WebCaptureScope::Page => "page",
            WebCaptureScope::Selection => "selection",
        };
        let truncated = if data.truncated {
            "\nCapture was truncated."
        } else {
            ""
        };
        let mut text = format!(
            "# {}\n\n{}\n\nChrome {scope} · {} (Unix ms){truncated}\n\n{}",
            data.title, data.url, data.captured_at, data.content
        );
        if !data.reason.is_empty() {
            text.push_str("\n\n## Why collect it?\n");
            text.push_str(&data.reason);
        }
        if !data.question.is_empty() {
            text.push_str("\n\n## Question\n");
            text.push_str(&data.question);
        }
        text
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectWebSource {
    pub project_id: String,
    pub source: ReviewedWebSource,
    pub sha256: String,
    pub saved_at: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectWebSourceSummary {
    pub id: ProjectSourceId,
    pub title: String,
    pub url: String,
    pub scope: WebCaptureScope,
    pub truncated: bool,
    pub sha256: String,
    pub saved_at: u64,
}

impl ProjectWebSource {
    pub fn summary(&self) -> ProjectWebSourceSummary {
        let source = self.source.capture();
        ProjectWebSourceSummary {
            id: source.id.clone(),
            title: source.title.clone(),
            url: source.url.clone(),
            scope: source.scope,
            truncated: source.truncated,
            sha256: self.sha256.clone(),
            saved_at: self.saved_at,
        }
    }
}
