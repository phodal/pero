//! Recorded workspace comparisons are independent of explicitly delivered documents.
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ChangeScope {
    Turn,
    Worktree,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ChangedFile {
    pub path: String,
    pub old_path: Option<String>,
    pub added: u64,
    pub deleted: u64,
    pub binary: bool,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct WorkspaceChanges {
    pub id: String,
    pub scope: ChangeScope,
    pub files: Vec<ChangedFile>,
    pub total: usize,
    pub added: u64,
    pub deleted: u64,
    pub created_at: u64,
}
impl WorkspaceChanges {
    /// Git's NUL records preserve tabs and newlines in paths and identify renames explicitly.
    pub fn from_numstat(
        id: String,
        scope: ChangeScope,
        output: &str,
        created_at: u64,
    ) -> Result<Self, String> {
        let mut records = output.split_terminator('\0');
        if !output.is_empty() && !output.ends_with('\0') {
            return Err("Incomplete git change listing".into());
        }
        let mut files = Vec::new();
        while let Some(record) = records.next() {
            let mut fields = record.splitn(3, '\t');
            let added = fields.next().ok_or("Missing added count")?;
            let deleted = fields.next().ok_or("Missing deleted count")?;
            let path = fields.next().ok_or("Missing file path")?;
            let (old_path, path) = if path.is_empty() {
                (
                    Some(records.next().ok_or("Missing rename source")?.to_owned()),
                    records.next().ok_or("Missing rename target")?,
                )
            } else {
                (None, path)
            };
            if path.is_empty() {
                return Err("Empty changed-file path".into());
            }
            let binary = added == "-" && deleted == "-";
            files.push(ChangedFile {
                path: path.into(),
                old_path,
                added: if binary {
                    0
                } else {
                    added.parse().map_err(|_| "Invalid added count")?
                },
                deleted: if binary {
                    0
                } else {
                    deleted.parse().map_err(|_| "Invalid deleted count")?
                },
                binary,
            });
        }
        files.sort_by(|a, b| a.path.cmp(&b.path));
        let total = files.len();
        let added = files.iter().map(|file| file.added).sum();
        let deleted = files.iter().map(|file| file.deleted).sum();
        files.truncate(500);
        Ok(Self {
            id,
            scope,
            files,
            total,
            added,
            deleted,
            created_at,
        })
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum FileComparison {
    Text { patch: String },
    Binary,
    Oversized,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DiffLineKind {
    Context,
    Added,
    Deleted,
    Header,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DiffLine {
    pub kind: DiffLineKind,
    pub old: Option<usize>,
    pub new: Option<usize>,
    pub text: String,
}
impl FileComparison {
    pub fn lines(&self) -> Vec<DiffLine> {
        let Self::Text { patch } = self else {
            return vec![];
        };
        let mut old = 0;
        let mut new = 0;
        let mut hunk = false;
        patch
            .lines()
            .map(|line| {
                let mut result = DiffLine {
                    kind: DiffLineKind::Header,
                    old: None,
                    new: None,
                    text: line.into(),
                };
                if line.starts_with("@@ ") {
                    let fields: Vec<_> = line.split_whitespace().collect();
                    old = fields
                        .get(1)
                        .and_then(|field| {
                            field
                                .trim_start_matches('-')
                                .split(',')
                                .next()?
                                .parse()
                                .ok()
                        })
                        .unwrap_or(0);
                    new = fields
                        .get(2)
                        .and_then(|field| {
                            field
                                .trim_start_matches('+')
                                .split(',')
                                .next()?
                                .parse()
                                .ok()
                        })
                        .unwrap_or(0);
                    hunk = true;
                } else if hunk {
                    match line.as_bytes().first() {
                        Some(b'+') => {
                            result.kind = DiffLineKind::Added;
                            result.new = Some(new);
                            new += 1;
                        }
                        Some(b'-') => {
                            result.kind = DiffLineKind::Deleted;
                            result.old = Some(old);
                            old += 1;
                        }
                        Some(b' ') => {
                            result.kind = DiffLineKind::Context;
                            result.old = Some(old);
                            result.new = Some(new);
                            old += 1;
                            new += 1;
                        }
                        _ => {}
                    }
                }
                result
            })
            .collect()
    }
}

#[derive(Clone, Debug)]
pub struct SplitDiffRow {
    pub left: Option<DiffLine>,
    pub right: Option<DiffLine>,
}
impl FileComparison {
    pub fn split_rows(&self) -> Vec<SplitDiffRow> {
        let lines = self.lines();
        let mut rows = Vec::new();
        let mut index = 0;
        while index < lines.len() {
            if matches!(
                lines[index].kind,
                DiffLineKind::Deleted | DiffLineKind::Added
            ) {
                let first = index;
                while index < lines.len() && lines[index].kind == DiffLineKind::Deleted {
                    index += 1;
                }
                let middle = index;
                while index < lines.len() && lines[index].kind == DiffLineKind::Added {
                    index += 1;
                }
                let old = &lines[first..middle];
                let new = &lines[middle..index];
                for offset in 0..old.len().max(new.len()) {
                    rows.push(SplitDiffRow {
                        left: old.get(offset).cloned(),
                        right: new.get(offset).cloned(),
                    });
                }
            } else {
                rows.push(SplitDiffRow {
                    left: Some(lines[index].clone()),
                    right: Some(lines[index].clone()),
                });
                index += 1;
            }
        }
        rows
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
pub enum ChangesRequest {
    List {
        method: ChangesMethod,
        request_id: String,
        thread_id: String,
    },
    Current {
        method: ChangesMethod,
        request_id: String,
        thread_id: String,
    },
    Read {
        method: ChangesMethod,
        request_id: String,
        thread_id: String,
        id: String,
        index: usize,
    },
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub enum ChangesMethod {
    #[serde(rename = "workspace_changes")]
    WorkspaceChanges,
}
impl ChangesRequest {
    pub fn scope(&self) -> (&str, &str) {
        match self {
            Self::List {
                request_id,
                thread_id,
                ..
            }
            | Self::Current {
                request_id,
                thread_id,
                ..
            }
            | Self::Read {
                request_id,
                thread_id,
                ..
            } => (request_id, thread_id),
        }
    }
    pub fn valid(&self) -> bool {
        let valid = |value: &str| {
            !value.is_empty()
                && !matches!(value, "." | "..")
                && value.len() <= 128
                && value
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"-_:.".contains(&b))
        };
        let (request, thread) = self.scope();
        valid(request)
            && valid(thread)
            && match self {
                Self::Read { id, .. } => valid(id),
                _ => true,
            }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn recorded_change_counts_and_paths() {
        for (input, expected) in [
            ("1\t2\tREADME.md\0", Some((1, 1, 2))),
            ("0\t0\t\0old.rs\0new.rs\0-\t-\timage.png\0", Some((2, 0, 0))),
            ("3\t0\twith\ttab.txt\0", Some((1, 3, 0))),
            ("", Some((0, 0, 0))),
            ("1\t2\tx", None),
            ("x\t2\tx\0", None),
            ("0\t0\t\0old\0", None),
        ] {
            let value = WorkspaceChanges::from_numstat("id".into(), ChangeScope::Turn, input, 1);
            assert_eq!(
                value.as_ref().ok().map(|v| (v.total, v.added, v.deleted)),
                expected
            );
        }
        let value = WorkspaceChanges::from_numstat(
            "id".into(),
            ChangeScope::Turn,
            "0\t0\t\0old.rs\0new.rs\0",
            1,
        )
        .unwrap();
        assert_eq!(value.files[0].old_path.as_deref(), Some("old.rs"));
    }
    #[test]
    fn unified_diff_line_coordinates() {
        let comparison=FileComparison::Text{patch:"--- a/x\n+++ b/x\n@@ -2,2 +2,2 @@\n context\n-old\n+new\n\\ No newline at end of file\n".into()};
        let lines = comparison.lines();
        assert_eq!((lines[3].old, lines[3].new), (Some(2), Some(2)));
        assert_eq!(
            (lines[4].kind, lines[4].old, lines[4].new),
            (DiffLineKind::Deleted, Some(3), None)
        );
        assert_eq!(
            (lines[5].kind, lines[5].old, lines[5].new),
            (DiffLineKind::Added, None, Some(3))
        );
        let split = comparison.split_rows();
        assert_eq!(split[4].left.as_ref().unwrap().kind, DiffLineKind::Deleted);
        assert_eq!(split[4].right.as_ref().unwrap().kind, DiffLineKind::Added);
    }
    #[test]
    fn comparison_request_admission() {
        for (value, accepted) in [
            (
                serde_json::json!({"method":"workspace_changes","action":"list","request_id":"r1","thread_id":"chat-1"}),
                true,
            ),
            (
                serde_json::json!({"method":"workspace_changes","action":"read","request_id":"r1","thread_id":"chat-1","id":"..","index":0}),
                false,
            ),
            (
                serde_json::json!({"method":"workspace_changes","action":"read","request_id":"r1","thread_id":"chat-1","id":"x","index":-1}),
                false,
            ),
            (
                serde_json::json!({"method":"workspace_changes","action":"current","request_id":"r1","thread_id":"chat-1","path":"foreign"}),
                false,
            ),
        ] {
            let request = serde_json::from_value::<ChangesRequest>(value);
            assert_eq!(request.is_ok_and(|request| request.valid()), accepted);
        }
    }
}
