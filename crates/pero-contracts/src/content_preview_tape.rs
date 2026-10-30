//! Transfer source-backed preview metadata without serializing source values.
use crate::content_document::{PreviewRow, PreviewShape, SourceRange, StructuredPreview};
use std::ops::Range;

const MAGIC: u32 = 0x50525631; // PRV1

impl StructuredPreview {
    /// Column names are packed UTF-8; rows and cells contain source offsets only.
    pub fn into_tape(self) -> Vec<u32> {
        self.to_tape()
    }

    pub fn to_tape(&self) -> Vec<u32> {
        let count = |n| u32::try_from(n).expect("preview metadata fits a transferable array");
        let mut tape = vec![
            MAGIC,
            match self.shape {
                PreviewShape::Properties => 0,
                PreviewShape::Records => 1,
                PreviewShape::Values => 2,
            },
            count(self.columns.len()),
            count(self.rows.len()),
        ];
        for column in &self.columns {
            tape.push(count(column.len()));
            for bytes in column.as_bytes().chunks(4) {
                let mut word = [0; 4];
                word[..bytes.len()].copy_from_slice(bytes);
                tape.push(u32::from_le_bytes(word));
            }
        }
        for row in &self.rows {
            push_u64(&mut tape, row.line as u64);
            push_u64(&mut tape, row.source.revision);
            push_range(&mut tape, row.source.bytes.clone());
            tape.push(count(row.cells.len()));
            for cell in &row.cells {
                if let Some(cell) = cell {
                    push_range(&mut tape, cell.clone());
                } else {
                    tape.extend([u32::MAX; 4]);
                }
            }
        }
        tape
    }

    /// Decode once at the Worker boundary; malformed metadata never reaches a view.
    pub fn from_tape(tape: &[u32]) -> Result<Self, String> {
        let mut input = PreviewTape(tape);
        if input.word()? != MAGIC {
            return Err("Unsupported preview tape".into());
        }
        let shape = match input.word()? {
            0 => PreviewShape::Properties,
            1 => PreviewShape::Records,
            2 => PreviewShape::Values,
            _ => return Err("Invalid preview shape".into()),
        };
        let column_count = input.word()? as usize;
        let row_count = input.word()? as usize;
        let mut columns = Vec::new();
        for _ in 0..column_count {
            let length = input.word()? as usize;
            let words = input.take(length.div_ceil(4))?;
            let bytes = words
                .iter()
                .flat_map(|word| word.to_le_bytes())
                .take(length)
                .collect();
            columns.push(String::from_utf8(bytes).map_err(|_| "Invalid preview column UTF-8")?);
        }
        let mut rows = Vec::new();
        for _ in 0..row_count {
            let line = input.offset()?;
            let revision = input.number()?;
            let source = input.range()?;
            let cell_count = input.word()? as usize;
            let mut cells = Vec::new();
            for _ in 0..cell_count {
                let start = input.number()?;
                let end = input.number()?;
                cells.push(if start == u64::MAX && end == u64::MAX {
                    None
                } else {
                    Some(PreviewTape::checked_range(start, end)?)
                });
            }
            rows.push(PreviewRow {
                line,
                source: SourceRange {
                    revision,
                    bytes: source,
                },
                cells,
            });
        }
        if !input.0.is_empty() {
            return Err("Trailing preview metadata".into());
        }
        Ok(Self {
            shape,
            columns,
            rows,
        })
    }
}

fn push_u64(tape: &mut Vec<u32>, value: u64) {
    tape.extend([value as u32, (value >> 32) as u32]);
}
fn push_range(tape: &mut Vec<u32>, range: Range<usize>) {
    push_u64(tape, range.start as u64);
    push_u64(tape, range.end as u64);
}
struct PreviewTape<'a>(&'a [u32]);
impl<'a> PreviewTape<'a> {
    fn take(&mut self, count: usize) -> Result<&'a [u32], String> {
        let (value, rest) = self
            .0
            .split_at_checked(count)
            .ok_or("Truncated preview metadata")?;
        self.0 = rest;
        Ok(value)
    }
    fn word(&mut self) -> Result<u32, String> {
        Ok(self.take(1)?[0])
    }
    fn number(&mut self) -> Result<u64, String> {
        let words = self.take(2)?;
        Ok(u64::from(words[0]) | (u64::from(words[1]) << 32))
    }
    fn offset(&mut self) -> Result<usize, String> {
        usize::try_from(self.number()?).map_err(|_| "Preview offset exceeds platform limit".into())
    }
    fn range(&mut self) -> Result<Range<usize>, String> {
        let start = self.number()?;
        let end = self.number()?;
        Self::checked_range(start, end)
    }
    fn checked_range(start: u64, end: u64) -> Result<Range<usize>, String> {
        if start > end {
            return Err("Reversed preview range".into());
        }
        Ok(
            usize::try_from(start).map_err(|_| "Preview offset exceeds platform limit")?
                ..usize::try_from(end).map_err(|_| "Preview offset exceeds platform limit")?,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        content_document::{ContentDocument, ContentFormat, DocumentSource},
        content_origin::ContentOrigin,
    };

    #[test]
    fn preview_transport_preserves_utf8_exact_values_missing_cells_and_physical_lines() {
        for (format, source) in [
            (
                ContentFormat::Json,
                "{\"列😀\": 123456789012345678901234567890, \"v\":\"中\\n文\"}",
            ),
            (ContentFormat::Json, "[false, null, 1.2300, \"null\"]"),
            (
                ContentFormat::JsonLines,
                "\n{\"中\":1,\"n\":null}\n\n{\"next\":-123.4500e99}\n",
            ),
        ] {
            let document = ContentDocument::new(
                DocumentSource {
                    id: "worker".into(),
                    title: "Result".into(),
                    origin: ContentOrigin::Conversation {
                        thread_id: "thread".into(),
                    },
                },
                u64::MAX - 1,
                source.into(),
                format,
            );
            let preview = document.preview().unwrap();
            let tape = preview.clone().into_tape();
            let decoded = StructuredPreview::from_tape(&tape).unwrap();
            assert_eq!(decoded, preview);
            for row in decoded.rows {
                for range in row.cells.into_iter().flatten() {
                    assert!(source.get(range).is_some());
                }
            }
            assert!(document.cached_preview().is_none());
            let shared = document.share_preview(Ok(preview)).unwrap();
            assert!(std::sync::Arc::ptr_eq(
                &shared,
                &document.shared_preview().unwrap()
            ));
        }
    }

    #[test]
    fn incomplete_or_unknown_tape_is_rejected_at_admission() {
        for tape in [
            vec![],
            vec![0],
            vec![MAGIC, 3, 0, 0],
            vec![MAGIC, 0, 1, 0, 5, 0],
            vec![MAGIC, 0, 0, 0, 9],
        ] {
            assert!(StructuredPreview::from_tape(&tape).is_err());
        }
    }
}
