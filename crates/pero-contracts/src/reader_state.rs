//! Durable reading state is independent of a renderer or an executing tool.
use serde::{Deserialize, Serialize};
use std::ops::Range;

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default, deny_unknown_fields)]
pub struct SearchOptions {
    pub case_insensitive: bool,
    pub regex: bool,
    pub whole_word: bool,
}
impl Default for SearchOptions {
    fn default() -> Self {
        Self {
            case_insensitive: true,
            regex: false,
            whole_word: false,
        }
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(default, deny_unknown_fields)]
pub struct ReaderState {
    pub source: bool,
    pub selection: Range<usize>,
    pub scroll: [f32; 2],
    pub preview_scroll: [f32; 2],
    pub query: String,
    pub search_open: bool,
    pub search: SearchOptions,
    pub folded_lines: Vec<usize>,
    pub path: Vec<Range<usize>>,
}
impl ReaderState {
    /// A changed source can shorten a restored selection. Keep every offset on
    /// its UTF-8 boundary and discard projection ranges that no longer exist.
    pub fn for_source(mut self, source: &str) -> Self {
        let boundary = |offset: usize| {
            let mut offset = offset.min(source.len());
            while !source.is_char_boundary(offset) {
                offset -= 1;
            }
            offset
        };
        self.selection =
            boundary(self.selection.start)..boundary(self.selection.end.max(self.selection.start));
        self.path.retain(|range| {
            range.start < range.end
                && range.end <= source.len()
                && source.is_char_boundary(range.start)
                && source.is_char_boundary(range.end)
        });
        self.folded_lines
            .retain(|&line| line < source.lines().count());
        self.folded_lines.sort_unstable();
        self.folded_lines.dedup();
        for offset in self.scroll.iter_mut().chain(self.preview_scroll.iter_mut()) {
            if !offset.is_finite() {
                *offset = 0.;
            }
        }
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn persisted_positions_follow_the_source_that_is_actually_restored() {
        let state = ReaderState {
            selection: 2..99,
            path: vec![0..3, 1..3, 0..99],
            folded_lines: vec![9, 0, 0],
            scroll: [f32::NAN, -30.],
            ..Default::default()
        }
        .for_source("中\ntext");
        assert_eq!(state.selection, 0..8);
        assert_eq!(state.path, vec![0..3]);
        assert_eq!(state.folded_lines, vec![0]);
        assert_eq!(state.scroll, [0., -30.]);
        assert!(
            serde_json::from_str::<ReaderState>("{}")
                .unwrap()
                .search
                .case_insensitive
        );
    }
}
