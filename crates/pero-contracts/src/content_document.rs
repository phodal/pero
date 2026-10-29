//! Immutable source and source-backed projections. Display never owns the data.
use serde::{
    Deserialize, Serialize,
    de::{MapAccess, Visitor},
};
use serde_json::value::RawValue;
use std::{
    collections::{HashMap, HashSet},
    fmt,
    ops::Range,
    sync::Arc,
};

/// Bound the first synchronous preview on the Wasm UI thread. The complete
/// source remains available in the editor; no bytes are silently removed.
pub const PREVIEW_BYTES: usize = 2 * 1024 * 1024;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub enum ContentFormat {
    Json,
    JsonLines,
    Code(String),
    Text,
}

#[derive(Clone, Debug, Serialize)]
pub struct ContentDocument {
    pub id: String,
    pub revision: u64,
    pub format: ContentFormat,
    pub bytes: usize,
    #[serde(skip)]
    source: Arc<str>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SourceRange {
    pub revision: u64,
    pub bytes: Range<usize>,
}

#[derive(Clone, Debug)]
pub struct PreviewRow {
    pub line: usize,
    pub source: SourceRange,
    pub cells: Vec<Option<Range<usize>>>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PreviewShape {
    Properties,
    Records,
    Values,
}

#[derive(Clone, Debug)]
pub struct StructuredPreview {
    pub shape: PreviewShape,
    pub columns: Vec<String>,
    pub rows: Vec<PreviewRow>,
}

/// Keeping values borrowed preserves their exact number spelling and spans.
struct Object<'a>(Vec<(String, &'a RawValue)>);
impl<'de> Deserialize<'de> for Object<'de> {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        struct Fields;
        impl<'de> Visitor<'de> for Fields {
            type Value = Object<'de>;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("a JSON object")
            }
            fn visit_map<M: MapAccess<'de>>(self, mut map: M) -> Result<Self::Value, M::Error> {
                let mut fields = Vec::new();
                let mut keys = HashSet::new();
                while let Some((key, value)) = map.next_entry::<String, &'de RawValue>()? {
                    if !keys.insert(key.clone()) {
                        return Err(serde::de::Error::custom(format!("duplicate key: {key}")));
                    }
                    fields.push((key, value));
                }
                Ok(Object(fields))
            }
        }
        d.deserialize_map(Fields)
    }
}

impl ContentDocument {
    pub fn new(id: String, revision: u64, source: String, format: ContentFormat) -> Self {
        Self {
            id,
            revision,
            bytes: source.len(),
            source: source.into(),
            format,
        }
    }

    /// Called once when a tool source changes, never from rendering.
    pub fn from_tool(id: String, revision: u64, text: &str) -> Option<Self> {
        let trimmed = text.trim();
        let (source, format) = if let Some(fenced) = trimmed.strip_prefix("```") {
            let (language, body) = fenced.split_once('\n')?;
            let body = body.strip_suffix("```")?.trim_end_matches('\n');
            let format = match language.trim().to_ascii_lowercase().as_str() {
                "json" => ContentFormat::Json,
                "jsonl" | "ndjson" => ContentFormat::JsonLines,
                language => ContentFormat::Code(language.into()),
            };
            (body, format)
        } else if trimmed.starts_with(['{', '[']) {
            // A format hint, not a claim that a streaming document is valid JSON.
            (text, ContentFormat::Json)
        } else if text.len() >= 2048 {
            (text, ContentFormat::Text)
        } else {
            return None;
        };
        Some(Self::new(id, revision, source.into(), format))
    }

    pub fn source(&self) -> &str {
        &self.source
    }

    pub fn text(&self, range: &Range<usize>) -> &str {
        &self.source[range.clone()]
    }

    pub fn language(&self) -> &str {
        match &self.format {
            ContentFormat::Json | ContentFormat::JsonLines => "json",
            ContentFormat::Code(language) => language,
            ContentFormat::Text => "plaintext",
        }
    }

    pub fn preview(&self) -> Result<StructuredPreview, String> {
        if self.bytes > PREVIEW_BYTES {
            return Err(format!(
                "Preview limit: {} MiB. Open source to read the complete {} bytes.",
                PREVIEW_BYTES / 1024 / 1024,
                self.bytes
            ));
        }
        let range = 0..self.source.len();
        match self.format {
            ContentFormat::Json => self.project(range),
            ContentFormat::JsonLines => {
                let mut records = Vec::new();
                let mut offset = 0;
                for (line, text) in self.source.split_inclusive('\n').enumerate() {
                    if !text.trim().is_empty() {
                        let object: Object = serde_json::from_str(text)
                            .map_err(|e| format!("Line {}: {e}", line + 1))?;
                        records.push((line + 1, offset..offset + text.len(), object));
                    }
                    offset += text.len();
                }
                self.records(records)
            }
            _ => Err("Source view".into()),
        }
    }

