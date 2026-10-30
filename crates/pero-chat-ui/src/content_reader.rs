//! Retained reading state; an editor is mounted only when source is requested.
mod edit;
mod location;
mod preview;
mod search;
mod state;
use gpui_kit::component::Disableable;
use gpui_kit::{
    component::{
        ActiveTheme, IconName, Sizable, WindowExt,
        button::*,
        input::{
            Editor, EditorState, Enter, Input, InputEvent, InputState, Redo, RopeExt, Search, Undo,
        },
    },
    prelude::*,
    *,
};
use pero_contracts::content_document::{ContentDocument, ContentFormat, StructuredPreview};
use pero_contracts::content_origin::ContentOrigin;
use pero_contracts::markdown_source::MarkdownSource;
use pero_contracts::reader_state::{ReaderState, SearchOptions};
use std::{ops::Range, sync::Arc};
gpui_kit::actions!(content_document, [SaveDocument]);
#[derive(Clone)]
pub enum ReaderAction {
    Save {
        source: String,
        revision: u64,
        text: String,
    },
    Reload {
        path: String,
    },
    DiscardAndClose,
    Link(String),
    Navigate {
        before: ReaderState,
        after: ReaderState,
    },
    Edit {
        edit: pero_contracts::text_edit_anchor::TextEdit,
        inserted: String,
    },
    Undo {
        redo: bool,
    },
    Focus,
    EditTransaction {
        begin: bool,
    },
}
impl EventEmitter<ReaderAction> for ContentReader {}

#[derive(Clone, Copy)]
enum DiscardAction {
    Reload,
    Close,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ReaderPlacement {
    Inline,
    Workspace,
}

pub struct ContentReader {
    pub document: ContentDocument,
    pub locale: String,
    placement: ReaderPlacement,
    editor: Option<Entity<EditorState>>,
    editor_subscription: Option<Subscription>,
    editor_observer: Option<Subscription>,
    pending_folded_lines: Vec<usize>,
    deferred_editor_state: Option<ReaderState>,
    dirty: bool,
    saving: bool,
    file_error: Option<String>,
    discard: Option<DiscardAction>,
    preview: Result<Arc<StructuredPreview>, String>,
    preview_loading: bool,
    preview_task: Option<Task<()>>,
    table: Option<Entity<crate::content_table::ContentTable>>,
    table_subscription: Option<Subscription>,
    preview_document: ContentDocument,
    markdown: Option<Entity<crate::stream::StreamText>>,
    markdown_subscription: Option<Subscription>,
    preview_scroll: ScrollHandle,
    source: bool,
    search_open: bool,
    search_input: Entity<InputState>,
    _search_subscription: Subscription,
    search_options: SearchOptions,
    search_error: Option<String>,
    markdown_index: Option<MarkdownSource>,
    pending_anchor: Option<Range<usize>>,
    source_pointer_selection: Option<Range<usize>>,
    pending_record: Option<usize>,
    path: Vec<Range<usize>>,
    copied: bool,
    window: AnyWindowHandle,
    bounds: crate::view_bounds::ViewBounds,
    focus_handle: FocusHandle,
}

impl ContentReader {
    pub fn new(
        document: ContentDocument,
        locale: String,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        // wasm32-unknown-unknown takes the non-macOS Kit keymap.
        cx.bind_keys([
            KeyBinding::new("cmd-f", Search, Some("Input")),
            KeyBinding::new("cmd-s", SaveDocument, None),
            KeyBinding::new("ctrl-s", SaveDocument, None),
        ]);
        let source = !matches!(
            document.format,
            ContentFormat::Json | ContentFormat::JsonLines | ContentFormat::Markdown
        );
        let search_input = cx.new(|cx| InputState::new(window, cx));
        let search_subscription =
            cx.subscribe_in(&search_input, window, |this, _, event, _, cx| {
                match event {
                    InputEvent::Change => this.apply_search(cx),
                    _ => {}
                }
                cx.notify();
            });
        let markdown = matches!(document.format, ContentFormat::Markdown)
            .then(|| cx.new(|cx| crate::stream::StreamText::new(document.source(), cx)));
        let mut this = Self {
            preview_document: document.clone(),
            document,
            locale,
            placement: ReaderPlacement::Inline,
            editor: None,
            editor_subscription: None,
            editor_observer: None,
            pending_folded_lines: vec![],
            deferred_editor_state: None,
            dirty: false,
            saving: false,
            file_error: None,
            discard: None,
            preview: Err(String::new()),
            preview_loading: false,
            preview_task: None,
            table: None,
            table_subscription: None,
            markdown,
            markdown_subscription: None,
            preview_scroll: ScrollHandle::new(),
            source,
            search_open: false,
            search_input,
            _search_subscription: search_subscription,
            search_options: Default::default(),
            search_error: None,
            markdown_index: None,
            pending_anchor: None,
            source_pointer_selection: None,
            pending_record: None,
            path: vec![],
            copied: false,
            window: window.window_handle(),
            bounds: Default::default(),
            focus_handle: cx.focus_handle(),
        };
        this.refresh_projection(false, window, cx);
        if source {
            this.open_source(None, window, cx);
        }
        this
    }

