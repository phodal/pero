//! User-visible artifact loading, independent of Agent turns and UI transport.
use pero_contracts::content_document::ContentDocument;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize)]
pub struct ArtifactReference {
    pub id: String,
    pub bytes: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum ArtifactStatus {
    Available,
    Loading { request_id: String },
    Loaded,
    Failed { error: String },
}

#[derive(Clone, Debug, Serialize)]
pub struct ArtifactView {
    pub reference: ArtifactReference,
    pub status: ArtifactStatus,
}

impl ArtifactView {
    pub fn from_content(text: &str) -> Option<Self> {
        #[derive(Deserialize)]
        struct Artifact {
            id: String,
            sha256: String,
            bytes: u64,
            #[serde(rename = "mediaType")]
            mime: String,
        }
        #[derive(Deserialize)]
        struct Envelope {
            #[serde(rename = "type")]
            kind: String,
            artifact: Artifact,
        }
        if text.len() > 8192 {
            return None;
        }
        let Envelope { kind, artifact } = serde_json::from_str(text).ok()?;
        if kind != "content_reference"
            || artifact.mime != "application/json"
            || artifact.id != artifact.sha256
            || artifact.id.len() != 64
            || !artifact
                .id
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        {
            return None;
        }
        Some(Self {
            reference: ArtifactReference {
                id: artifact.id,
                bytes: artifact.bytes,
            },
            status: ArtifactStatus::Available,
        })
    }

    pub fn request(&mut self, request_id: String) -> Option<ArtifactReference> {
        if matches!(
            self.status,
            ArtifactStatus::Loading { .. } | ArtifactStatus::Loaded
        ) {
            return None;
        }
        self.status = ArtifactStatus::Loading { request_id };
        Some(self.reference.clone())
    }

    pub fn cancel(&mut self) -> Option<String> {
        let ArtifactStatus::Loading { request_id } = &self.status else {
            return None;
        };
        let request_id = request_id.clone();
        self.status = ArtifactStatus::Available;
        Some(request_id)
    }

    pub fn finish(
        &mut self,
        id: &str,
        request_id: &str,
        result: Result<ContentDocument, String>,
    ) -> Option<ContentDocument> {
        if self.reference.id != id
            || !matches!(&self.status, ArtifactStatus::Loading {request_id:current} if current == request_id)
        {
            return None;
        }
        match result {
            Ok(document) => {
                self.status = ArtifactStatus::Loaded;
                Some(document)
            }
            Err(error) => {
                self.status = ArtifactStatus::Failed { error };
                None
            }
        }
    }
}

/// UI-only reads are deliberately separate from Agent Host commands.
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum ContentReadIntent {
    ReadResult {
        thread_id: String,
        tool_call_id: String,
        artifact_id: String,
        request_id: String,
    },
    CancelReadResult {
        request_id: String,
    },
}

#[cfg(test)]
mod tests {
    use super::*;
    use pero_contracts::content_document::ContentFormat;
    #[test]
    fn artifact_reading_correlates_cancel_retry_and_completion() {
        let id = "a".repeat(64);
        let text=serde_json::json!({"type":"content_reference","artifact":{"id":id,"sha256":id,"bytes":1000000,"mediaType":"application/json"}}).to_string();
        for final_error in [false, true] {
            let mut view = ArtifactView::from_content(&text).unwrap();
            assert!(view.request("first".into()).is_some());
            assert!(view.request("duplicate".into()).is_none());
            assert_eq!(view.cancel().as_deref(), Some("first"));
            assert!(view.request("retry".into()).is_some());
            let document = || ContentDocument::new(id.clone(), 1, "[]".into(), ContentFormat::Json);
            assert!(view.finish(&id, "first", Ok(document())).is_none());
            assert!(matches!(view.status, ArtifactStatus::Loading { .. }));
            if final_error {
                assert!(
                    view.finish(&id, "retry", Err("missing file".into()))
                        .is_none()
                );
                assert!(matches!(view.status, ArtifactStatus::Failed { .. }));
                assert!(view.request("again".into()).is_some());
            } else {
                assert_eq!(
                    view.finish(&id, "retry", Ok(document())).unwrap().source(),
                    "[]"
                );
                assert!(view.request("again".into()).is_none());
            }
        }
        assert!(ArtifactView::from_content("{\"type\":\"content_reference\"}").is_none());
    }
}
