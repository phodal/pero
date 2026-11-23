//! A local checklist is source context, not a Cloud Task or accepted Run.
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct RoadmapItem {
    pub line: usize,
    pub parent_line: Option<usize>,
    pub title: String,
    pub text: String,
    pub checked: bool,
    pub headings: Vec<String>,
}

impl RoadmapItem {
    /// Separate the title and explicit acceptance clause for display. Execution uses the full source.
    pub fn detail_text(&self) -> (&str, Option<&str>) {
        let body = if self.text == self.title {
            ""
        } else {
            self.text
                .strip_prefix(self.title.as_str())
                .and_then(|rest| rest.strip_prefix(". "))
                .unwrap_or(&self.text)
        };
        for marker in ["验收：", "Acceptance:"] {
            if let Some((description, criterion)) = body.split_once(marker) {
                if !criterion.trim().is_empty() {
                    return (
                        description.trim_end_matches([' ', '；', ';']),
                        Some(criterion.trim()),
                    );
                }
            }
        }
        (body, None)
    }

    pub fn prompt(&self, path: &str) -> String {
        format!(
            "{}\n\nImplement this local ROADMAP item.\nSource: {path}:{}\nContext: {}\n\n{}\n\nFollow the workspace instructions, preserve unrelated changes, and verify the result. Do not commit, push, publish, or mark the source complete without explicit user authorization.",
            self.title,
            self.line,
            self.headings.join(" / "),
            self.text
        )
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RoadmapError {
    NotFound,
    Read,
    Invalid,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct LocalRoadmap {
    pub workspace: String,
    pub path: String,
    pub items: Vec<RoadmapItem>,
    pub error: Option<RoadmapError>,
}