    /// The same reading state fits the workspace instead of an inline result.
    pub fn workspace(mut self, window: &mut Window, cx: &mut Context<Self>) -> Self {
        self.placement = ReaderPlacement::Workspace;
        self.observe_edits(cx);
        self.observe_links(window, cx);
        self
    }

    pub fn focus(&self, window: &mut Window, cx: &mut App) {
        // A late source read may materialize a workspace preview behind a picker.
        // The dialog keeps focus until its explicit close hands it back.
        if self.placement == ReaderPlacement::Workspace && window.has_active_dialog(cx) {
            return;
        }
        if self.search_open {
            self.search_input
                .update(cx, |input, cx| input.focus(window, cx));
        } else if !self.source && self.table.is_some() {
            self.table
                .as_ref()
                .unwrap()
                .update(cx, |table, cx| table.focus(window, cx));
        } else if let Some(editor) = self.editor.as_ref().filter(|_| self.source) {
            editor.update(cx, |editor, cx| editor.focus(window, cx));
        } else {
            self.focus_handle.focus(window, cx);
        }
    }

    pub fn set_scroll_handle(&self, scroll: Option<ScrollHandle>, cx: &mut App) {
        if let Some(markdown) = &self.markdown {
            markdown.update(cx, |view, _| view.set_scroll_handle(scroll));
        }
    }

    pub fn snapshot(&self, cx: &App) -> serde_json::Value {
        let preview_offset = self.preview_scroll.offset();
        serde_json::json!({"bounds":self.bounds.snapshot(),"id":self.document.id,"revision":self.document.revision,"bytes":self.document.bytes,
            "dirty":self.dirty,"saving":self.saving,"fileError":self.file_error,"confirmClose":self.discard.is_some(),"editable":self.editable(),"markdown":self.markdown.is_some(),"workspace":self.placement==ReaderPlacement::Workspace,"source":self.source,"editor":self.editor.is_some(),"rows":self.preview.as_ref().map(|p|p.rows.len()).ok(),
            "table":self.table.as_ref().map(|table|table.read(cx).snapshot(cx)),
            "columns":self.preview.as_ref().map(|p|p.columns.len()).ok(),"previewLoading":self.preview_loading,"error":self.preview.as_ref().err().filter(|_|!self.preview_loading),
            "selection":self.editor.as_ref().map(|e|e.read(cx).selected_range()),
            "searchError":self.search_error,"searchOptions":self.search_options,"markdownSelection":self.markdown.as_ref().and_then(|markdown|markdown.read(cx).selected_source_range(&self.preview_document,cx)),"markdownReveal":self.markdown.as_ref().and_then(|markdown|markdown.read(cx).source_reveal()),
            "markdownObservedSelection":self.markdown.as_ref().and_then(|markdown|markdown.read(cx).observed_source_selection(&self.preview_document,cx)),
            "previewScroll":[f32::from(preview_offset.x),f32::from(preview_offset.y)],
            "search":self.editor.as_ref().map(|e| {let s=e.read(cx).search_session();serde_json::json!({"open":self.search_open,"query":self.search_input.read(cx).value().as_ref(),"matches":s.matcher.len(),"current":s.matcher.current()})}),
            "foldable":self.editor.as_ref().map(|e|e.read(cx).display_map().is_fold_candidate(0)),
            "cursor":self.editor.as_ref().map(|e|e.read(cx).cursor_position()),
            "folds":self.editor.as_ref().map(|e|e.read(cx).display_map().folded_ranges().len()),
            "language":self.document.language(),
            "editorBytes":self.editor.as_ref().map(|e|e.read(cx).text().len())})
    }

