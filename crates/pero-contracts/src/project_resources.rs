//! Public catalog observations, not copied App documents or scientific acceptance.
use crate::research_project::ProjectResourceRef;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProjectResourceSummary {
    /// Papers retain their content digest. Other revisions fingerprint the
    /// observed catalog fields, not an immutable full experiment/result version.
    pub reference: ProjectResourceRef,
    pub title: String,
    pub summary: String,
    /// The owning App's recorded state; it never implies scientific acceptance.
    pub status: String,
    /// An existing App check verdict, kept separate from execution state.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub verification: Option<String>,
    pub location: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProjectResourceCatalog {
    pub app: String,
    pub resources: Vec<ProjectResourceSummary>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}
