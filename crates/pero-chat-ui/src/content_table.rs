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
    table_projection::{ProjectionSpec, SortDirection, TableProjection},
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
    requested: ProjectionSpec,
    generation: u64,
    loading: bool,
    error: Option<String>,
    task: Option<Task<()>>,
    #[cfg(target_family = "wasm")]
    worker: Option<ProjectionWorker>,
}
#[cfg(target_family = "wasm")]
struct ProjectionWorker(u32);
#[cfg(target_family = "wasm")]
impl Drop for ProjectionWorker {
    fn drop(&mut self) {
        #[wasm_bindgen::prelude::wasm_bindgen]
        extern "C" {
            #[wasm_bindgen::prelude::wasm_bindgen(js_namespace=window,js_name=peroReleaseTableProjection)]
            fn release(source: u32);
        }
        release(self.0);
    }
}
impl SourceRows {
    fn new(document: ContentDocument, preview: Arc<StructuredPreview>, locale: String) -> Self {
        Self {
            projection: TableProjection::new(&preview),
            document,
            preview,
            locale,
            requested: ProjectionSpec::default(),
            generation: 0,
            loading: false,
            error: None,
            task: None,
            #[cfg(target_family = "wasm")]
            worker: None,
        }
    }
    fn transform(
        &mut self,
        spec: ProjectionSpec,
        debounce: bool,
        cx: &mut Context<TableState<Self>>,
    ) {
        if spec == self.requested && self.error.is_none() {
            return;
        }
        self.requested = spec.clone();
        self.generation += 1;
        let generation = self.generation;
        self.loading = true;
        self.error = None;
        let document = self.document.clone();
        let preview = self.preview.clone();
        #[cfg(target_family = "wasm")]
        let worker = if document.bytes <= 64 * 1024 {
            Ok(None)
        } else {
            if self.worker.is_none() {
                #[wasm_bindgen::prelude::wasm_bindgen]
                extern "C" {
                    #[wasm_bindgen::prelude::wasm_bindgen(js_namespace=window,js_name=peroCreateTableProjection,catch)]
                    fn create(
                        source: &str,
                        tape: js_sys::Uint32Array,
                    ) -> Result<u32, wasm_bindgen::JsValue>;
                }
                match create(
                    document.source(),
                    js_sys::Uint32Array::from(preview.to_tape().as_slice()),
                ) {
                    Ok(source) => self.worker = Some(ProjectionWorker(source)),
                    Err(error) => self.error = Some(format!("Table analysis: {error:?}")),
                }
            }
            self.worker
                .as_ref()
                .map(|worker| Some(worker.0))
                .ok_or_else(|| self.error.clone().unwrap())
        };
        self.task = Some(cx.spawn(async move |table, cx| {
            if debounce {
                cx.background_executor().timer(std::time::Duration::from_millis(200)).await;
            }
            #[cfg(not(target_family = "wasm"))]
            let result: Result<TableProjection, String> = Ok(TableProjection::from_spec(spec, &document, &preview));
            #[cfg(target_family = "wasm")]
            let result = match worker {
                Err(error) => Err(error),
                Ok(None) => Ok(TableProjection::from_spec(spec, &document, &preview)),
                Ok(Some(source)) => {
                    #[wasm_bindgen::prelude::wasm_bindgen]
                    extern "C" {
                        #[wasm_bindgen::prelude::wasm_bindgen(js_namespace=window,js_name=peroProjectTable,catch)]
                        fn project(source: u32, filter: &str, column: i32, descending: bool) -> Result<js_sys::Promise, wasm_bindgen::JsValue>;
                    }
                    let column = spec.sort.map_or(-1, |(column, _)| column as i32);
                    let descending = spec.sort.is_some_and(|(_, direction)| direction == SortDirection::Descending);
                    let result = match project(source, &spec.filter, column, descending) {
                        Ok(promise) => wasm_bindgen_futures::JsFuture::from(promise).await,
                        Err(error) => Err(error),
                    };
                    result.map_err(|error| format!("Table analysis: {error:?}")).and_then(|value| {
                        let rows: Vec<_> = js_sys::Uint32Array::new(&value).to_vec().into_iter().map(|row| row as usize).collect();
                        if rows.iter().any(|&row| row >= preview.rows.len()) {
                            return Err("Invalid table source row".into());
                        }
                        Ok(TableProjection { rows, filter: spec.filter, sort: spec.sort })
                    })
                }
            };
            let _ = table.update(cx, |table, cx| {
                let rows = table.delegate_mut();
                if rows.generation != generation || !rows.document.shares_source(&document) { return; }
                rows.loading = false;
                match result {
                    Ok(projection) => {
                        rows.projection = projection;
                        table.clear_selection(cx);
                        table.scroll_to_row(0, cx);
                    }
                    Err(error) => {
                        rows.error = Some(error);
                        #[cfg(target_family = "wasm")]
                        { rows.worker = None; }
                    }
                }
                cx.notify();
            });
        }));
        cx.notify();
    }
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
        // Nested JSON is a compact display projection. Copy/open still use
        // the original source range, including whitespace and numeric spelling.
        let nested = range.is_some() && matches!(raw.as_bytes().first(), Some(b'{' | b'['));
        let mut quoted = false;
        let mut escaped = false;
        let mut chars = raw.chars().filter(|&ch| {
            if !nested {
                return true;
            }
            if escaped {
                escaped = false;
                return true;
            }
            if quoted && ch == '\\' {
                escaped = true;
                return true;
            }
            if ch == '"' {
                quoted = !quoted;
            }
            quoted || !ch.is_ascii_whitespace()
        });
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
        self.transform(
            ProjectionSpec {
                filter: self.requested.filter.clone(),
                sort,
            },
            false,
            cx,
        );
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
        let table = cx.new(|cx| {
            TableState::new(
                SourceRows::new(document, preview, locale.clone()),
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
            cx.observe(&table, |_, _, cx| cx.notify()),
            cx.subscribe(&table, |this, _, _: &TableEvent, cx| {
                this.copied = false;
                cx.notify();
            }),
            cx.subscribe(&filter, |this, input, event: &InputEvent, cx| {
                if matches!(event, InputEvent::Change) {
                    let query = input.read(cx).value().to_string();
                    this.table.update(cx, |table, cx| {
                        let rows = table.delegate_mut();
                        rows.transform(
                            ProjectionSpec {
                                filter: query,
                                sort: rows.requested.sort,
                            },
                            true,
                            cx,
                        );
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
            *table.delegate_mut() = SourceRows::new(document, preview, self.locale.clone());
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
            "widths":(0..rows.columns_count(cx)).map(|i|table.col_width(i).map(f32::from)).collect::<Vec<_>>(),
            "loading":rows.loading,"error":rows.error,"requested":rows.requested})
    }
}
impl Render for ContentTable {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let selected = self.selected(cx).is_some();
        let loading = self.table.read(cx).delegate().loading;
        let error = self.table.read(cx).delegate().error.clone();
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
            .when(loading, |view| {
                view.child(
                    div()
                        .text_size(px(12.))
                        .px(px(8.))
                        .text_color(cx.theme().muted_foreground)
                        .child(pero_contracts::i18n::text(
                            &self.locale,
                            "content.transforming",
                        )),
                )
            })
            .when_some(error, |view, error| {
                view.child(
                    div()
                        .text_size(px(12.))
                        .px(px(8.))
                        .text_color(cx.theme().danger)
                        .child(error),
                )
            })
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