    pub fn project(&self, range: Range<usize>) -> Result<StructuredPreview, String> {
        let text = self.text(&range).trim();
        let raw: &RawValue = serde_json::from_str(text).map_err(|e| e.to_string())?;
        if raw.get().starts_with('{') {
            let Object(fields) = serde_json::from_str(raw.get()).map_err(|e| e.to_string())?;
            // Property names are column metadata; value cells always point to source.
            let rows = fields
                .into_iter()
                .enumerate()
                .map(|(i, (name, value))| {
                    let span = self.span(value);
                    (
                        name,
                        PreviewRow {
                            line: i + 1,
                            source: SourceRange {
                                revision: self.revision,
                                bytes: span.clone(),
                            },
                            cells: vec![Some(span)],
                        },
                    )
                })
                .collect::<Vec<_>>();
            Ok(StructuredPreview {
                shape: PreviewShape::Properties,
                columns: rows.iter().map(|(name, _)| name.clone()).collect(),
                rows: rows.into_iter().map(|(_, row)| row).collect(),
            })
        } else if raw.get().starts_with('[') {
            let values: Vec<&RawValue> =
                serde_json::from_str(raw.get()).map_err(|e| e.to_string())?;
            if values.iter().all(|v| v.get().starts_with('{')) {
                let records = values
                    .into_iter()
                    .enumerate()
                    .map(|(i, value)| {
                        let object =
                            serde_json::from_str(value.get()).map_err(|e| e.to_string())?;
                        Ok((i + 1, self.span(value), object))
                    })
                    .collect::<Result<Vec<_>, String>>()?;
                self.records(records)
            } else {
                Ok(StructuredPreview {
                    shape: PreviewShape::Values,
                    columns: vec![],
                    rows: values
                        .into_iter()
                        .enumerate()
                        .map(|(i, value)| {
                            let span = self.span(value);
                            PreviewRow {
                                line: i + 1,
                                source: SourceRange {
                                    revision: self.revision,
                                    bytes: span.clone(),
                                },
                                cells: vec![Some(span)],
                            }
                        })
                        .collect(),
                })
            }
        } else {
            let span = self.span(raw);
            Ok(StructuredPreview {
                shape: PreviewShape::Values,
                columns: vec![],
                rows: vec![PreviewRow {
                    line: 1,
                    source: SourceRange {
                        revision: self.revision,
                        bytes: span.clone(),
                    },
                    cells: vec![Some(span)],
                }],
            })
        }
    }

    fn span(&self, value: &RawValue) -> Range<usize> {
        let start = value.get().as_ptr() as usize - self.source.as_ptr() as usize;
        start..start + value.get().len()
    }

    fn records(
        &self,
        records: Vec<(usize, Range<usize>, Object<'_>)>,
    ) -> Result<StructuredPreview, String> {
        let mut columns = Vec::new();
        let mut indices = HashMap::new();
        let mut rows = Vec::with_capacity(records.len());
        for (line, source, Object(fields)) in records {
            let mut cells = vec![None; columns.len()];
            for (name, value) in fields {
                let index = *indices.entry(name.clone()).or_insert_with(|| {
                    let index = columns.len();
                    columns.push(name);
                    index
                });
                if columns.len() > 128 {
                    return Err("Preview limit: 128 columns. Open source for all fields.".into());
                }
                cells.resize(columns.len(), None);
                cells[index] = Some(self.span(value));
            }
            rows.push(PreviewRow {
                line,
                source: SourceRange {
                    revision: self.revision,
                    bytes: source,
                },
                cells,
            });
        }
        Ok(StructuredPreview {
            shape: PreviewShape::Records,
            columns,
            rows,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn source_projections_preserve_values_positions_and_failures() {
        for (source, format, columns, expected) in [
            (
                "[{\"n\":9007199254740993,\"v\":null},{\"v\":\"null\",\"x\":\"\"}]",
                ContentFormat::Json,
                vec!["n", "v", "x"],
                vec![Some("9007199254740993"), Some("null"), None],
            ),
            (
                "\n{\"x\":\"a\\\"b\"}\n\n{\"z\":1.0000000000000000001}\n",
                ContentFormat::JsonLines,
                vec!["x", "z"],
                vec![Some("\"a\\\"b\""), None],
            ),
        ] {
            let doc = ContentDocument::new("test".into(), 7, source.into(), format);
            let preview = doc.preview().unwrap();
            assert_eq!(preview.columns, columns);
            assert_eq!(
                expected,
                (0..preview.columns.len())
                    .map(|i| preview.rows[0]
                        .cells
                        .get(i)
                        .and_then(Option::as_ref)
                        .map(|r| doc.text(r)))
                    .collect::<Vec<_>>()
            );
            assert_eq!(doc.source(), source);
            for row in preview.rows {
                assert_eq!(row.source.revision, 7);
                assert!(doc.source().is_char_boundary(row.source.bytes.start));
            }
        }
        for source in [
            "{\"x\":1,\"x\":2}",
            "{\"unfinished\":",
            "[1,]",
            "{\"a\":NaN}",
        ] {
            assert!(
                ContentDocument::new("bad".into(), 1, source.into(), ContentFormat::Json)
                    .preview()
                    .is_err()
            );
        }
        let doc = ContentDocument::new(
            "limit".into(),
            1,
            " ".repeat(PREVIEW_BYTES + 1),
            ContentFormat::Json,
        );
        assert!(doc.preview().unwrap_err().contains("Preview limit"));
        assert_eq!(doc.source().len(), PREVIEW_BYTES + 1);
    }
}
