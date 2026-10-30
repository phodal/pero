//! Search produces UTF-8 source ranges; the editor retains painting and navigation.
use crate::reader_state::SearchOptions;
use regex::{Regex, RegexBuilder};
use std::{ops::Range, sync::OnceLock};

pub struct ContentSearch {
    expression: Option<Regex>,
    whole_word: bool,
}
impl ContentSearch {
    pub fn compile(query: &str, options: SearchOptions) -> Result<Self, String> {
        let expression = if query.is_empty() {
            None
        } else {
            let pattern = if options.regex {
                query.to_owned()
            } else {
                regex::escape(query)
            };
            Some(
                RegexBuilder::new(&pattern)
                    .multi_line(true)
                    .case_insensitive(options.case_insensitive)
                    .build()
                    .map_err(|error| {
                        error
                            .to_string()
                            .lines()
                            .last()
                            .unwrap_or("Invalid regular expression")
                            .to_owned()
                    })?,
            )
        };
        Ok(Self {
            expression,
            whole_word: options.whole_word,
        })
    }
    pub fn matches(&self, source: &str) -> Vec<Range<usize>> {
        let Some(expression) = &self.expression else {
            return vec![];
        };
        expression
            .find_iter(source)
            .filter(|found| {
                !self.whole_word || {
                    let before = source[..found.start()].chars().next_back();
                    let after = source[found.end()..].chars().next();
                    !before.is_some_and(word_character) && !after.is_some_and(word_character)
                }
            })
            .map(|found| found.range())
            .collect()
    }
}
fn word_character(character: char) -> bool {
    static WORD: OnceLock<Regex> = OnceLock::new();
    let mut bytes = [0; 4];
    WORD.get_or_init(|| Regex::new(r"\w").unwrap())
        .is_match(character.encode_utf8(&mut bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn literal_regex_word_boundaries_and_unicode_keep_exact_source_offsets() {
        for (text, query, regex, whole_word, case_insensitive, expected) in [
            ("a.b aXb", "a.b", false, false, false, vec![0..3]),
            (
                "row 10\nrow 20",
                "row \\d+",
                true,
                false,
                false,
                vec![0..6, 7..13],
            ),
            (
                "foo foobar _foo foo",
                "foo",
                false,
                true,
                false,
                vec![0..3, 16..19],
            ),
            (
                "中 Café CAFÉ cafe\u{301}",
                "café",
                false,
                true,
                true,
                vec![4..9, 10..15],
            ),
            ("cafe\u{301} cafe", "cafe", false, true, false, vec![7..11]),
            ("one\ntwo", "^", true, false, false, vec![0..0, 4..4]),
        ] {
            let search = ContentSearch::compile(
                query,
                SearchOptions {
                    regex,
                    whole_word,
                    case_insensitive,
                },
            )
            .unwrap();
            assert_eq!(search.matches(text), expected, "{query} in {text}");
        }
        assert!(
            ContentSearch::compile(
                "[",
                SearchOptions {
                    regex: true,
                    ..Default::default()
                }
            )
            .is_err()
        );
        assert!(
            ContentSearch::compile("", Default::default())
                .unwrap()
                .matches("anything")
                .is_empty()
        );
    }
}
