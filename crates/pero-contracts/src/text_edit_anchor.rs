//! Byte anchors follow actual ordered text mutations, without diffing whole buffers.
use crate::reader_state::ReaderState;
use serde::{Deserialize, Serialize};
use std::ops::Range;
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AnchorBias {
    Before,
    After,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TextEdit {
    pub old: Range<usize>,
    pub new_len: usize,
    /// Row-start anchors removed by the edit (a mid-line start begins at the next row).
    pub old_lines: Range<usize>,
    pub new_line_count: usize,
}
impl TextEdit {
    pub fn anchor(&self, offset: usize, bias: AnchorBias) -> usize {
        transform(offset, &self.old, self.new_len, bias)
    }
    pub fn range(&self, range: Range<usize>) -> Range<usize> {
        if range.is_empty() {
            let caret = self.anchor(range.start, AnchorBias::After);
            return caret..caret;
        }
        let start = self.anchor(range.start, AnchorBias::After);
        let end = self.anchor(range.end, AnchorBias::Before);
        start..end.max(start)
    }
    pub fn rebase(&self, state: &mut ReaderState) {
        state.selection = self.range(state.selection.clone());
        state.path = state
            .path
            .iter()
            .cloned()
            .map(|range| self.range(range))
            .filter(|range| !range.is_empty())
            .collect();
        state.preview_reveal = state.preview_reveal.take().map(|range| self.range(range));
        state.folded_lines = state
            .folded_lines
            .iter()
            .filter(|line| !self.old_lines.contains(line))
            .map(|line| {
                transform(
                    *line,
                    &self.old_lines,
                    self.new_line_count,
                    AnchorBias::After,
                )
            })
            .collect();
        state.folded_lines.sort_unstable();
        state.folded_lines.dedup();
        // Pixel scroll positions are not text anchors. The renderer reveals the transformed selection on navigation.
    }
}
fn transform(offset: usize, old: &Range<usize>, new_len: usize, bias: AnchorBias) -> usize {
    if offset < old.start {
        return offset;
    }
    if offset > old.end || offset == old.end && !old.is_empty() {
        return offset
            .saturating_sub(old.end - old.start)
            .saturating_add(new_len);
    }
    old.start
        + if bias == AnchorBias::After {
            new_len
        } else {
            0
        }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn anchors_follow_ordered_insertions_replacements_deletions_and_utf8_byte_edits() {
        for (old, new_len, position, before, after) in [
            (2..2, 3, 2, 2, 5),
            (2..5, 6, 1, 1, 1),
            (2..5, 6, 3, 2, 8),
            (2..5, 6, 5, 8, 8),
            (2..5, 0, 8, 5, 5),
        ] {
            let edit = TextEdit {
                old,
                new_len,
                old_lines: 0..0,
                new_line_count: 0,
            };
            assert_eq!(edit.anchor(position, AnchorBias::Before), before);
            assert_eq!(edit.anchor(position, AnchorBias::After), after);
        }
        let mut state = ReaderState {
            selection: 3..9,
            path: vec![0..12],
            folded_lines: vec![2, 9],
            ..Default::default()
        };
        TextEdit {
            old: 0..0,
            new_len: "中文\n".len(),
            old_lines: 0..0,
            new_line_count: 1,
        }
        .rebase(&mut state);
        assert_eq!(state.selection, 10..16);
        assert_eq!(state.folded_lines, vec![3, 10]);
        TextEdit {
            old: 0..10,
            new_len: 0,
            old_lines: 0..1,
            new_line_count: 0,
        }
        .rebase(&mut state);
        assert_eq!(state.selection, 0..6);
    }
}
