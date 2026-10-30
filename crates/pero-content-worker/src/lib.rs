//! Pure content analysis entry point, loaded inside a browser Worker.
use pero_contracts::{
    content_document::{ContentDocument, ContentFormat, DocumentSource, StructuredPreview},
    content_origin::ContentOrigin,
    table_projection::{ProjectionSpec, SortDirection, TableProjection},
};
#[cfg(target_family = "wasm")]
#[wasm_bindgen::prelude::wasm_bindgen]
pub fn analyze_json(source: &str) -> Vec<u32> {
    pero_contracts::content_syntax::ContentSyntax::json(source).into_tape()
}

/// Values remain in the caller's source; only column names and spans cross back.
#[cfg_attr(target_family = "wasm", wasm_bindgen::prelude::wasm_bindgen)]
pub fn analyze_preview(
    source: String,
    json_lines: bool,
    revision: u64,
) -> Result<Vec<u32>, String> {
    analysis_document(source, json_lines, revision)
        .parse_preview()
        .map(|preview| preview.into_tape())
}

/// A nested projection keeps offsets relative to the complete original source.
#[cfg_attr(target_family = "wasm", wasm_bindgen::prelude::wasm_bindgen)]
pub fn analyze_node(
    source: String,
    start: usize,
    end: usize,
    revision: u64,
) -> Result<Vec<u32>, String> {
    source.get(start..end).ok_or("Invalid JSON source range")?;
    analysis_document(source, false, revision)
        .project(start..end)
        .map(|preview| preview.into_tape())
}

/// One table owns one background source; releasing the table drops this object.
#[cfg_attr(target_family = "wasm", wasm_bindgen::prelude::wasm_bindgen)]
pub struct ProjectionSource {
    document: ContentDocument,
    preview: StructuredPreview,
}
#[cfg_attr(target_family = "wasm", wasm_bindgen::prelude::wasm_bindgen)]
impl ProjectionSource {
    #[cfg_attr(
        target_family = "wasm",
        wasm_bindgen::prelude::wasm_bindgen(constructor)
    )]
    pub fn new(source: String, tape: &[u32]) -> Result<Self, String> {
        let preview = StructuredPreview::from_tape(tape)?;
        let revision = preview.rows.first().map_or(0, |row| row.source.revision);
        Ok(Self {
            document: analysis_document(source, false, revision),
            preview,
        })
    }
    pub fn project(
        &self,
        filter: String,
        column: i32,
        descending: bool,
    ) -> Result<Vec<u32>, String> {
        let sort = if column == -1 {
            None
        } else {
            let column = usize::try_from(column).map_err(|_| "Invalid sort column")?;
            if column >= self.preview.columns.len().max(1) {
                return Err("Invalid sort column".into());
            }
            Some((
                column,
                if descending {
                    SortDirection::Descending
                } else {
                    SortDirection::Ascending
                },
            ))
        };
        Ok(TableProjection::from_spec(
            ProjectionSpec { filter, sort },
            &self.document,
            &self.preview,
        )
        .rows
        .into_iter()
        .map(|row| row as u32)
        .collect())
    }
}

fn analysis_document(source: String, json_lines: bool, revision: u64) -> ContentDocument {
    ContentDocument::new(
        DocumentSource {
            id: "analysis".into(),
            title: String::new(),
            origin: ContentOrigin::Conversation {
                thread_id: String::new(),
            },
        },
        revision,
        source,
        if json_lines {
            ContentFormat::JsonLines
        } else {
            ContentFormat::Json
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use pero_contracts::content_document::{PREVIEW_BYTES, StructuredPreview};

    #[test]
    fn background_preview_retains_large_jsonl_sources_and_reports_parse_failures() {
        let source = "{\"n\":123456789012345678901234567890,\"label\":\"中\"}\n".repeat(100_000);
        assert!(source.len() > PREVIEW_BYTES);
        let revision = u64::MAX - 7;
        let tape = analyze_preview(source.clone(), true, revision).unwrap();
        let preview = StructuredPreview::from_tape(&tape).unwrap();
        assert_eq!(preview.rows.len(), 100_000);
        let last = preview.rows.last().unwrap();
        assert_eq!(last.line, 100_000);
        assert_eq!(last.source.revision, revision);
        assert_eq!(
            &source[last.cells[0].clone().unwrap()],
            "123456789012345678901234567890"
        );
        assert_eq!(&source[last.cells[1].clone().unwrap()], "\"中\"");
        for (source, json_lines) in [
            ("{", false),
            ("{\"n\":1,\"n\":2}", false),
            ("{}\n[1]", true),
        ] {
            assert!(analyze_preview(source.into(), json_lines, 1).is_err());
        }
    }

    #[test]
    fn nested_projection_retains_absolute_ranges_and_exact_values() {
        let nested = format!(
            "[{}]",
            "{\"number\":9007199254740993,\"label\":\"中\"},"
                .repeat(4000)
                .trim_end_matches(',')
        );
        let source = format!("{{\"前缀\":true,\"nested\":{nested},\"tail\":null}}");
        let start = source.find(&nested).unwrap();
        let end = start + nested.len();
        let tape = analyze_node(source.clone(), start, end, u64::MAX).unwrap();
        let preview = StructuredPreview::from_tape(&tape).unwrap();
        assert_eq!(preview.rows.len(), 4000);
        for row in &preview.rows {
            assert_eq!(row.source.revision, u64::MAX);
            assert!(row.source.bytes.start >= start && row.source.bytes.end <= end);
            assert_eq!(&source[row.cells[0].clone().unwrap()], "9007199254740993");
            assert_eq!(&source[row.cells[1].clone().unwrap()], "\"中\"");
        }
        for (start, end) in [
            (5, 3),
            (0, source.len() + 1),
            (source.find('前').unwrap() + 1, end),
        ] {
            assert!(analyze_node(source.clone(), start, end, 1).is_err());
        }
    }

    #[test]
    fn table_source_reuses_preview_for_exact_transforms_and_original_row_identity() {
        let source: String = (0..100_000)
            .map(|row| {
                format!(
                    "{{\"n\":900719925474099{row:06},\"group\":\"{}\"}}\n",
                    if row % 2 == 0 { "keep" } else { "skip" }
                )
            })
            .collect();
        let tape = analyze_preview(source.clone(), true, 9).unwrap();
        let started = std::time::Instant::now();
        let background = ProjectionSource::new(source, &tape).unwrap();
        let first = background.project("keep".into(), 0, true).unwrap();
        assert_eq!(first, (0..100_000).step_by(2).rev().collect::<Vec<_>>());
        let second = background.project("skip".into(), 0, false).unwrap();
        assert_eq!(second, (1..100_000).step_by(2).collect::<Vec<_>>());
        let reset = background.project(String::new(), -1, false).unwrap();
        assert_eq!(reset, (0..100_000).collect::<Vec<_>>());
        assert!(background.project(String::new(), 99, false).is_err());
        eprintln!(
            "100k rows: preview admission + 3 transforms {:?}",
            started.elapsed()
        );
    }
}
