//! Pure content analysis entry point, loaded inside a browser Worker.
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
    use pero_contracts::{
        content_document::{ContentDocument, ContentFormat, DocumentSource},
        content_origin::ContentOrigin,
    };
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
    .parse_preview()
    .map(|preview| preview.into_tape())
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
}
