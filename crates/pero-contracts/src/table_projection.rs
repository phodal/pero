//! Row transformations retain source indices; displayed order never becomes identity.
use crate::content_document::{ContentDocument, PreviewShape, StructuredPreview};
use num_bigint::BigInt;
use std::{cmp::Ordering, ops::Range};

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SortDirection {
    Ascending,
    Descending,
}

#[derive(Clone, Debug)]
pub struct TableProjection {
    pub rows: Vec<usize>,
    pub filter: String,
    pub sort: Option<(usize, SortDirection)>,
}
impl TableProjection {
    pub fn new(preview: &StructuredPreview) -> Self {
        Self {
            rows: (0..preview.rows.len()).collect(),
            filter: String::new(),
            sort: None,
        }
    }
    pub fn filter(
        &mut self,
        query: String,
        document: &ContentDocument,
        preview: &StructuredPreview,
    ) {
        self.filter = query;
        self.rebuild(document, preview);
    }
    pub fn sort(
        &mut self,
        sort: Option<(usize, SortDirection)>,
        document: &ContentDocument,
        preview: &StructuredPreview,
    ) {
        self.sort = sort;
        self.rebuild(document, preview);
    }
    pub fn cell(
        &self,
        preview: &StructuredPreview,
        row: usize,
        column: usize,
    ) -> Option<Range<usize>> {
        preview
            .rows
            .get(*self.rows.get(row)?)?
            .cells
            .get(column)?
            .clone()
    }
    fn rebuild(&mut self, document: &ContentDocument, preview: &StructuredPreview) {
        let query = self.filter.to_lowercase();
        self.rows = preview
            .rows
            .iter()
            .enumerate()
            .filter_map(|(index, row)| {
                (query.is_empty()
                    || preview.shape == PreviewShape::Properties
                        && preview.columns[index].to_lowercase().contains(&query)
                    || row.cells.iter().flatten().any(|range| {
                        let raw = document.text(range);
                        let text = if raw.starts_with('"') {
                            serde_json::from_str::<String>(raw).expect("validated string cell")
                        } else {
                            raw.to_owned()
                        };
                        text.to_lowercase().contains(&query)
                    }))
                .then_some(index)
            })
            .collect();
        if let Some((column, direction)) = self.sort {
            // Parse one key per visible row, rather than during O(n log n) comparisons.
            let mut keys: Vec<_> = self
                .rows
                .iter()
                .map(|&row| {
                    let range = preview.rows[row].cells.get(column).and_then(Option::as_ref);
                    (
                        row,
                        CellKey::from_raw(range.map(|range| document.text(range))),
                    )
                })
                .collect();
            keys.sort_by(|left, right| {
                let order = left.1.cmp(&right.1);
                if direction == SortDirection::Descending {
                    order.reverse()
                } else {
                    order
                }
            });
            self.rows = keys.into_iter().map(|(row, _)| row).collect();
        }
    }
}

#[derive(PartialEq, Eq, PartialOrd, Ord)]
enum CellKey {
    Missing,
    Null,
    Boolean(bool),
    Number(DecimalKey),
    Text(String),
    Structured(String),
}
impl CellKey {
    fn from_raw(raw: Option<&str>) -> Self {
        match raw {
            None => Self::Missing,
            Some("null") => Self::Null,
            Some("false") => Self::Boolean(false),
            Some("true") => Self::Boolean(true),
            Some(raw) if raw.starts_with('"') => {
                Self::Text(serde_json::from_str(raw).expect("validated string cell"))
            }
            Some(raw) if raw.starts_with(['{', '[']) => Self::Structured(raw.into()),
            Some(raw) => Self::Number(DecimalKey::new(raw)),
        }
    }
}

