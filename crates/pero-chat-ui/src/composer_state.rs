//! Completion queries use UTF-8 source ranges; the input owns token editing/history.
use pero_contracts::context::{ContextCandidate, ContextKind, ContextReference};
use std::ops::Range;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CompletionKind {
    Mention(Option<ContextKind>),
    Slash,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CompletionQuery {
    pub range: Range<usize>,
    pub kind: CompletionKind,
    pub query: String,
}

impl CompletionQuery {
    pub fn at(text: &str, cursor: usize) -> Option<Self> {
        let prefix = text.get(..cursor)?;
        let line_start = prefix.rfind('\n').map_or(0, |i| i + 1);
        let line = &prefix[line_start..];
        if let Some(query) = line.strip_prefix('/') {
            if !query.chars().any(char::is_whitespace) {
                return Some(Self {
                    range: line_start..cursor,
                    kind: CompletionKind::Slash,
                    query: query.into(),
                });
            }
        }
        let start = prefix.rfind('@')?;
        if start > 0 && !prefix[..start].ends_with(char::is_whitespace) {
            return None;
        }
        let mention = &prefix[start + 1..];
        if mention.contains('\n') {
            return None;
        }
        let (source, query) = mention.split_once(' ').unwrap_or((mention, ""));
        let kind = ContextKind::from_keyword(source);
        Some(Self {
            range: start..cursor,
            kind: CompletionKind::Mention(kind),
            query: if kind.is_some() {
                query.into()
            } else {
                mention.into()
            },
        })
    }
}

#[derive(Clone)]
pub enum ComposerChoice {
    Source(ContextKind),
    Context(ContextCandidate),
    Command { name: String, description: String },
}

#[derive(Default)]
pub struct ComposerState {
    pub open: bool,
    pub loading: bool,
    pub error: Option<String>,
    pub selected: usize,
    pub title: String,
    pub query: String,
    pub completion: Option<CompletionQuery>,
    pub choices: Vec<ComposerChoice>,
    pub request: Option<String>,
    pub resolve_range: Option<Range<usize>>,
    pub dismissed: Option<CompletionQuery>,
    pub resolved: Option<ContextReference>,
    pub references: std::collections::HashMap<String, ContextReference>,
    pub pending_files: Vec<ContextReference>,
    pub paste_requests: std::collections::HashSet<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn completion_queries_respect_cursor_and_boundaries() {
        for (text, cursor, expected) in [
            (
                "你好 @file src",
                16,
                Some((CompletionKind::Mention(Some(ContextKind::File)), "src", 7)),
            ),
            ("hello@world", 11, None),
            ("/", 1, Some((CompletionKind::Slash, "", 0))),
            ("/compact", 8, Some((CompletionKind::Slash, "compact", 0))),
            ("/compact now", 12, None),
            ("hello /skill", 12, None),
            (
                "hi @sym",
                7,
                Some((CompletionKind::Mention(None), "sym", 3)),
            ),
            ("@file a\nnext", 12, None),
        ] {
            let actual = CompletionQuery::at(text, cursor);
            assert_eq!(
                actual
                    .as_ref()
                    .map(|q| (q.kind.clone(), q.query.as_str(), q.range.start)),
                expected,
                "{text}"
            );
            if let Some(query) = actual {
                assert_eq!(query.range.end, cursor);
            }
        }
    }
}
