//! Source-bound tables published by the harness, visible outside collapsed tools.
use crate::{
    panel::ChatPanel,
    scientific_source::{ScientificSource, SourceFormat},
    stream::StreamText,
};
use gpui_kit::{prelude::*, *};
use pero_contracts::{
    content_document::{ContentDocument, ContentFormat, DocumentSource},
    content_origin::ContentOrigin,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Receipt {
    kind: String,
    artifact_id: String,
    content: String,
    source_document: ScientificSource,
}

#[derive(Deserialize)]
struct Column {
    label: String,
    unit: String,
}
#[derive(Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum CellKind {
    Number,
    String,
    Boolean,
    Object,
    Array,
    Null,
    Missing,
}
#[derive(Deserialize)]
struct Cell {
    display: String,
    kind: CellKind,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Source {
    dataset: String,
    total_records: usize,
}
#[derive(Deserialize)]
struct TableDocument {
    title: String,
    description: String,
    #[serde(default)]
    method: String,
    #[serde(default = "unspecified_origin", rename = "valueOrigin")]
    value_origin: String,
    columns: Vec<Column>,
    rows: Vec<Vec<Cell>>,
    source: Source,
}

fn unspecified_origin() -> String {
    "unspecified".into()
}

#[derive(Clone, Serialize)]
pub struct TableView {
    pub artifact_id: String,
    #[serde(skip)]
    pub(crate) data_bounds: crate::view_bounds::ViewBounds,
    #[serde(skip)]
    pub(crate) source_bounds: crate::view_bounds::ViewBounds,
    #[serde(skip)]
    missing: bool,
    #[serde(skip)]
    nulls: bool,
    pub title: String,
    pub method: String,
    pub value_origin: String,
    pub rows: usize,
    pub total_records: usize,
    source: ScientificSource,
    content: String,
    #[serde(skip)]
    view: Entity<StreamText>,
}

fn literal(text: &str) -> String {
    let mut escaped = String::new();
    for ch in text.chars() {
        match ch {
            '\n' => escaped.push_str(" ↵ "),
            '\r' => {}
            '\\' | '|' | '*' | '_' | '[' | ']' | '<' | '>' | '`' | '$' | '#' | '!' | '&' | '~' => {
                escaped.push('\\');
                escaped.push(ch);
            }
            _ => escaped.push(ch),
        }
    }
    escaped
}

impl TableView {
    pub fn from_content(text: &str, cx: &mut App) -> Result<Self, String> {
        let receipt: Receipt = serde_json::from_str(text).map_err(|_| "Invalid table receipt")?;
        if receipt.kind != "pero.table.v1"
            || format!("{:x}", Sha256::digest(receipt.content.as_bytes())) != receipt.artifact_id
        {
            return Err("Table identity does not match".into());
        }
        let table: TableDocument =
            serde_json::from_str(&receipt.content).map_err(|_| "Invalid table content")?;
        if !receipt
            .source_document
            .matches_dataset(&table.source.dataset)
        {
            return Err("Table source identity does not match".into());
        }
        if !matches!(table.value_origin.as_str(), "reported" | "calculated" | "unspecified") || table.method.len() > 500 {
            return Err("Table method or value origin is invalid".into());
        }
        if table.columns.is_empty()
            || table.columns.len() > 16
            || table.rows.is_empty()
            || table.rows.len() > 100
            || table
                .rows
                .iter()
                .any(|row| row.len() != table.columns.len())
        {
            return Err("Invalid table dimensions".into());
        }
        let headers = table
            .columns
            .iter()
            .map(|column| {
                literal(&if column.unit.is_empty() {
                    column.label.clone()
                } else {
                    format!("{} ({})", column.label, column.unit)
                })
            })
            .collect::<Vec<_>>()
            .join(" | ");
        let mut markdown = format!(
            "{}\n\n| {headers} |\n| {} |\n",
            literal(&table.description),
            (0..table.columns.len())
                .map(|index| {
                    if table
                        .rows
                        .iter()
                        .any(|row| row[index].kind == CellKind::Number)
                        && table.rows.iter().all(|row| {
                            matches!(
                                row[index].kind,
                                CellKind::Number | CellKind::Null | CellKind::Missing
                            )
                        })
                    {
                        "---:"
                    } else {
                        "---"
                    }
                })
                .collect::<Vec<_>>()
                .join(" | ")
        );
        for row in &table.rows {
            markdown.push_str(&format!(
                "| {} |\n",
                row.iter()
                    .map(|cell| literal(&cell.display))
                    .collect::<Vec<_>>()
                    .join(" | ")
            ));
        }
        Ok(Self {
            artifact_id: receipt.artifact_id,
            data_bounds: Default::default(),
            source_bounds: Default::default(),
            missing: table
                .rows
                .iter()
                .flatten()
                .any(|cell| cell.kind == CellKind::Missing),
            nulls: table
                .rows
                .iter()
                .flatten()
                .any(|cell| cell.kind == CellKind::Null),
            title: table.title,
            method: table.method,
            value_origin: table.value_origin,
            rows: table.rows.len(),
            total_records: table.source.total_records,
            source: receipt.source_document,
            content: receipt.content,
            view: cx.new(|cx| {
                let mut view = StreamText::new(&markdown, cx);
                view.appearance = crate::stream::StreamAppearance::ScientificTable;
                view
            }),
        })
    }
}

impl ChatPanel {
    pub(crate) fn inline_table(
        &self,
        thread: &str,
        tool: &str,
        table: &TableView,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let zh = self.locale.starts_with("zh");
        let data = ContentDocument::new(
            DocumentSource {
                id: format!("table/{}", table.artifact_id),
                title: format!("{}.json", table.title),
                origin: ContentOrigin::Conversation {
                    thread_id: thread.into(),
                },
            },
            1,
            table.content.clone(),
            ContentFormat::Json,
        );
        let source = ContentDocument::new(
            DocumentSource {
                id: format!("table/{}/source", table.artifact_id),
                title: table.source.title.clone(),
                origin: ContentOrigin::Conversation {
                    thread_id: thread.into(),
                },
            },
            1,
            table.source.text.clone(),
            match table.source.format {
                SourceFormat::JsonLines => ContentFormat::JsonLines,
                SourceFormat::Json => ContentFormat::Json,
            },
        );
        let thread_id = thread.to_owned();
        let tool_id = tool.to_owned();
        let source_thread = thread_id.clone();
        let source_tool = tool_id.clone();
        let reader = self
            .chats
            .iter()
            .find(|chat| chat.id == thread)
            .and_then(|chat| chat.tools.iter().find(|item| item.id == tool))
            .and_then(|tool| tool.chart_reader.clone());
        let chrome = pero_theme::Chrome::from_app(cx);
        let citation = crate::scientific_citation::table_citation(&table.artifact_id);
        let origin = match table.value_origin.as_str() {
            "reported" => if zh { "数值声明为报告值，未经独立检查" } else { "Declared as reported values, not independently checked" },
            "calculated" => if zh { "数值声明为计算值，未经独立检查" } else { "Declared as calculated values, not independently checked" },
            _ => if zh { "未说明数值来源，不是实验验证" } else { "Value origin is not stated. Not an experimental verification" },
        };
        let method = if table.method.is_empty() {
            if zh { "未说明计算方法".into() } else { "Calculation method is not stated".into() }
        } else if zh {
            format!("方法：{}", table.method)
        } else {
            format!("Method: {}", table.method)
        };
        let mut legend = Vec::new();
        if table.missing {
            legend.push(if zh {
                "— 表示字段缺失"
            } else {
                "— = missing field"
            });
        }
        if table.nulls {
            legend.push(if zh {
                "null 表示显式空值"
            } else {
                "null = explicit null"
            });
        }
        pero_theme::research_result(table.title.clone(), chrome)
            .id(SharedString::from(format!("table-{thread}-{tool}")))
            .child(table.view.clone())
            .child(
                pero_theme::research_note(chrome)
                    .child(if zh {
                        format!(
                            "{} · {} / {} 条记录 · 科学结论未核验",
                            table.source.title, table.rows, table.total_records
                        )
                    } else {
                        format!(
                            "{} · {} of {} records · Scientifically unverified",
                            table.source.title, table.rows, table.total_records
                        )
                    })
                    .when(!legend.is_empty(), |el| el.child(legend.join(" · ")))
                    .child(origin)
                    .child(method)
                    .child(citation.clone()),
            )
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .gap_2()
                    .child(
                        pero_theme::action_button(
                            "table-source",
                            if zh {
                                "原始记录"
                            } else {
                                "Original records"
                            },
                            pero_theme::ActionKind::Ghost,
                            chrome,
                            cx,
                        )
                        .relative()
                        .child(table.source_bounds.probe())
                        .on_click(cx.listener(
                            move |this, _, window, cx| {
                                this.open_result_document(
                                    &source_thread,
                                    &source_tool,
                                    source.clone(),
                                    window,
                                    cx,
                                )
                            },
                        )),
                    )
                    .child(
                        pero_theme::action_button(
                            "table-data",
                            if zh {
                                "数据与来源"
                            } else {
                                "Data and sources"
                            },
                            pero_theme::ActionKind::Ghost,
                            chrome,
                            cx,
                        )
                        .relative()
                        .child(table.data_bounds.probe())
                        .on_click(cx.listener(
                            move |this, _, window, cx| {
                                this.open_result_document(
                                    &thread_id,
                                    &tool_id,
                                    data.clone(),
                                    window,
                                    cx,
                                )
                            },
                        )),
                    )
                    .child(
                        pero_theme::action_button(
                            "table-cite",
                            if zh { "复制引用" } else { "Copy citation" },
                            pero_theme::ActionKind::Ghost,
                            chrome,
                            cx,
                        )
                        .on_click(move |_, _, cx| {
                            cx.write_to_clipboard(ClipboardItem::new_string(citation.clone()))
                        }),
                    ),
            )
            .when_some(reader, |el, reader| el.child(reader))
            .into_any_element()
    }
}

#[cfg(test)]
mod tests {
    use super::literal;
    #[test]
    fn data_cannot_become_markdown_structure_or_an_external_image() {
        assert_eq!(literal("0.0100"), "0.0100");
        assert_eq!(literal("&lt; ~~value~~"), r"\&lt; \~\~value\~\~");
        assert_eq!(
            literal("a|b\n![x](https://x) $y$"),
            "a\\|b ↵ \\!\\[x\\](https://x) \\$y\\$"
        );
    }
}
