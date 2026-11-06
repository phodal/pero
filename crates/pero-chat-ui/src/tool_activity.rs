//! Semantic activity for compact ACP presentation, including generic historical calls.
use serde::Serialize;
use serde_json::Value;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ActivityKind {
    Read,
    Search,
    Fetch,
    Edit,
    Execute,
    Delete,
    Move,
    Think,
    #[default]
    Other,
}
impl ActivityKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Read => "read",
            Self::Search => "search",
            Self::Fetch => "fetch",
            Self::Edit => "edit",
            Self::Execute => "execute",
            Self::Delete => "delete",
            Self::Move => "move",
            Self::Think => "think",
            Self::Other => "other",
        }
    }
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct ToolActivity {
    pub kind: ActivityKind,
    pub detail: String,
}
impl ToolActivity {
    /// ACP kind is authoritative. Exact known leaf names supplement generic providers.
    pub fn from_acp(kind: &str, title: &str, locations: &[String], input: Option<&Value>) -> Self {
        let kind = match kind {
            "read" => ActivityKind::Read,
            "search" => ActivityKind::Search,
            "fetch" => ActivityKind::Fetch,
            "edit" => ActivityKind::Edit,
            "execute" => ActivityKind::Execute,
            "delete" => ActivityKind::Delete,
            "move" => ActivityKind::Move,
            "think" => ActivityKind::Think,
            _ => match title.rsplit("__").next().unwrap_or(title) {
                "read" | "read_file" | "list_directory" | "Read" | "List" => ActivityKind::Read,
                "grep" | "glob" | "search" | "search_files" | "Grep" | "Glob" => {
                    ActivityKind::Search
                }
                "web_fetch" | "fetch" | "WebFetch" => ActivityKind::Fetch,
                "write" | "write_file" | "edit_file" | "apply_patch" | "Edit" | "Write" => {
                    ActivityKind::Edit
                }
                "bash" | "shell" | "exec_command" | "run_command" | "Bash" => ActivityKind::Execute,
                _ => ActivityKind::Other,
            },
        };
        let detail = input
            .and_then(|value| {
                [
                    "title",
                    "description",
                    "objective",
                    "task",
                    "question",
                    "command",
                    "cmd",
                    "query",
                    "pattern",
                    "url",
                    "uri",
                    "file_path",
                    "path",
                    "directory",
                ]
                .iter()
                .find_map(|key| value[*key].as_str().filter(|s| !s.trim().is_empty()))
            })
            .or_else(|| locations.first().map(String::as_str))
            .unwrap_or_default();
        Self {
            kind,
            detail: preview(detail, 160),
        }
    }
}

/// Ranked activity counts; equal counts retain first-observed category order.
pub struct ActivitySummary {
    pub counts: Vec<(ActivityKind, usize)>,
}
impl ActivitySummary {
    pub fn new<'a>(activities: impl IntoIterator<Item = &'a ToolActivity>) -> Self {
        let mut counts = Vec::new();
        for activity in activities {
            if let Some((_, count)) = counts.iter_mut().find(|(kind, _)| *kind == activity.kind) {
                *count += 1;
            } else {
                counts.push((activity.kind, 1));
            }
        }
        counts.sort_by(|a, b| b.1.cmp(&a.1));
        Self { counts }
    }
}

pub(crate) fn preview(text: &str, limit: usize) -> String {
    let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if text.chars().count() <= limit {
        text
    } else {
        format!(
            "{}…",
            text.chars()
                .take(limit.saturating_sub(1))
                .collect::<String>()
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn semantic_activity_preserves_authoritative_kinds_and_unknown_tools() {
        for (kind, title, args, expected, detail) in [
            (
                "other",
                "read_file",
                json!({"path":"src/main.rs"}),
                ActivityKind::Read,
                "src/main.rs",
            ),
            (
                "other",
                "list_directory",
                json!({"path":"."}),
                ActivityKind::Read,
                ".",
            ),
            (
                "other",
                "shell",
                json!({"command":"git status", "description":"Inspect changes"}),
                ActivityKind::Execute,
                "Inspect changes",
            ),
            (
                "other",
                "mcp__files__read_file",
                json!({"path":"a.txt"}),
                ActivityKind::Read,
                "a.txt",
            ),
            (
                "execute",
                "read_file",
                json!({"cmd":"pwd"}),
                ActivityKind::Execute,
                "pwd",
            ),
            (
                "other",
                "research_readiness",
                json!({"path":"x"}),
                ActivityKind::Other,
                "x",
            ),
            (
                "other",
                "grep",
                json!({"query":42,"pattern":"目标\n  文件"}),
                ActivityKind::Search,
                "目标 文件",
            ),
        ] {
            let activity = ToolActivity::from_acp(kind, title, &[], Some(&args));
            assert_eq!(
                (activity.kind, activity.detail.as_str()),
                (expected, detail)
            );
        }
        assert_eq!(
            ToolActivity::from_acp("read", "Read file", &["a.rs".into()], None).detail,
            "a.rs"
        );
        assert_eq!(preview("中文测试", 3), "中文…");
    }
    #[test]
    fn activity_counts_rank_frequency_and_retain_tie_order() {
        for (kinds, expected) in [
            (vec![], vec![]),
            (
                vec![
                    ActivityKind::Execute,
                    ActivityKind::Read,
                    ActivityKind::Read,
                    ActivityKind::Search,
                ],
                vec![
                    (ActivityKind::Read, 2),
                    (ActivityKind::Execute, 1),
                    (ActivityKind::Search, 1),
                ],
            ),
        ] {
            let activities: Vec<_> = kinds
                .into_iter()
                .map(|kind| ToolActivity {
                    kind,
                    detail: String::new(),
                })
                .collect();
            assert_eq!(ActivitySummary::new(&activities).counts, expected);
        }
    }
}