    fn observe_links(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.placement == ReaderPlacement::Workspace && self.markdown_subscription.is_none() {
            if let Some(markdown) = &self.markdown {
                let scroll = self.preview_scroll.clone();
                markdown.update(cx, |view, _| {
                    view.capture_links = true;
                    view.set_reveal_scroll(scroll);
                });
                self.markdown_subscription = Some(cx.subscribe_in(
                    markdown,
                    window,
                    |this, _, link: &crate::stream::MarkdownLink, window, cx| {
                        if let Some(fragment) = link.0.strip_prefix('#') {
                            if this.follow_anchor(fragment, window, cx) {
                                return;
                            }
                        }
                        cx.emit(ReaderAction::Link(link.0.clone()));
                    },
                ));
            }
        }
    }

    pub fn reload(
        &mut self,
        document: ContentDocument,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if let Some(editor) = &self.editor {
            editor.update(cx, |editor, cx| {
                editor.set_value(document.source().to_owned(), window, cx)
            });
        }
        self.dirty = false;
        self.saving = false;
        self.file_error = None;
        self.discard = None;
        self.replace(document, cx);
        self.show_preview(window, cx);
        if !matches!(
            self.document.format,
            ContentFormat::Markdown | ContentFormat::Json | ContentFormat::JsonLines
        ) {
            self.source = true;
        }
        cx.notify();
    }
    fn observe_edits(&mut self, cx: &mut Context<Self>) {
        if self.editor_subscription.is_none() && self.placement == ReaderPlacement::Workspace {
            if let Some(editor) = &self.editor {
                self.editor_subscription = Some(cx.subscribe(editor, |this, editor, event, cx| {
                    if matches!(event, InputEvent::Focus) {
                        cx.emit(ReaderAction::Focus);
                    }
                    if let InputEvent::EditTransaction { begin } = event
                        && this.editable()
                    {
                        cx.emit(ReaderAction::EditTransaction { begin: *begin });
                    }
                    if let InputEvent::Edit {
                        old,
                        inserted,
                        old_lines,
                        new_line_count,
                    } = event
                        && this.editable()
                    {
                        cx.emit(ReaderAction::Edit {
                            edit: pero_contracts::text_edit_anchor::TextEdit {
                                old: old.clone(),
                                new_len: inserted.len(),
                                old_lines: old_lines.clone(),
                                new_line_count: *new_line_count,
                            },
                            inserted: inserted.clone(),
                        });
                    }
                    if matches!(event, InputEvent::Change) && this.editable() {
                        let text = editor.read(cx).text();
                        this.dirty = text.len() != this.document.bytes
                            || !text.bytes().eq(this.document.source().bytes());
                        this.copied = false;
                        if this.search_open {
                            this.apply_search(cx);
                        }
                        cx.notify();
                    }
                }));
            }
        }
    }
    pub fn request_close(&mut self, cx: &mut Context<Self>) {
        self.discard = Some(DiscardAction::Close);
        cx.notify();
    }
    pub fn dirty(&self) -> bool {
        self.dirty
    }
    fn editable(&self) -> bool {
        self.placement == ReaderPlacement::Workspace
            && matches!(self.document.origin, ContentOrigin::File { .. })
    }
    pub fn file_failed(&mut self, key: &str, cx: &mut Context<Self>) {
        self.saving = false;
        self.file_error = Some(key.into());
        cx.notify();
    }
    pub fn saved(&mut self, document: ContentDocument, cx: &mut Context<Self>) {
        self.document = document;
        self.saving = false;
        self.file_error = None;
        self.discard = None;
        self.dirty = self.editor.as_ref().is_some_and(|e| {
            let text = e.read(cx).text();
            text.len() != self.document.bytes || !text.bytes().eq(self.document.source().bytes())
        });
        cx.notify();
    }
    fn save(&mut self, cx: &mut Context<Self>) {
        if !self.editable() || !self.dirty || self.saving {
            return;
        }
        if let Some(editor) = &self.editor {
            self.saving = true;
            self.file_error = None;
            cx.emit(ReaderAction::Save {
                source: self.document.id.clone(),
                revision: self.document.revision,
                text: editor.read(cx).text().to_string(),
            });
            cx.notify();
        }
    }
    fn show_preview(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if !self.dirty && self.preview_document.shares_source(&self.document) {
            self.reveal_markdown_selection(cx);
            self.source = false;
            cx.notify();
            return;
        }
        self.refresh_preview(window, cx);
        self.reveal_markdown_selection(cx);
        self.source = false;
        cx.notify();
    }
    fn refresh_preview(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let draft = self.editor.as_ref().filter(|_| self.dirty).map(|editor| {
            self.document
                .header()
                .into_document(editor.read(cx).text().to_string())
        });
        let document = draft.unwrap_or_else(|| self.document.clone());
        self.preview_document = document.clone();
        self.path.clear();
        self.refresh_projection(false, window, cx);
        self.markdown_index = None;
        if let Some(markdown) = &self.markdown {
            markdown.update(cx, |view, cx| view.replace(document.source(), cx));
        }
    }
    fn t(&self, key: &str) -> &'static str {
        pero_contracts::i18n::text(&self.locale, key)
    }

