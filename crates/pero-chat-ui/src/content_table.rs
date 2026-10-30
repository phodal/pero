//! Shared source-backed data view; Kit owns table geometry, focus and selection.
use gpui_kit::{
    component::{
        button::*,
        input::{Input, InputEvent, InputState},
        table::*,
        *,
    },
    prelude::*,
    *,
};
use pero_contracts::{
    content_document::{ContentDocument, PreviewShape, StructuredPreview},
    table_projection::{SortDirection, TableProjection},
};
use std::{ops::Range, sync::Arc};

pub struct OpenCell(pub Range<usize>);
pub struct ContentTable {
    table: Entity<TableState<SourceRows>>,
    filter: Entity<InputState>,
    locale: String,
    copied: bool,
    bounds: crate::view_bounds::ViewBounds,
    grid_bounds: crate::view_bounds::ViewBounds,
    _subscriptions: Vec<Subscription>,
}
impl EventEmitter<OpenCell> for ContentTable {}

struct SourceRows {
    document: ContentDocument,
    preview: Arc<StructuredPreview>,
    projection: TableProjection,
    locale: String,
}
impl SourceRows {
    fn cell(&self, row: usize, column: usize) -> Option<Range<usize>> {
        let column = if self.preview.shape == PreviewShape::Properties {
            (column == 2).then_some(0)?
        } else {
            column.checked_sub(1)?
        };
        self.projection.cell(&self.preview, row, column)
    }
    fn text(&self, row: usize, column: usize) -> String {
        let Some(&original) = self.projection.rows.get(row) else {
            return String::new();
        };
        if column == 0 {
            return self.preview.rows[original].line.to_string();
        }
        let range = self.cell(row, column);
        let raw = if self.preview.shape == PreviewShape::Properties && column == 1 {
            self.preview.columns[original].as_str()
        } else if let Some(range) = &range {
            self.document.text(range)
        } else {
            return pero_contracts::i18n::text(&self.locale, "content.missing").into();
        };
        let mut chars = raw.chars();
        let mut text: String = chars.by_ref().take(160).collect();
        if chars.next().is_some() {
            text.push('…');
        }
        text
    }
}
impl TableDelegate for SourceRows {
    fn columns_count(&self, _: &App) -> usize {
        if self.preview.shape == PreviewShape::Properties {
            3
        } else {
            self.preview.columns.len().max(1) + 1
        }
    }
    fn rows_count(&self, _: &App) -> usize {
        self.projection.rows.len()
    }
    fn column(&self, index: usize, _: &App) -> Column {
        let name = if index == 0 {
            "#".into()
        } else if self.preview.shape == PreviewShape::Properties {
            pero_contracts::i18n::text(
                &self.locale,
                if index == 1 {
                    "content.field"
                } else {
                    "content.value"
                },
            )
            .into()
        } else {
            self.preview
                .columns
                .get(index - 1)
                .cloned()
                .unwrap_or_else(|| pero_contracts::i18n::text(&self.locale, "content.value").into())
        };
        let column = Column::new(format!("source-{index}"), name)
            .movable(false)
            .width(px(if index == 0 { 48. } else { 180. }))
            .min_width(px(if index == 0 { 48. } else { 80. }))
            .resizable(index != 0);
        if index > 0 && self.preview.shape != PreviewShape::Properties {
            column.sortable()
        } else {
            column
        }
    }
    fn perform_sort(
        &mut self,
        column: usize,
        sort: ColumnSort,
        _: &mut Window,
        cx: &mut Context<TableState<Self>>,
    ) {
        let sort = match sort {
            ColumnSort::Ascending => Some((column - 1, SortDirection::Ascending)),
            ColumnSort::Descending => Some((column - 1, SortDirection::Descending)),
            ColumnSort::Default => None,
        };
        self.projection.sort(sort, &self.document, &self.preview);
        // A visual row index no longer denotes the previous selected source cell.
        let table = cx.entity().downgrade();
        cx.defer(move |cx| {
            let _ = table.update(cx, |table, cx| {
                table.clear_selection(cx);
                table.scroll_to_row(0, cx);
            });
        });
    }
    fn render_td(
        &mut self,
        row: usize,
        column: usize,
        _: &mut Window,
        cx: &mut Context<TableState<Self>>,
    ) -> impl IntoElement {
        div()
            .truncate()
            .text_color(if self.cell(row, column).is_some() {
                cx.theme().foreground
            } else {
                cx.theme().muted_foreground
            })
            .child(self.text(row, column))
    }
    fn cell_label(&self, row: usize, column: usize, _: &App) -> Option<SharedString> {
        Some(self.text(row, column).into())
    }
    fn render_empty(
        &mut self,
        _: &mut Window,
        _: &mut Context<TableState<Self>>,
    ) -> impl IntoElement {
        div().p(px(12.)).child(pero_contracts::i18n::text(
            &self.locale,
            if self.projection.filter.is_empty() {
                "content.empty"
            } else {
                "content.no_rows"
            },
        ))
    }
}
impl ContentTable {
    pub fn new(
        document: ContentDocument,
        preview: Arc<StructuredPreview>,
        locale: String,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let projection = TableProjection::new(&preview);
        let table = cx.new(|cx| {
            TableState::new(
                SourceRows {
                    document,
                    preview,
                    projection,
                    locale: locale.clone(),
                },
                window,
                cx,
            )
            .cell_selectable(true)
            .row_header(false)
            .row_selectable(false)
            .col_selectable(false)
            .col_movable(false)
        });
        let filter = cx.new(|cx| {
            InputState::new(window, cx)
                .placeholder(pero_contracts::i18n::text(&locale, "content.filter"))
        });
        let subscriptions = vec![
            cx.subscribe(&table, |this, _, _: &TableEvent, cx| {
                this.copied = false;
                cx.notify();
            }),
            cx.subscribe(&filter, |this, input, event: &InputEvent, cx| {
                if matches!(event, InputEvent::Change) {
                    let query = input.read(cx).value().to_string();
                    this.table.update(cx, |table, cx| {
                        let rows = table.delegate_mut();
                        rows.projection.filter(query, &rows.document, &rows.preview);
                        table.clear_selection(cx);
                        table.scroll_to_row(0, cx);
                        cx.notify();
                    });
                    this.copied = false;
                    cx.notify();
                }
            }),
        ];
        let subscription = cx.subscribe(&table, |this, _, event: &TableEvent, cx| {
            if matches!(event, TableEvent::DoubleClickedCell(..)) {
                this.open(cx);
            }
        });
        Self {
            table,
            filter,
            locale,
            copied: false,
            bounds: Default::default(),
            grid_bounds: Default::default(),
            _subscriptions: subscriptions.into_iter().chain([subscription]).collect(),
        }
    }
    pub fn replace(
        &mut self,
        document: ContentDocument,
        preview: Arc<StructuredPreview>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.table.update(cx, |table, cx| {
            let projection = TableProjection::new(&preview);
            *table.delegate_mut() = SourceRows {
                document,
                preview,
                projection,
                locale: self.locale.clone(),
            };
            table.clear_selection(cx);
            table.refresh(cx);
            table.scroll_to_row(0, cx);
            cx.notify();
        });
        self.filter
            .update(cx, |input, cx| input.set_value("", window, cx));
        self.copied = false;
        cx.notify();
    }
    pub fn focus(&self, window: &mut Window, cx: &mut App) {
        self.table.read(cx).focus_handle(cx).focus(window, cx);
    }
    fn selected(&self, cx: &App) -> Option<Range<usize>> {
        let table = self.table.read(cx);
        let (row, column) = table.selected_cell()?;
        table.delegate().cell(row, column)
    }
    fn open(&self, cx: &mut Context<Self>) {
        if let Some(range) = self.selected(cx) {
            cx.emit(OpenCell(range));
        }
    }
    fn copy(&mut self, cx: &mut Context<Self>) {
        if let Some(range) = self.selected(cx) {
            let text = self
                .table
                .read(cx)
                .delegate()
                .document
                .text(&range)
                .to_owned();
            cx.write_to_clipboard(ClipboardItem::new_string(text));
            self.copied = true;
            cx.notify();
        }
    }
    pub fn snapshot(&self, cx: &App) -> serde_json::Value {
        let table = self.table.read(cx);
        let rows = table.delegate();
        serde_json::json!({"bounds":self.bounds.snapshot(),"gridBounds":self.grid_bounds.snapshot(),"filter":rows.projection.filter,"sort":rows.projection.sort,"visibleRows":rows.projection.rows.len(),
            "firstRows":rows.projection.rows.iter().take(8).map(|&i|rows.preview.rows[i].line).collect::<Vec<_>>(),"selectedCell":table.selected_cell(),"sourceRange":self.selected(cx),
            "widths":(0..rows.columns_count(cx)).map(|i|table.col_width(i).map(f32::from)).collect::<Vec<_>>()})
    }
}
impl Render for ContentTable {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let selected = self.selected(cx).is_some();
        let nested = self.selected(cx).is_some_and(|range| {
            self.table
                .read(cx)
                .delegate()
                .document
                .text(&range)
                .starts_with(['{', '['])
        });
        div()
            .id("source-table")
            .relative()
            .child(self.bounds.probe())
            .flex()
            .flex_col()
            .flex_1()
            .min_h_0()
            .capture_key_down(cx.listener(|this, event: &KeyDownEvent, window, cx| {
                if this.filter.read(cx).focus_handle(cx).is_focused(window) {
                    return;
                }
                let modifiers = &event.keystroke.modifiers;
                if event.keystroke.key == "c" && (modifiers.platform || modifiers.control) {
                    this.copy(cx);
                    cx.stop_propagation();
                } else if event.keystroke.key == "enter" {
                    this.open(cx);
                    cx.stop_propagation();
                }
            }))
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(4.))
                    .h(px(32.))
                    .flex_shrink_0()
                    .child(
                        Input::new(&self.filter)
                            .small()
                            .aria_label(pero_contracts::i18n::text(&self.locale, "content.filter"))
                            .flex_1(),
                    )
                    .child(
                        div()
                            .text_size(px(12.))
                            .text_color(cx.theme().muted_foreground)
                            .child(
                                pero_contracts::i18n::text(&self.locale, "content.row_count")
                                    .replace(
                                        "{shown}",
                                        &self
                                            .table
                                            .read(cx)
                                            .delegate()
                                            .projection
                                            .rows
                                            .len()
                                            .to_string(),
                                    )
                                    .replace(
                                        "{total}",
                                        &self
                                            .table
                                            .read(cx)
                                            .delegate()
                                            .preview
                                            .rows
                                            .len()
                                            .to_string(),
                                    ),
                            ),
                    )
                    .child(
                        Button::new("table-copy")
                            .ghost()
                            .small()
                            .label(pero_contracts::i18n::text(
                                &self.locale,
                                if self.copied {
                                    "content.copied"
                                } else {
                                    "content.copy_cell"
                                },
                            ))
                            .disabled(!selected)
                            .on_click(cx.listener(|this, _, _, cx| this.copy(cx))),
                    )
                    .child(
                        Button::new("table-open")
                            .ghost()
                            .small()
                            .label(pero_contracts::i18n::text(
                                &self.locale,
                                if nested {
                                    "content.expand_value"
                                } else {
                                    "content.locate_source"
                                },
                            ))
                            .disabled(self.selected(cx).is_none())
                            .on_click(cx.listener(|this, _, _, cx| this.open(cx))),
                    ),
            )
            .child(
                div()
                    .relative()
                    .child(self.grid_bounds.probe())
                    .flex_1()
                    .min_h_0()
                    .child(
                        DataTable::new(&self.table)
                            .small()
                            .header_row_height(px(28.))
                            .bordered(false),
                    ),
            )
    }
}
