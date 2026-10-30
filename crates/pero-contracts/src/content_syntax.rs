//! Linear JSON/JSONL lexical indexes. Offsets always address the original UTF-8 text.
use std::ops::Range;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum SyntaxKind {
    String = 1,
    Property = 2,
    Number = 3,
    Boolean = 4,
    Null = 5,
}
impl SyntaxKind {
    pub fn name(self) -> &'static str {
        match self {
            Self::String => "string",
            Self::Property => "property",
            Self::Number => "number",
            Self::Boolean => "boolean",
            Self::Null => "constant",
        }
    }
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SyntaxToken {
    pub bytes: Range<usize>,
    pub kind: SyntaxKind,
}
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ContentSyntax {
    pub tokens: Vec<SyntaxToken>,
    pub folds: Vec<(usize, usize)>,
}
impl ContentSyntax {
    /// Lexing remains useful while a user is editing an incomplete document;
    /// validation and error reporting belong to the document's JSON projection.
    pub fn json(source: &str) -> Self {
        let bytes = source.as_bytes();
        let mut index = 0;
        let mut line = 0;
        let mut stack = Vec::new();
        let mut syntax = Self::default();
        while index < bytes.len() {
            let start = index;
            let kind = match bytes[index] {
                b'\n' => {
                    line += 1;
                    index += 1;
                    continue;
                }
                b'"' => {
                    index += 1;
                    while index < bytes.len() {
                        match bytes[index] {
                            b'\\' => {
                                index = (index + 2).min(bytes.len());
                            }
                            b'"' => {
                                index += 1;
                                break;
                            }
                            b'\n' => {
                                line += 1;
                                index += 1;
                            }
                            _ => index += 1,
                        }
                    }
                    let after = bytes[index..]
                        .iter()
                        .find(|byte| !byte.is_ascii_whitespace());
                    if after == Some(&b':') {
                        SyntaxKind::Property
                    } else {
                        SyntaxKind::String
                    }
                }
                b'-' | b'0'..=b'9' => {
                    index += 1;
                    while index < bytes.len()
                        && matches!(bytes[index], b'0'..=b'9' | b'.' | b'e' | b'E' | b'+' | b'-')
                    {
                        index += 1;
                    }
                    SyntaxKind::Number
                }
                b't' if bytes[index..].starts_with(b"true") => {
                    index += 4;
                    SyntaxKind::Boolean
                }
                b'f' if bytes[index..].starts_with(b"false") => {
                    index += 5;
                    SyntaxKind::Boolean
                }
                b'n' if bytes[index..].starts_with(b"null") => {
                    index += 4;
                    SyntaxKind::Null
                }
                b'{' | b'[' => {
                    stack.push((bytes[index], line));
                    index += 1;
                    continue;
                }
                b'}' | b']' => {
                    let opening = if bytes[index] == b'}' { b'{' } else { b'[' };
                    if stack.last().is_some_and(|&(kind, _)| kind == opening) {
                        let (_, start) = stack.pop().unwrap();
                        if line > start {
                            syntax.folds.push((start, line));
                        }
                    }
                    index += 1;
                    continue;
                }
                _ => {
                    index += 1;
                    continue;
                }
            };
            syntax.tokens.push(SyntaxToken {
                bytes: start..index,
                kind,
            });
        }
        // One fold marker per source line; the outermost matching container wins.
        syntax
            .folds
            .sort_by_key(|&(start, end)| (start, std::cmp::Reverse(end)));
        syntax.folds.dedup_by_key(|range| range.0);
        syntax
    }
    /// Compact worker exchange, avoiding a second JSON object graph per token.
    pub fn into_tape(self) -> Vec<u32> {
        let mut tape = Vec::with_capacity(2 + self.tokens.len() * 3 + self.folds.len() * 2);
        tape.extend([self.tokens.len() as u32, self.folds.len() as u32]);
        for token in self.tokens {
            tape.extend([
                token.bytes.start as u32,
                token.bytes.end as u32,
                token.kind as u32,
            ]);
        }
        for (start, end) in self.folds {
            tape.extend([start as u32, end as u32]);
        }
        tape
    }
    pub fn from_tape(tape: &[u32]) -> Result<Self, String> {
        let Some((&tokens, rest)) = tape.split_first() else {
            return Err("Missing syntax tape header".into());
        };
        let Some((&folds, rest)) = rest.split_first() else {
            return Err("Missing syntax tape header".into());
        };
        let token_len = tokens as usize * 3;
        if rest.len() != token_len + folds as usize * 2 {
            return Err("Incomplete syntax tape".into());
        }
        let mut syntax = Self::default();
        for token in rest[..token_len].chunks_exact(3) {
            let kind = match token[2] {
                1 => SyntaxKind::String,
                2 => SyntaxKind::Property,
                3 => SyntaxKind::Number,
                4 => SyntaxKind::Boolean,
                5 => SyntaxKind::Null,
                _ => return Err("Unknown syntax token".into()),
            };
            if token[0] > token[1] {
                return Err("Invalid syntax span".into());
            }
            syntax.tokens.push(SyntaxToken {
                bytes: token[0] as usize..token[1] as usize,
                kind,
            });
        }
        for range in rest[token_len..].chunks_exact(2) {
            if range[0] > range[1] {
                return Err("Invalid fold span".into());
            }
            syntax.folds.push((range[0] as usize, range[1] as usize));
        }
        Ok(syntax)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn syntax_keeps_original_spans_and_only_folds_containers_outside_strings() {
        for (source, folds) in [
            (
                "[\n {\"v\": [\n true, null, -1.02e+3\n ]}\n]",
                vec![(0, 4), (1, 3)],
            ),
            (
                "{\n \"中文😀\": \"{[\\\"never fold\\\"]}\",\n \"n\":9007199254740993\n}",
                vec![(0, 3)],
            ),
            ("{\"incomplete\": [\n \"unterminated", vec![]),
            ("{\"n\":1}\n{\"n\":2}\n", vec![]),
            ("[\n1\n]", vec![(0, 2)]),
        ] {
            let syntax = ContentSyntax::json(source);
            assert_eq!(syntax.folds, folds, "{source}");
            for token in &syntax.tokens {
                assert!(source.get(token.bytes.clone()).is_some());
            }
            assert_eq!(
                ContentSyntax::from_tape(&syntax.clone().into_tape()).unwrap(),
                syntax
            );
        }
        let source = "{\"中文😀\":9007199254740993,\"escaped\":\"a\\\"b\"}";
        let syntax = ContentSyntax::json(source);
        assert_eq!(
            syntax
                .tokens
                .iter()
                .map(|token| (token.kind, &source[token.bytes.clone()]))
                .collect::<Vec<_>>(),
            vec![
                (SyntaxKind::Property, "\"中文😀\""),
                (SyntaxKind::Number, "9007199254740993"),
                (SyntaxKind::Property, "\"escaped\""),
                (SyntaxKind::String, "\"a\\\"b\"")
            ]
        );
    }
}