    fn open_source(
        &mut self,
        mut range: Option<Range<usize>>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if range.is_none() && !self.source {
            range = self.markdown.as_ref().and_then(|markdown| {
                markdown
                    .read(cx)
                    .selected_source_range(&self.preview_document, cx)
            });
            range = range.or_else(|| self.pending_anchor.take());
        }
        self.pending_anchor = None;
        if self.editor.is_none() {
            let language = self.document.language();
            // Long single-line JSON must not shape a screenful of wrapped text.
            self.editor = Some(cx.new(|cx| {
                let mut editor = EditorState::new(window, cx)
                    .language(language.to_owned())
                    .searchable(true)
                    .soft_wrap(false)
                    .default_value(self.document.source().to_owned());
                crate::source_syntax::configure_source_syntax(
                    &mut editor,
                    &self.document,
                    window,
                    cx,
                );
                editor
            }));
        }
        self.observe_edits(cx);
        self.observe_editor(cx);
        self.apply_deferred_editor_state(cx);
        if let (Some(editor), Some(range)) = (&self.editor, range) {
            editor.update(cx, |editor, cx| {
                let position = editor.text().offset_to_position(range.start);
                editor.unfold_at(position, cx);
                editor.set_cursor_position(position, window, cx);
                editor.set_selected_range(range.clone(), cx);
            });
        }
        self.source = true;
        self.copied = false;
        cx.notify();
    }

    fn search_source(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.search_open = true;
        let seed = self.editor.as_ref().and_then(|editor| {
            let editor = editor.read(cx);
            let range = editor.selected_range();
            if range.is_empty() {
                None
            } else {
                editor.text().to_string().get(range).map(str::to_owned)
            }
        });
        self.search_input.update(cx, |input, cx| {
            if let Some(seed) = &seed {
                input.set_value(seed.clone(), window, cx);
            }
            input.focus(window, cx);
            input.select_all(window, cx);
        });
        self.apply_search(cx);
        cx.notify();
    }

    fn close_search(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.search_open = false;
        if let Some(editor) = &self.editor {
            editor.update(cx, |editor, cx| {
                editor.close_search(cx);
                editor.focus(window, cx);
            });
        }
        cx.notify();
    }

