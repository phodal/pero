//! Typed inline tool results. Unknown provider shapes retain their original reader.
use crate::tool_activity::ActivityKind;
use serde::{Deserialize, Serialize};
use serde_json::Value;
#[derive(Clone, Default, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ToolBody {
    #[default]
    Generic,
    Terminal {
        command: String,
        output: String,
        exit_code: Option<i64>,
        cwd: Option<String>,
    },
    Read {
        path: String,
        text: String,
        start: usize,
    },
    Search {
        text: String,
    },
    Diff {
        files: Vec<FileDiff>,
    },
}
#[derive(Clone, Serialize)]
pub struct FileDiff {
    pub path: String,
    pub patch: String,
    pub added: usize,
    pub deleted: usize,
}
#[derive(Deserialize)]
#[serde(untagged)]
enum OutputText {
    Text(String),
    Stream { text: String },
}
impl OutputText {
    fn text(self) -> String {
        match self {
            Self::Text(text) | Self::Stream { text } => text,
        }
    }
}
#[derive(Deserialize)]
struct TerminalReceipt {
    #[serde(default)]
    stdout: Option<OutputText>,
    #[serde(default)]
    stderr: Option<OutputText>,
    #[serde(default, alias = "exitCode")]
    exit_code: Option<i64>,
}
impl ToolBody {
    pub fn derive(
        kind: ActivityKind,
        input: Option<&Value>,
        raw: Option<&Value>,
        text: &str,
        output: &[Value],
        locations: &[String],
    ) -> Self {
        let input = input.unwrap_or(&Value::Null);
        let mut files = vec![];
        for part in output.iter().filter(|part| part["type"] == "diff") {
            if let (Some(path), Some(old), Some(new)) = (
                part["path"].as_str(),
                part["oldText"].as_str(),
                part["newText"].as_str(),
            ) {
                let diff = similar::TextDiff::from_lines(old, new);
                let added = diff
                    .iter_all_changes()
                    .filter(|c| c.tag() == similar::ChangeTag::Insert)
                    .count();
                let deleted = diff
                    .iter_all_changes()
                    .filter(|c| c.tag() == similar::ChangeTag::Delete)
                    .count();
                let patch = diff.unified_diff().context_radius(3).to_string();
                files.push(FileDiff {
                    path: path.into(),
                    patch,
                    added,
                    deleted,
                });
            }
        }
        if !files.is_empty() {
            return Self::Diff { files };
        }
        let plain = text
            .trim()
            .strip_prefix("```json\n")
            .and_then(|t| t.strip_suffix("```"))
            .unwrap_or(text)
            .trim();
        let parsed = serde_json::from_str::<Value>(plain).ok();
        let value = raw.filter(|value| value.is_object()).or(parsed.as_ref());
        match kind {
            ActivityKind::Execute => {
                let command = input["command"].as_str().or(input["cmd"].as_str());
                let Some(command) = command else {
                    return Self::Generic;
                };
                let (output, exit_code) = if let Some(value) = value {
                    if value.get("stdout").is_none()
                        && value.get("stderr").is_none()
                        && (parsed.is_some()
                            || (value.get("exitCode").is_none()
                                && value.get("exit_code").is_none()))
                    {
                        return Self::Generic;
                    }
                    let Ok(receipt) = serde_json::from_value::<TerminalReceipt>(value.clone())
                    else {
                        return Self::Generic;
                    };
                    let mut text = receipt.stdout.map(OutputText::text).unwrap_or_else(|| {
                        if parsed.is_none() {
                            text.to_owned()
                        } else {
                            String::new()
                        }
                    });
                    if let Some(stderr) = receipt
                        .stderr
                        .map(OutputText::text)
                        .filter(|s| !s.is_empty())
                    {
                        if !text.is_empty() && !text.ends_with('\n') {
                            text.push('\n');
                        }
                        text.push_str(&stderr);
                    }
                    (text, receipt.exit_code)
                } else {
                    (text.to_owned(), None)
                };
                Self::Terminal {
                    command: command.into(),
                    output,
                    exit_code,
                    cwd: input["cwd"]
                        .as_str()
                        .or(input["workdir"].as_str())
                        .map(str::to_owned),
                }
            }
            ActivityKind::Read if !text.is_empty() => {
                let path = input["file_path"]
                    .as_str()
                    .or(input["path"].as_str())
                    .or_else(|| locations.first().map(String::as_str));
                let Some(path) = path else {
                    return Self::Generic;
                };
                let text = if let Some(value) = value {
                    match value["content"].as_str().or(value["text"].as_str()) {
                        Some(text) => text.to_owned(),
                        None if parsed.is_none() => text.to_owned(),
                        None => return Self::Generic,
                    }
                } else {
                    text.to_owned()
                };
                Self::Read {
                    path: path.into(),
                    text,
                    start: value
                        .and_then(|value| value.get("offset"))
                        .unwrap_or(&input["offset"])
                        .as_u64()
                        .filter(|n| *n > 0)
                        .unwrap_or(1) as usize,
                }
            }
            ActivityKind::Search => {
                let Some(value) = value else {
                    return Self::Generic;
                };
                #[derive(Deserialize)]
                struct Match {
                    #[serde(rename = "lineNumber")]
                    line: usize,
                    #[serde(rename = "line")]
                    text: String,
                }
                #[derive(Deserialize)]
                struct SearchFile {
                    path: String,
                    matches: Vec<Match>,
                }
                #[derive(Deserialize)]
                #[serde(untagged)]
                enum Files {
                    Paths(Vec<String>),
                    Groups(Vec<SearchFile>),
                }
                #[derive(Deserialize)]
                struct NativeMatch {
                    path: String,
                    line: usize,
                    text: String,
                }
                #[derive(Deserialize)]
                struct SearchReceipt {
                    #[serde(default)]
                    paths: Option<Vec<String>>,
                    #[serde(default)]
                    files: Option<Files>,
                    #[serde(default)]
                    matches: Option<Vec<NativeMatch>>,
                    #[serde(default)]
                    total: Option<usize>,
                    truncated: bool,
                }
                let Ok(result) = serde_json::from_value::<SearchReceipt>(value.clone()) else {
                    return Self::Generic;
                };
                let entries = if let Some(matches) = result.matches {
                    if matches.iter().any(|hit| hit.line == 0) {
                        return Self::Generic;
                    }
                    matches
                        .into_iter()
                        .map(|hit| format!("{}:{}: {}", hit.path, hit.line, hit.text))
                        .collect::<Vec<_>>()
                } else if let Some(Files::Groups(files)) = result.files {
                    if files
                        .iter()
                        .any(|file| file.matches.iter().any(|hit| hit.line == 0))
                    {
                        return Self::Generic;
                    }
                    files
                        .into_iter()
                        .flat_map(|file| {
                            file.matches
                                .into_iter()
                                .map(move |hit| format!("{}:{}: {}", file.path, hit.line, hit.text))
                        })
                        .collect::<Vec<_>>()
                } else if let Some(Files::Paths(paths)) = result.files {
                    paths
                } else if let Some(paths) = result.paths {
                    paths
                } else {
                    return Self::Generic;
                };
                let mut text = entries.join("\n");
                if result.truncated {
                    text.push_str("\n…");
                    if let Some(total) = result.total {
                        text.push_str(&format!(" ({}/{total})", entries.len()));
                    }
                }
                Self::Search { text }
            }
            _ => Self::Generic,
        }
    }
    pub fn failed(&self) -> bool {
        matches!(self,Self::Terminal{exit_code:Some(code),..} if *code!=0)
    }
    pub fn specialized(&self) -> bool {
        !matches!(self, Self::Generic)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn result_models_preserve_evidence_and_unknown_shapes() {
        let input = json!({"command":"echo hi"});
        for (raw, failed, expected) in [
            (
                json!({"stdout":{"text":"hi\n"},"stderr":{"text":"err"},"exitCode":2}),
                true,
                "hi\nerr",
            ),
            (json!({"stdout":"hi","exit_code":0}), false, "hi"),
        ] {
            let body = ToolBody::derive(
                ActivityKind::Execute,
                Some(&input),
                Some(&raw),
                "",
                &[],
                &[],
            );
            assert_eq!(body.failed(), failed);
            let ToolBody::Terminal { output, .. } = body else {
                panic!()
            };
            assert_eq!(output, expected);
        }
        assert!(
            !ToolBody::derive(
                ActivityKind::Execute,
                Some(&input),
                Some(&json!({"unexpected":true})),
                "",
                &[],
                &[]
            )
            .specialized()
        );
        let read = ToolBody::derive(
            ActivityKind::Read,
            Some(&json!({"path":"notes.rs","offset":7})),
            Some(&json!({"lineCount":2})),
            "first\nsecond",
            &[],
            &[],
        );
        assert!(matches!(read,ToolBody::Read{start:7,ref text,..} if text=="first\nsecond"));
        let search = ToolBody::derive(
            ActivityKind::Search,
            None,
            Some(&json!({"paths":["a.rs","b.rs"],"total":3,"truncated":true})),
            "",
            &[],
            &[],
        );
        assert!(
            matches!(search,ToolBody::Search{ref text} if text.contains("a.rs\nb.rs") && text.contains("2/3"))
        );
        for (line, expected) in [(9, true), (0, false)] {
            let body = ToolBody::derive(
                ActivityKind::Search,
                None,
                Some(
                    &json!({"matches":[{"path":"a.rs","line":line,"text":"needle"}],"truncated":false,"scanned_files":2}),
                ),
                "",
                &[],
                &[],
            );
            assert_eq!(body.specialized(), expected);
            if expected {
                assert!(matches!(body,ToolBody::Search{ref text} if text=="a.rs:9: needle"));
            }
        }
        let body = ToolBody::derive(
            ActivityKind::Edit,
            None,
            None,
            "",
            &[json!({"type":"diff","path":"a.rs","oldText":"same\nold\n","newText":"same\nnew\n"})],
            &[],
        );
        let ToolBody::Diff { files } = body else {
            panic!()
        };
        assert_eq!((files[0].added, files[0].deleted), (1, 1));
        assert!(files[0].patch.contains(" same"));
    }
}
