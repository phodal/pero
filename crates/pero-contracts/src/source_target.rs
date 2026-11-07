//! One citation resolves to an existing content owner.
//! The shell opens that owner. This module reads no files, clock, or network.
use crate::{
    pull_request::PullRequestRef,
    workspace_changes::ChangeScope,
};
use std::ops::Range;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FileCitation {
    pub path: String,
    pub line: Option<u32>,
    pub end_line: Option<u32>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PlanRef {
    path: String,
    pub line: Option<u32>,
    pub end_line: Option<u32>,
}

impl PlanRef {
    pub fn path(&self) -> &str {
        &self.path
    }
    pub fn citation(&self) -> FileCitation {
        FileCitation {
            path: self.path.clone(),
            line: self.line,
            end_line: self.end_line,
        }
    }
    pub fn parse(text: &str) -> Option<Self> {
        let (path, line, end_line) = split_line_suffix(text.trim());
        let name = path.strip_prefix("docs/exec-plans/")?;
        if !plan_path(name) {
            return None;
        }
        Some(Self {
            path,
            line,
            end_line,
        })
    }
    pub fn from_file(workspace: &str, path: &str) -> Option<Self> {
        Self::parse(&relative_path_of(workspace, path)?)
    }
    pub fn prompt(&self, body: &str) -> String {
        format!(
            "Execute the plan in {path}. Edit the workspace to carry it out. Do not commit or push.\n\n{body}",
            path = self.path
        )
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SourceTarget {
    File(FileCitation),
    Output { thread_id: String, tool_id: String },
    Terminal { id: u32 },
    Changes {
        thread_id: String,
        scope: ChangeScope,
        path: Option<String>,
    },
    AgentFile {
        agent_id: String,
        path: String,
        line: Option<u32>,
        end_line: Option<u32>,
    },
    Unavailable { path: String },
    Plan(PlanRef),
    PullRequest(PullRequestRef),
}

impl SourceTarget {
    pub fn parse(text: &str) -> Option<Self> {
        let text = text.trim().trim_end_matches(['.', ',', ';']);
        if text.is_empty() || text.len() > 2048 {
            return None;
        }
        let lower = text.to_ascii_lowercase();
        if lower.starts_with("javascript:")
            || lower.starts_with("data:")
            || lower.starts_with("file:")
            || lower.starts_with("vbscript:")
        {
            return None;
        }
        if let Some(rest) = text.strip_prefix("pero-output://") {
            let (thread_id, tool_id) = rest.split_once('/')?;
            if !ident(thread_id) || !tool_id_ok(tool_id) {
                return None;
            }
            return Some(Self::Output {
                thread_id: thread_id.into(),
                tool_id: tool_id.into(),
            });
        }
        if let Some(rest) = text.strip_prefix("pero-terminal://") {
            let id = rest.parse::<u32>().ok()?;
            return Some(Self::Terminal { id });
        }
        if let Some(rest) = text.strip_prefix("pero-changes://") {
            let (thread_id, rest) = rest.split_once('/')?;
            if !ident(thread_id) {
                return None;
            }
            let (scope, path) = rest.split_once('/').unwrap_or((rest, ""));
            let scope = match scope {
                "turn" => ChangeScope::Turn,
                "worktree" => ChangeScope::Worktree,
                _ => return None,
            };
            let path = if path.is_empty() {
                None
            } else {
                let (path, _, _) = split_line_suffix(path);
                if !is_relative(&path) {
                    return None;
                }
                Some(path)
            };
            return Some(Self::Changes {
                thread_id: thread_id.into(),
                scope,
                path,
            });
        }
        if let Some(rest) = text.strip_prefix("vscode-remote://background-composer+") {
            let (agent_id, rest) = rest.split_once('/')?;
            if !ident(agent_id) {
                return None;
            }
            let (path, line, end_line) = split_line_suffix(rest);
            if !is_relative(&path) {
                return None;
            }
            return Some(Self::AgentFile {
                agent_id: agent_id.into(),
                path,
                line,
                end_line,
            });
        }
        if let Ok(reference) = PullRequestRef::try_from(text.to_owned()) {
            return Some(Self::PullRequest(reference));
        }
        if let Some(plan) = PlanRef::parse(text) {
            return Some(Self::Plan(plan));
        }
        FileCitation::parse(text).map(Self::File)
    }

    /// A remote agent file opens only when a real mapping exists.
    /// An unmapped path stays unavailable and is never joined onto a local path.
    pub fn resolve_remote(self, mapped: bool) -> Self {
        match self {
            Self::AgentFile { path, .. } if !mapped => Self::Unavailable { path },
            other => other,
        }
    }

    pub fn file_in_workspace(
        workspace: &str,
        path: &str,
        line: Option<u32>,
        end_line: Option<u32>,
    ) -> Self {
        let Some(relative) = relative_path_of(workspace, path) else {
            return Self::Unavailable {
                path: path.to_owned(),
            };
        };
        let cited = match (line, end_line) {
            (Some(start), Some(end)) => format!("{relative}:{start}-{end}"),
            (Some(start), None) => format!("{relative}:{start}"),
            _ => relative,
        };
        Self::parse(&cited).unwrap_or(Self::Unavailable {
            path: path.to_owned(),
        })
    }
}

impl FileCitation {
    pub fn parse(text: &str) -> Option<Self> {
        let (path, line, end_line) = split_line_suffix(text.trim());
        if !is_relative(&path) {
            return None;
        }
        if line == Some(0) || end_line.is_some_and(|end| line.is_none_or(|start| end < start)) {
            return None;
        }
        Some(Self {
            path,
            line,
            end_line,
        })
    }
}

pub fn relative_path_of(workspace: &str, path: &str) -> Option<String> {
    let path = path.replace('\\', "/");
    let workspace = workspace
        .trim()
        .trim_end_matches(['/', '\\'])
        .replace('\\', "/");
    let relative = if path.starts_with('/') || (path.len() > 2 && path.as_bytes().get(1) == Some(&b':'))
    {
        if workspace.is_empty() {
            return None;
        }
        path.strip_prefix(&workspace)?.strip_prefix('/')?.to_owned()
    } else {
        path
    };
    is_relative(&relative).then_some(relative)
}

pub fn line_span(source: &str, start_line: u32, end_line: Option<u32>) -> Option<Range<usize>> {
    if start_line == 0 {
        return None;
    }
    let end_line = end_line.unwrap_or(start_line);
    if end_line < start_line {
        return None;
    }
    let mut line = 1u32;
    let mut start = None;
    let mut end = None;
    let mut offset = 0usize;
    for segment in source.split_inclusive('\n') {
        if line == start_line {
            start = Some(offset);
        }
        offset += segment.len();
        if line == end_line {
            end = Some(offset);
            break;
        }
        line += 1;
    }
    Some(start?..end?)
}

fn plan_path(name: &str) -> bool {
    let Some(stem) = name.strip_suffix(".md") else {
        return false;
    };
    !stem.is_empty()
        && !stem.ends_with('/')
        && name.len() <= 256
        && name.split('/').all(ident)
}

fn ident(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && !value.contains("..")
        && !value.starts_with('.')
        && !value.ends_with('.')
        && value.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || byte == b'.' || b"_-".contains(&byte)
        })
}

fn tool_id_ok(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 200
        && !value.contains('/')
        && !value.contains('\\')
        && value != "."
        && value != ".."
        && !value.chars().any(|c| c.is_whitespace() || c.is_control())
}

fn is_relative(path: &str) -> bool {
    !path.is_empty()
        && path.len() <= 1024
        && !path.starts_with('/')
        && !path.contains('\\')
        && !path.contains('\0')
        && !path.chars().any(|c| c.is_control())
        && path
            .split('/')
            .all(|part| !part.is_empty() && part != "." && part != "..")
}

fn split_line_suffix(text: &str) -> (String, Option<u32>, Option<u32>) {
    if let Some((path, spec)) = text.rsplit_once("#L") {
        if let Some((start, end)) = spec.split_once("-L") {
            if let (Ok(start), Ok(end)) = (parse_line(start), parse_line(end)) {
                if end >= start {
                    return (path.to_owned(), Some(start), Some(end));
                }
            }
        } else if let Ok(start) = parse_line(spec) {
            return (path.to_owned(), Some(start), None);
        }
    }
    if let Some((path, spec)) = text.rsplit_once(':') {
        if !path.is_empty() && !path.contains(':') {
            if let Some((start, end)) = spec.split_once('-') {
                if let (Ok(start), Ok(end)) = (parse_line(start), parse_line(end)) {
                    if end >= start {
                        return (path.to_owned(), Some(start), Some(end));
                    }
                }
            } else if let Ok(start) = parse_line(spec) {
                return (path.to_owned(), Some(start), None);
            }
        }
    }
    (text.to_owned(), None, None)
}

fn parse_line(text: &str) -> Result<u32, ()> {
    let line = text.parse::<u32>().map_err(|_| ())?;
    if line == 0 {
        Err(())
    } else {
        Ok(line)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn citations_resolve_to_one_existing_owner() {
        let pr = "https://github.com/Phodal/Pero/pull/164/files";
        let cases = [
            (
                "pero-output://thread-1/tool.2",
                Some(SourceTarget::Output {
                    thread_id: "thread-1".into(),
                    tool_id: "tool.2".into(),
                }),
            ),
            (
                "pero-terminal://7",
                Some(SourceTarget::Terminal { id: 7 }),
            ),
            (
                "pero-changes://thread-1/turn/src/a.rs:4-9",
                Some(SourceTarget::Changes {
                    thread_id: "thread-1".into(),
                    scope: ChangeScope::Turn,
                    path: Some("src/a.rs".into()),
                }),
            ),
            (
                "pero-changes://thread-1/worktree",
                Some(SourceTarget::Changes {
                    thread_id: "thread-1".into(),
                    scope: ChangeScope::Worktree,
                    path: None,
                }),
            ),
            (
                "vscode-remote://background-composer+agent-1/src/a.rs#L2-L4",
                Some(SourceTarget::AgentFile {
                    agent_id: "agent-1".into(),
                    path: "src/a.rs".into(),
                    line: Some(2),
                    end_line: Some(4),
                }),
            ),
            (
                pr,
                PullRequestRef::try_from(pr.to_owned())
                    .ok()
                    .map(SourceTarget::PullRequest),
            ),
            (
                "docs/exec-plans/alpha.md:3",
                PlanRef::parse("docs/exec-plans/alpha.md:3").map(SourceTarget::Plan),
            ),
            (
                "docs/exec-plans/active/harness.md",
                PlanRef::parse("docs/exec-plans/active/harness.md").map(SourceTarget::Plan),
            ),
            ("docs/exec-plans/active/../secret.md", None),
            (
                "docs/exec-plans/notes.txt",
                Some(SourceTarget::File(FileCitation {
                    path: "docs/exec-plans/notes.txt".into(),
                    line: None,
                    end_line: None,
                })),
            ),
            (
                "src/a.rs:10-12",
                Some(SourceTarget::File(FileCitation {
                    path: "src/a.rs".into(),
                    line: Some(10),
                    end_line: Some(12),
                })),
            ),
            ("javascript:alert(1)", None),
            ("file:///etc/passwd", None),
            ("/etc/passwd", None),
            ("../secret", None),
            ("src/../../secret", None),
            ("pero-terminal://nope", None),
            ("pero-output://thread/../tool", None),
        ];
        for (text, expected) in cases {
            assert_eq!(SourceTarget::parse(text), expected, "{text}");
        }
    }

    #[test]
    fn unmapped_remote_files_stay_unavailable() {
        let target = SourceTarget::parse(
            "vscode-remote://background-composer+agent-1/src/a.rs",
        )
        .unwrap();
        assert!(matches!(
            target.clone().resolve_remote(false),
            SourceTarget::Unavailable { path } if path == "src/a.rs"
        ));
        assert!(matches!(
            target.resolve_remote(true),
            SourceTarget::AgentFile { .. }
        ));
        assert!(matches!(
            SourceTarget::file_in_workspace("/work", "/other/src/a.rs", Some(1), None),
            SourceTarget::Unavailable { .. }
        ));
        assert!(matches!(
            SourceTarget::file_in_workspace("/work", "/work/docs/exec-plans/alpha.md", None, None),
            SourceTarget::Plan(_)
        ));
    }

    #[test]
    fn line_span_uses_one_based_lines_and_rejects_a_missing_line() {
        let source = "a\nbb\nccc";
        assert_eq!(line_span(source, 2, None), Some(2..5));
        assert_eq!(line_span(source, 2, Some(3)), Some(2..8));
        assert_eq!(line_span(source, 4, None), None);
        assert_eq!(line_span(source, 0, None), None);
        assert_eq!(line_span(source, 3, Some(2)), None);
    }

    #[test]
    fn a_plan_prompt_edits_the_workspace_without_publishing() {
        let plan = PlanRef::parse("docs/exec-plans/active/harness.md:2-4").unwrap();
        let prompt = plan.prompt("Ship the seam.");
        assert!(prompt.contains("docs/exec-plans/active/harness.md"));
        assert!(prompt.contains("Ship the seam."));
        assert!(prompt.contains("Do not commit or push."));
        assert_eq!(plan.citation().line, Some(2));
        assert_eq!(plan.citation().end_line, Some(4));
    }
}