    /// Updates run at the event boundary, outside rendering. Multiple pending
    /// source updates coalesce; an unchanged revision never resets selection.
    pub fn replace(&mut self, document: ContentDocument, cx: &mut Context<Self>) {
        if document.id == self.document.id
            && document.origin == self.document.origin
            && document.revision == self.document.revision
        {
            if self.document.title != document.title {
                self.document = document;
                cx.notify();
            }
            return;
        }
        let family_changed = matches!(
            self.document.format,
            ContentFormat::Json | ContentFormat::JsonLines
        ) != matches!(
            document.format,
            ContentFormat::Json | ContentFormat::JsonLines
        );
        let restore = family_changed.then(|| {
            let mut state = self.reading_state(cx);
            state.path.clear();
            state.folded_lines.clear();
            state
        });
        if family_changed {
            self.editor = None;
            self.editor_subscription = None;
            self.editor_observer = None;
        }
        self.document = document;
        self.dirty = false;
        self.saving = false;
        self.file_error = None;
        self.discard = None;
        let revision = self.document.revision;
        let id = self.document.id.clone();
        let window = self.window;
        let weak = cx.entity().downgrade();
        cx.defer(move |cx| {
            let _ = window.update(cx, |_, window, cx| {
                weak.update(cx, |this, cx| {
                    if this.document.id != id || this.document.revision != revision {
                        return;
                    }
                    this.preview_document = this.document.clone();
                    if matches!(this.document.format, ContentFormat::Markdown) {
                        if let Some(view) = &this.markdown {
                            view.update(cx, |view, cx| view.replace(this.document.source(), cx));
                        } else {
                            this.markdown = Some(cx.new(|cx| {
                                crate::stream::StreamText::new(this.document.source(), cx)
                            }));
                        }
                    } else {
                        this.markdown = None;
                        this.markdown_subscription = None;
                    }
                    this.observe_links(window, cx);
                    this.path.clear();
                    this.refresh_projection(true, window, cx);
                    this.markdown_index = None;
                    this.pending_anchor = None;
                    this.copied = false;
                    if let Some(editor) = &this.editor {
                        editor.update(cx, |editor, cx| {
                            editor.set_highlighter(this.document.language(), cx);
                            editor.set_value(this.document.source().to_owned(), window, cx);
                            crate::source_syntax::configure_source_syntax(
                                editor,
                                &this.document,
                                window,
                                cx,
                            );
                        });
                    }
                    if matches!(
                        this.document.format,
                        ContentFormat::Code(_) | ContentFormat::Text
                    ) {
                        this.open_source(None, window, cx);
                    }
                    if let Some(state) = restore {
                        this.restore_reading_state(state, window, cx);
                    } else if this.search_open {
                        this.apply_search(cx);
                    }
                    cx.notify();
                })
            });
        });
    }

    fn sync_table(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Ok(preview) = &self.preview else {
            self.table = None;
            self.table_subscription = None;
            return;
        };
        if let Some(table) = &self.table {
            table.update(cx, |table, cx| {
                table.replace(self.preview_document.clone(), preview.clone(), window, cx)
            });
        } else {
            let table = cx.new(|cx| {
                crate::content_table::ContentTable::new(
                    self.preview_document.clone(),
                    preview.clone(),
                    self.locale.clone(),
                    window,
                    cx,
                )
            });
            self.table_subscription = Some(cx.subscribe_in(
                &table,
                window,
                |this, _, event: &crate::content_table::OpenCell, window, cx| {
                    let before = this.reading_state(cx);
                    let range = &event.0;
                    if this.preview_document.text(range).starts_with(['{', '[']) {
                        this.path.push(range.clone());
                        this.refresh_projection(false, window, cx);
                        this.copied = false;
                        cx.notify();
                    } else {
                        this.open_source(Some(range.clone()), window, cx);
                    }
                    this.finish_navigation(before, cx);
                },
            ));
            self.table = Some(table);
        }
    }
}