/// Exact decimal order, without converting JSON numbers through f64 or expanding exponents.
#[derive(PartialEq, Eq)]
struct DecimalKey {
    sign: i8,
    power: BigInt,
    digits: String,
}
impl DecimalKey {
    fn new(raw: &str) -> Self {
        let (mantissa, exponent) = raw.split_once(['e', 'E']).unwrap_or((raw, "0"));
        let negative = mantissa.starts_with('-');
        let mantissa = mantissa.trim_start_matches('-');
        let point = mantissa.find('.').unwrap_or(mantissa.len());
        let digits: String = mantissa.chars().filter(|&c| c != '.').collect();
        let leading = digits.len() - digits.trim_start_matches('0').len();
        let digits = digits
            .trim_start_matches('0')
            .trim_end_matches('0')
            .to_owned();
        let power = if digits.is_empty() {
            BigInt::from(0)
        } else {
            exponent
                .parse::<BigInt>()
                .expect("validated number exponent")
                + BigInt::from(point)
                - BigInt::from(leading)
        };
        Self {
            sign: if digits.is_empty() {
                0
            } else if negative {
                -1
            } else {
                1
            },
            power,
            digits,
        }
    }
}
impl Ord for DecimalKey {
    fn cmp(&self, other: &Self) -> Ordering {
        self.sign.cmp(&other.sign).then_with(|| {
            let order = self
                .power
                .cmp(&other.power)
                .then_with(|| self.digits.cmp(&other.digits));
            if self.sign < 0 {
                order.reverse()
            } else {
                order
            }
        })
    }
}
impl PartialOrd for DecimalKey {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        content_document::{ContentFormat, DocumentSource},
        content_origin::ContentOrigin,
    };
    #[test]
    fn transformed_rows_keep_exact_values_and_source_locations() {
        for (text, query, descending, expected) in [
            (
                r#"[{"n":9007199254740993},{"n":9007199254740992}]"#,
                "",
                false,
                vec![1, 0],
            ),
            (
                r#"[{"n":1.0000000000000000002},{"n":1.0000000000000000001}]"#,
                "",
                false,
                vec![1, 0],
            ),
            (
                r#"[{"n":-1.2},{"n":-1.02},{"n":-0},{"n":0.0},{"n":12e-1}]"#,
                "",
                false,
                vec![0, 1, 2, 3, 4],
            ),
            (
                r#"[{"n":12e3},{"n":1.21e4},{"n":12000}]"#,
                "",
                true,
                vec![1, 0, 2],
            ),
            (
                r#"[{"n":2},{"n":null},{"other":1},{"n":true},{"n":"2"}]"#,
                "",
                false,
                vec![2, 1, 3, 0, 4],
            ),
            (
                r#"[{"n":2,"text":"\u4e2d\u6587 ALPHA"},{"n":1,"text":"中文 alpha"},{"n":3,"text":"beta"}]"#,
                "中文 ALPHA",
                false,
                vec![1, 0],
            ),
            (r#"[{"n":1},{"n":2}]"#, "absent", false, vec![]),
            (r#"{"first":2,"Second":1}"#, "second", false, vec![1]),
        ] {
            let document = ContentDocument::new(
                DocumentSource {
                    id: "test".into(),
                    title: "test".into(),
                    origin: ContentOrigin::File {
                        path: "/tmp/test.json".into(),
                    },
                },
                7,
                text.into(),
                ContentFormat::Json,
            );
            let preview = document.preview().unwrap();
            let mut projection = TableProjection::new(&preview);
            projection.filter(query.into(), &document, &preview);
            projection.sort(
                Some((
                    0,
                    if descending {
                        SortDirection::Descending
                    } else {
                        SortDirection::Ascending
                    },
                )),
                &document,
                &preview,
            );
            assert_eq!(projection.rows, expected, "{text}");
            for (visible, &original) in projection.rows.iter().enumerate() {
                assert_eq!(
                    projection.cell(&preview, visible, 0),
                    preview.rows[original].cells[0]
                );
                assert_eq!(preview.rows[original].source.revision, 7);
            }
            projection.sort(None, &document, &preview);
            let mut original_order = expected;
            original_order.sort();
            assert_eq!(projection.rows, original_order);
        }
    }
}
