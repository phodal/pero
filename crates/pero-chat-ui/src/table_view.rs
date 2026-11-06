//! Source-bound tables published by the harness, visible outside collapsed tools.
use crate::{panel::ChatPanel, stream::StreamText, scientific_source::{ScientificSource, SourceFormat}};
use gpui_kit::{
    component::{Sizable, button::*},
    prelude::*,
    *,
};
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
#[derive(Deserialize)]
struct Cell {
    display: String,
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
    columns: Vec<Column>,
    rows: Vec<Vec<Cell>>,
    source: Source,
}

#[derive(Clone, Serialize)]
pub struct TableView {
    pub artifact_id: String,
    pub title: String,
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
        if !receipt.source_document.matches_dataset(&table.source.dataset) {
            return Err("Table source identity does not match".into());
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
            vec!["---"; table.columns.len()].join(" | ")
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
            title: table.title,
            rows: table.rows.len(),
            total_records: table.source.total_records,
            source: receipt.source_document,
            content: receipt.content,
            view: cx.new(|cx| StreamText::new(&markdown, cx)),
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
        div().id(SharedString::from(format!("table-{thread}-{tool}"))).w_full().min_w_0().py_3()
            .child(div().font_weight(FontWeight::SEMIBOLD).child(table.title.clone()))
            .child(table.view.clone())
            .child(div().text_sm().text_color(pero_theme::UiAppearance::global(cx).palette.text_muted)
                .child(if zh { format!("{} · 展示 {} / {} 条来源记录 · 科学结论未核验；— 表示字段缺失，null 表示显式空值", table.source.title, table.rows, table.total_records) }
                    else { format!("{} · {} of {} source records · Scientifically unverified; — = missing field, null = explicit null", table.source.title, table.rows, table.total_records) }))
            .child(div().flex().gap_2()
                .child(Button::new("table-data").small().ghost().label(if zh { "数据与来源" } else { "Data and sources" })
                    .on_click(cx.listener(move |this, _, window, cx| this.open_result_document(&thread_id, &tool_id, data.clone(), window, cx))))
                .child(Button::new("table-source").small().ghost().label(if zh { "原始记录" } else { "Original records" })
                    .on_click(cx.listener(move |this, _, window, cx| this.open_result_document(&source_thread, &source_tool, source.clone(), window, cx)))))
            .when_some(reader, |el, reader| el.child(reader)).into_any_element()
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