impl Render for ContentReader {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let workspace = self.placement == ReaderPlacement::Workspace;
        let structured = matches!(
            self.document.format,
            ContentFormat::Json | ContentFormat::JsonLines | ContentFormat::Markdown
        );
        let inline_markdown = !workspace && !self.source && self.markdown.is_some();
        let height = if self.source {
            let lines = self.document.source().lines().take(16).count().max(1) as f32;
            (64. + lines * pero_theme::UiAppearance::global(cx).typography.code * 1.5)
                .clamp(112., 400.)
        } else {
            self.preview.as_ref().map_or(120., |preview| {
                // Reader toolbar, table filter/header, rows and outer border.
                (94. + 28. * preview.rows.len().max(1) as f32).min(400.)
            })
        };
        let editor_height: DefiniteLength = if workspace {
            relative(1.).into()
        } else {
            px(height - if self.search_open { 66. } else { 34. }).into()
        };
        let toolbar = div()
            .flex()
            .items_center()
            .gap(px(4.))
            .h(px(32.))
            .flex_shrink_0()
            .when(structured, |el| {
                el.child(
                    Button::new("content-preview")
                        .ghost()
                        .small()
                        .label(self.t("content.preview"))
                        .toggled(!self.source)
                        .on_click(cx.listener(|this, _, window, cx| {
                            this.show_preview(window, cx);
                        })),
                )
            })
            .child(
                div()
                    .capture_any_mouse_down(cx.listener(|this, event: &MouseDownEvent, _, cx| {
                        // Kit clears window selection later in this capture phase.
                        // Preserve this gesture's range before the button takes it.
                        this.source_pointer_selection =
                            if event.button == MouseButton::Left && !this.source {
                                this.markdown.as_ref().and_then(|view| {
                                    view.read(cx)
                                        .observed_source_selection(&this.preview_document, cx)
                                })
                            } else {
                                None
                            };
                    }))
                    .child(
                        Button::new("content-source")
                            .ghost()
                            .small()
                            .label(self.t("content.source"))
                            .toggled(self.source)
                            .on_click(cx.listener(|this, event, window, cx| {
                                let captured = this.source_pointer_selection.take();
                                let range = matches!(event, ClickEvent::Mouse(_))
                                    .then_some(captured)
                                    .flatten();
                                let mut before = this.reading_state(cx);
                                let explicit_location = range.is_some();
                                if let Some(range) = &range {
                                    before.selection = range.clone();
                                }
                                this.open_source(range, window, cx);
                                this.focus(window, cx);
                                if explicit_location {
                                    this.finish_navigation(before, cx);
                                }
                            })),
                    ),
            )
            .when(self.source, |el| {
                el.child(
                    Button::new("content-find")
                        .ghost()
                        .small()
                        .label(self.t("content.find"))
                        .on_click(
                            cx.listener(|this, _, window, cx| this.search_source(window, cx)),
                        ),
                )
            })
            .when(!self.path.is_empty() && !self.source, |el| {
                el.child(
                    Button::new("content-back")
                        .ghost()
                        .small()
                        .label(self.t("content.back"))
                        .on_click(cx.listener(|this, _, window, cx| {
                            let before = this.reading_state(cx);
                            this.path.pop();
                            this.refresh_projection(false, window, cx);
                            this.finish_navigation(before, cx);
                            cx.notify();
                        })),
                )
            })
            .when(self.editable(), |el| {
                el.child(
                    Button::new("document-save")
                        .ghost()
                        .small()
                        .label(self.t(if self.saving {
                            "content.saving"
                        } else {
                            "content.save"
                        }))
                        .disabled(!self.dirty || self.saving)
                        .on_click(cx.listener(|this, _, _, cx| this.save(cx))),
                )
            })
            .child(div().flex_1())
            .child(
                div()
                    .text_size(
                        pero_theme::UiAppearance::global(cx).text(pero_theme::TextRole::Caption),
                    )
                    .text_color(cx.theme().muted_foreground)
                    .child(format!("{} B", self.document.bytes)),
            )
            .child(
                Button::new("content-copy")
                    .ghost()
                    .small()
                    .label(self.t(if self.copied {
                        "content.copied"
                    } else {
                        "content.copy"
                    }))
                    .on_click(cx.listener(|this, _, _, cx| {
                        cx.write_to_clipboard(ClipboardItem::new_string(if this.dirty {
                            this.editor.as_ref().unwrap().read(cx).text().to_string()
                        } else {
                            this.document.source().to_owned()
                        }));
                        this.copied = true;
                        cx.notify();
                    })),
            );
        let mut view = div()
            .id("content-reader")
            .track_focus(&self.focus_handle)
            .capture_action(cx.listener(|this, _: &SaveDocument, _, cx| {
                this.save(cx);
                cx.stop_propagation();
            }))
            .capture_action(cx.listener(|this, _: &Search, window, cx| {
                this.search_source(window, cx);
                cx.stop_propagation();
            }))
            .capture_action(cx.listener(|this, _: &Undo, window, cx| {
                this.request_document_undo(false, window, cx)
            }))
            .capture_action(cx.listener(|this, _: &Redo, window, cx| {
                this.request_document_undo(true, window, cx)
            }))
            .capture_action(cx.listener(|this, action: &Enter, window, cx| {
                if this.search_open
                    && this
                        .search_input
                        .read(cx)
                        .focus_handle(cx)
                        .is_focused(window)
                {
                    // Consume submit here: allowing single-line Enter to
                    // propagate also lets Web beforeinput submit it again.
                    this.move_search(action.shift, cx);
                    cx.stop_propagation();
                } else {
                    cx.propagate();
                }
            }))
            .capture_key_down(cx.listener(|this, event: &KeyDownEvent, window, cx| {
                if this.search_open && event.keystroke.key == "escape" {
                    this.close_search(window, cx);
                    cx.stop_propagation();
                }
            }))
            .relative()
            .on_scroll_wheel(cx.listener(|this, _, _, cx| {
                if !this.source {
                    if let Some(markdown) = &this.markdown {
                        markdown.update(cx, |view, cx| view.forget_source_reveal(cx));
                    }
                }
                cx.notify();
            }))
            .child(self.bounds.probe())
            .flex()
            .flex_col()
            .h(px(height))
            .when(workspace, |el| el.flex_1().h_full().min_h_0())
            .w_full()
            .min_w_0()
            .when(!workspace, |el| el.border_1())
            .border_color(cx.theme().border)
            .bg(cx.theme().background)
            .text_color(cx.theme().foreground)
            .when(!inline_markdown, |el| el.child(toolbar))
            .when(self.file_error.is_some(), |el| {
                el.child(
                    div()
                        .p(px(8.))
                        .flex()
                        .items_center()
                        .gap(px(8.))
                        .child(
                            div()
                                .flex_1()
                                .min_w_0()
                                .child(self.t(self.file_error.as_deref().unwrap())),
                        )
                        .child(
                            Button::new("document-reload")
                                .ghost()
                                .small()
                                .label(self.t("content.reload"))
                                .on_click(cx.listener(|this, _, _, cx| {
                                    this.discard = Some(DiscardAction::Reload);
                                    cx.notify();
                                })),
                        ),
                )
            })
            .when(self.discard.is_some(), |el| {
                el.child(
                    div()
                        .p(px(8.))
                        .flex()
                        .items_center()
                        .gap(px(8.))
                        .child(div().flex_1().min_w_0().child(self.t("content.unsaved")))
                        .child(
                            Button::new("document-discard")
                                .ghost()
                                .small()
                                .label(self.t(
                                    if matches!(self.discard, Some(DiscardAction::Reload)) {
                                        "content.discard_reload"
                                    } else {
                                        "content.discard_close"
                                    },
                                ))
                                .on_click(cx.listener(|this, _, _, cx| match this.discard {
                                    Some(DiscardAction::Reload) => cx.emit(ReaderAction::Reload {
                                        path: this.document.id.clone(),
                                    }),
                                    Some(DiscardAction::Close) => {
                                        cx.emit(ReaderAction::DiscardAndClose)
                                    }
                                    None => {}
                                })),
                        )
                        .child(
                            Button::new("document-keep")
                                .ghost()
                                .small()
                                .label(self.t("content.keep_editing"))
                                .on_click(cx.listener(|this, _, _, cx| {
                                    this.discard = None;
                                    cx.notify();
                                })),
                        ),
                )
            })
            .when(inline_markdown, |el| el.h_auto().border_0())
            .when(self.source && self.search_open, |el| {
                el.child(self.search_toolbar(cx))
            })
            .when(
                self.source && self.search_open && self.search_error.is_some(),
                |el| {
                    el.child(
                        div()
                            .px(px(8.))
                            .py(px(4.))
                            .text_size(px(12.))
                            .text_color(cx.theme().danger)
                            .child(self.search_error.clone().unwrap_or_default()),
                    )
                },
            );
        if self.source {
            if let Some(editor) = &self.editor {
                view = view.child(
                    div()
                        .id("content-source-area")
                        .when(workspace, |el| el.flex_1().min_h_0())
                        .child(
                            Editor::new(editor)
                                .bordered(!workspace)
                                .readonly(!self.editable())
                                .aria_label(self.t("content.source"))
                                .h(editor_height),
                        ),
                );
            }
        } else if let Some(markdown) = &self.markdown {
            view = view.child(
                div()
                    .id("content-markdown")
                    .min_w_0()
                    .when(workspace, |el| {
                        el.flex_1()
                            .min_h_0()
                            .overflow_y_scroll()
                            .track_scroll(&self.preview_scroll)
                    })
                    .child(markdown.clone()),
            );
        } else if self.preview_loading {
            view = view.child(div().p(px(12.)).child(self.t("content.preparing_preview")));
        } else {
            match &self.preview {
                Err(error) => {
                    view = view.child(
                        div()
                            .p(px(12.))
                            .text_size(
                                pero_theme::UiAppearance::global(cx)
                                    .text(pero_theme::TextRole::Caption),
                            )
                            .child(error.clone()),
                    )
                }
                Ok(_) => {
                    if let Some(table) = &self.table {
                        view = view.child(table.clone());
                    }
                }
            }
        }
        view
    }
}
