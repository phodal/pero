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
    pub source_revision: Option<u64>,
    pub source: bool,
    pub selection: Range<usize>,
    pub scroll: [f32; 2],
    pub preview_scroll: [f32; 2],
    pub preview_reveal: Option<Range<usize>>,
    pub query: String,
    pub search_open: bool,
    pub search: SearchOptions,
    pub folded_lines: Vec<usize>,
    pub path: Vec<Range<usize>>,
}
impl ReaderState {
    /// Range geometry belongs to the immutable source revision it came from.
    /// Legacy saved reading state is already bound by its document header.
    pub fn for_revision(self, revision: u64) -> Self {
        let mut state = if self.source_revision.is_some_and(|saved| saved != revision) {
            self.without_location()
        } else {
            self
        };
        state.source_revision = Some(revision);
        state
    }
    pub fn without_location(mut self) -> Self {
        self.selection = 0..0;
        self.scroll = [0.; 2];
        self.preview_scroll = [0.; 2];
        self.preview_reveal = None;
        self.folded_lines.clear();
        self.path.clear();
        self
    }
    pub fn same_location(&self, other: &Self) -> bool {
        self.selection == other.selection
            && self.scroll == other.scroll
            && self.preview_scroll == other.preview_scroll
            && self.path == other.path
            && self.preview_reveal == other.preview_reveal
    }
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
        self.preview_reveal = self.preview_reveal.filter(|range| {
            range.start < range.end
                && range.end <= source.len()
                && source.is_char_boundary(range.start)
                && source.is_char_boundary(range.end)
        });
        let line_count = source.lines().count();
        self.folded_lines.retain(|&line| line < line_count);
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
        for (saved, current, compatible) in
            [(None, 3, true), (Some(3), 3, true), (Some(3), 4, false)]
        {
            let original = ReaderState {
                source_revision: saved,
                source: true,
                selection: 4..9,
                scroll: [0., -80.],
                preview_scroll: [0., -120.],
                preview_reveal: Some(4..9),
                path: vec![0..9],
                folded_lines: vec![1],
                query: "retain search".into(),
                search_open: true,
                ..Default::default()
            };
            let restored = original.clone().for_revision(current);
            assert_eq!(restored.source_revision, Some(current));
            assert_eq!(restored.query, original.query);
            assert_eq!(restored.search_open, original.search_open);
            assert_eq!(restored.source, original.source);
            if compatible {
                assert!(restored.same_location(&original));
            } else {
                assert_eq!(restored.selection, 0..0);
                assert_eq!(restored.scroll, [0.; 2]);
                assert_eq!(restored.preview_scroll, [0.; 2]);
                assert!(restored.preview_reveal.is_none());
                assert!(restored.path.is_empty());
                assert!(restored.folded_lines.is_empty());
            }
        }
    }
}
