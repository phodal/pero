//! Immutable source and source-backed projections. Display never owns the data.
use crate::content_origin::ContentOrigin;
use serde::{
    Deserialize, Serialize,
    de::{MapAccess, Visitor},
};
use serde_json::value::RawValue;
use std::{
    collections::{HashMap, HashSet},
    fmt,
    ops::Range,
    sync::{Arc, Mutex, OnceLock},
};

/// Bound the first synchronous preview on the Wasm UI thread. The complete
/// source remains available in the editor; no bytes are silently removed.
pub const PREVIEW_BYTES: usize = 2 * 1024 * 1024;

#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(tag = "kind", content = "language", rename_all = "snake_case")]
pub enum ContentFormat {
    Json,
    JsonLines,
    Code(String),
    Text,
    Markdown,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DocumentSource {
    pub id: String,
    pub title: String,
    pub origin: ContentOrigin,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DocumentHeader {
    pub source: DocumentSource,
    pub revision: u64,
    pub format: ContentFormat,
}
impl DocumentHeader {
    pub fn into_document(self, text: String) -> ContentDocument {
        ContentDocument::new(self.source, self.revision, text, self.format)
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct ContentDocument {
    #[serde(flatten)]
    reference: DocumentSource,
    pub revision: u64,
    pub format: ContentFormat,
    pub bytes: usize,
    #[serde(skip)]
    source: Arc<SourceSnapshot>,
}
#[derive(Debug)]
struct SourceSnapshot {
    text: String,
    projections: Mutex<HashMap<ProjectionKey, Result<Arc<StructuredPreview>, String>>>,
    syntax: OnceLock<Arc<crate::content_syntax::ContentSyntax>>,
}
#[derive(Debug, PartialEq, Eq, Hash)]
enum ProjectionKey {
    Document(ContentFormat, u64),
    Node(usize, usize, u64),
}
impl std::ops::Deref for ContentDocument {
    type Target = DocumentSource;
    fn deref(&self) -> &Self::Target {
        &self.reference
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SourceRange {
    pub revision: u64,
    pub bytes: Range<usize>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
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

#[derive(Clone, Debug, PartialEq, Eq)]
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
    pub fn new(
        reference: DocumentSource,
        revision: u64,
        source: String,
        format: ContentFormat,
    ) -> Self {
        Self {
            reference,
            revision,
            bytes: source.len(),
            source: Arc::new(SourceSnapshot {
                text: source,
                projections: Mutex::default(),
                syntax: OnceLock::new(),
            }),
            format,
        }
    }

    /// Called once when a tool source changes, never from rendering.
    pub fn from_tool(reference: DocumentSource, revision: u64, text: &str) -> Option<Self> {
        let trimmed = text.trim();
        if trimmed.is_empty() {
            return None;
        }
        let (source, format) = if let Some((language, body)) = trimmed
            .strip_prefix("```")
            .and_then(|fenced| fenced.split_once('\n'))
            .and_then(|(language, body)| body.strip_suffix("```").map(|body| (language, body)))
            .filter(|(_, body)| {
                !body
                    .lines()
                    .any(|line| line.trim_start().starts_with("```"))
            }) {
            let format = match language.trim().to_ascii_lowercase().as_str() {
                "json" => ContentFormat::Json,
                "jsonl" | "ndjson" => ContentFormat::JsonLines,
                "md" | "markdown" => ContentFormat::Markdown,
                language => ContentFormat::Code(language.into()),
            };
            (body.trim_end_matches('\n'), format)
        } else if trimmed.starts_with('{')
            || trimmed.starts_with('[') && serde_json::from_str::<&RawValue>(trimmed).is_ok()
        {
            (text, ContentFormat::Json)
        } else {
            (text, ContentFormat::Markdown)
        };
        Some(Self::new(reference, revision, source.into(), format))
    }

    pub fn header(&self) -> DocumentHeader {
        DocumentHeader {
            source: self.reference.clone(),
            revision: self.revision,
            format: self.format.clone(),
        }
    }

    pub fn source(&self) -> &str {
        &self.source.text
    }

    pub fn shares_source(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.source, &other.source)
    }

    pub fn cached_syntax(&self) -> Option<Arc<crate::content_syntax::ContentSyntax>> {
        self.source.syntax.get().cloned()
    }

    pub fn share_syntax(
        &self,
        syntax: crate::content_syntax::ContentSyntax,
    ) -> Arc<crate::content_syntax::ContentSyntax> {
        self.source.syntax.get_or_init(|| Arc::new(syntax)).clone()
    }

    pub fn text(&self, range: &Range<usize>) -> &str {
        &self.source.text[range.clone()]
    }

    pub fn language(&self) -> &str {
        match &self.format {
            ContentFormat::Json | ContentFormat::JsonLines => "json",
            ContentFormat::Code(language) => language,
            ContentFormat::Text => "plaintext",
            ContentFormat::Markdown => "markdown",
        }
    }

    /// Views of this immutable snapshot share parsing and source indexes.
    pub fn cached_preview(&self) -> Option<Result<Arc<StructuredPreview>, String>> {
        self.source
            .projections
            .lock()
            .expect("source projection cache")
            .get(&ProjectionKey::Document(self.format.clone(), self.revision))
            .cloned()
    }

    /// Admit a result computed outside the view, including a Worker result.
    pub fn share_preview(
        &self,
        preview: Result<StructuredPreview, String>,
    ) -> Result<Arc<StructuredPreview>, String> {
        self.source
            .projections
            .lock()
            .expect("source projection cache")
            .entry(ProjectionKey::Document(self.format.clone(), self.revision))
            .or_insert_with(|| preview.map(Arc::new))
            .clone()
    }

    pub fn shared_preview(&self) -> Result<Arc<StructuredPreview>, String> {
        let key = ProjectionKey::Document(self.format.clone(), self.revision);
        self.source
            .projections
            .lock()
            .expect("source projection cache")
            .entry(key)
            .or_insert_with(|| self.preview().map(Arc::new))
            .clone()
    }

    fn projection_key(&self, range: &Range<usize>) -> ProjectionKey {
        if self.format == ContentFormat::Json && *range == (0..self.bytes) {
            ProjectionKey::Document(self.format.clone(), self.revision)
        } else {
            ProjectionKey::Node(range.start, range.end, self.revision)
        }
    }

    pub fn cached_project(
        &self,
        range: Range<usize>,
    ) -> Option<Result<Arc<StructuredPreview>, String>> {
        self.source
            .projections
            .lock()
            .expect("source projection cache")
            .get(&self.projection_key(&range))
            .cloned()
    }

    pub fn share_project(
        &self,
        range: Range<usize>,
        preview: Result<StructuredPreview, String>,
    ) -> Result<Arc<StructuredPreview>, String> {
        self.source
            .projections
            .lock()
            .expect("source projection cache")
            .entry(self.projection_key(&range))
            .or_insert_with(|| preview.map(Arc::new))
            .clone()
    }

    pub fn shared_project(&self, range: Range<usize>) -> Result<Arc<StructuredPreview>, String> {
        if self.format == ContentFormat::Json && range == (0..self.bytes) {
            return self.shared_preview();
        }
        self.source
            .projections
            .lock()
            .expect("source projection cache")
            .entry(self.projection_key(&range))
            .or_insert_with(|| self.project(range).map(Arc::new))
            .clone()
    }

    pub fn preview(&self) -> Result<StructuredPreview, String> {
        if self.bytes > PREVIEW_BYTES {
            return Err(format!(
                "Preview limit: {} MiB. Open source to read the complete {} bytes.",
                PREVIEW_BYTES / 1024 / 1024,
                self.bytes
            ));
        }
        self.parse_preview()
    }

    /// Background parsers are not subject to the synchronous UI preview budget.
    pub fn parse_preview(&self) -> Result<StructuredPreview, String> {
        let range = 0..self.source.text.len();
        match self.format {
            ContentFormat::Json => self.project(range),
            ContentFormat::JsonLines => {
                let mut records = Vec::new();
                let mut offset = 0;
                for (line, text) in self.source.text.split_inclusive('\n').enumerate() {
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
        let start = value.get().as_ptr() as usize - self.source.text.as_ptr() as usize;
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
    fn reference(id: &str) -> DocumentSource {
        DocumentSource {
            id: id.into(),
            title: id.into(),
            origin: ContentOrigin::Conversation {
                thread_id: "fixture".into(),
            },
        }
    }
    #[test]
    fn wide_records_retain_every_column_exact_value_and_sparse_cell() {
        let fields = (0..2000)
            .map(|index| format!("\"列_{index}\":900719925474099{index:04}"))
            .collect::<Vec<_>>()
            .join(",");
        let document = ContentDocument::new(
            reference("wide"),
            u64::MAX,
            format!("[{{{fields}}},{{\"列_1999\":1.0000000000000000001}}]"),
            ContentFormat::Json,
        );
        let preview = document.parse_preview().unwrap();
        assert_eq!(preview.columns.len(), 2000);
        for (column, name) in preview.columns.iter().enumerate() {
            assert_eq!(name, &format!("列_{column}"));
            assert_eq!(
                document.text(preview.rows[0].cells[column].as_ref().unwrap()),
                format!("900719925474099{column:04}")
            );
        }
        assert!(preview.rows[1].cells[0].is_none());
        assert_eq!(
            document.text(preview.rows[1].cells[1999].as_ref().unwrap()),
            "1.0000000000000000001"
        );
        assert_eq!(preview.rows[1].source.revision, u64::MAX);
        assert_eq!(
            StructuredPreview::from_tape(&preview.to_tape()).unwrap(),
            preview
        );
    }

    #[test]
    fn background_node_cache_is_shared_by_range_and_revision() {
        let document = ContentDocument::new(
            reference("nested"),
            7,
            "{\"a\":[1,2],\"b\":[3]}".into(),
            ContentFormat::Json,
        );
        let range = 5..10;
        assert!(document.cached_project(range.clone()).is_none());
        let preview = document
            .share_project(range.clone(), document.project(range.clone()))
            .unwrap();
        let other = document.clone();
        assert!(Arc::ptr_eq(
            &preview,
            &other.shared_project(range.clone()).unwrap()
        ));
        assert!(other.cached_preview().is_none());
        assert!(other.cached_project(15..18).is_none());
        let mut changed = other.clone();
        changed.revision += 1;
        assert!(changed.cached_project(range).is_none());
        let root = document
            .share_project(0..document.bytes, document.parse_preview())
            .unwrap();
        assert!(Arc::ptr_eq(
            &root,
            &document.cached_preview().unwrap().unwrap()
        ));
    }

    #[test]
    fn shared_projection_lifetime_follows_source_and_revision() {
        let document = ContentDocument::new(
            reference("cached"),
            1,
            "[{\"n\":9007199254740993}]".into(),
            ContentFormat::Json,
        );
        let preview = document.shared_preview().unwrap();
        let retained = Arc::downgrade(&preview);
        let other_view = document.clone();
        assert!(Arc::ptr_eq(
            &preview,
            &other_view.shared_project(0..document.bytes).unwrap()
        ));
        drop(preview);
        assert!(
            retained.upgrade().is_some(),
            "closing one view does not discard the source index"
        );
        let mut next_revision = document.clone();
        next_revision.revision = 2;
        assert_eq!(
            next_revision.shared_preview().unwrap().rows[0]
                .source
                .revision,
            2
        );
        assert_eq!(
            other_view.shared_preview().unwrap().rows[0].source.revision,
            1
        );
        next_revision.format = ContentFormat::JsonLines;
        assert!(
            next_revision.shared_preview().is_err(),
            "a changed projection format is not an old cached value"
        );
    }

    #[test]
    fn tool_text_has_an_explicit_format_through_streaming_transitions() {
        for (text, expected, source) in [
            ("brief text", Some(ContentFormat::Markdown), "brief text"),
            (
                "```rust\na\n```\ntext\n```python\nb\n```",
                Some(ContentFormat::Markdown),
                "```rust\na\n```\ntext\n```python\nb\n```",
            ),
            (
                "[guide](guide.md)",
                Some(ContentFormat::Markdown),
                "[guide](guide.md)",
            ),
            ("[1,2]", Some(ContentFormat::Json), "[1,2]"),
            (
                "# Heading\n\nA **document**",
                Some(ContentFormat::Markdown),
                "# Heading\n\nA **document**",
            ),
            (
                "```rust\nfn example() {}",
                Some(ContentFormat::Markdown),
                "```rust\nfn example() {}",
            ),
            (
                "```rust\nfn example() {}\n```",
                Some(ContentFormat::Code("rust".into())),
                "fn example() {}",
            ),
            (
                "```markdown\n# Title\n```",
                Some(ContentFormat::Markdown),
                "# Title",
            ),
            (
                "{\"n\":9007199254740993}",
                Some(ContentFormat::Json),
                "{\"n\":9007199254740993}",
            ),
            (" \n", None, ""),
        ] {
            let doc = ContentDocument::from_tool(reference("stream"), 9, text);
            assert_eq!(doc.as_ref().map(|doc| doc.format.clone()), expected);
            if let Some(doc) = doc {
                assert_eq!(doc.source(), source);
            }
        }
    }
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
            let doc = ContentDocument::new(reference("test"), 7, source.into(), format);
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
                ContentDocument::new(reference("bad"), 1, source.into(), ContentFormat::Json)
                    .preview()
                    .is_err()
            );
        }
        let doc = ContentDocument::new(
            reference("limit"),
            1,
            " ".repeat(PREVIEW_BYTES + 1),
            ContentFormat::Json,
        );
        assert!(doc.preview().unwrap_err().contains("Preview limit"));
        assert_eq!(doc.source().len(), PREVIEW_BYTES + 1);
    }
}
