//! Retained reading state; an editor is mounted only when source is requested.
use gpui_kit::component::Disableable;
use gpui_kit::{
    component::{
        ActiveTheme, IconName, Sizable,
        button::*,
        input::{Editor, EditorState, Input, InputEvent, InputState, RopeExt, Search},
    },
    prelude::*,
    *,
};
use pero_contracts::content_document::{ContentDocument, ContentFormat, StructuredPreview};
use pero_contracts::content_origin::ContentOrigin;
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
    dirty: bool,
    saving: bool,
    file_error: Option<String>,
    discard: Option<DiscardAction>,
    preview: Result<Arc<StructuredPreview>, String>,
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
    case_insensitive: bool,
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
        let preview = document.preview().map(Arc::new);
        let source = !matches!(
            document.format,
            ContentFormat::Json | ContentFormat::JsonLines | ContentFormat::Markdown
        );
        let search_input = cx.new(|cx| InputState::new(window, cx));
        let search_subscription =
            cx.subscribe_in(&search_input, window, |this, input, event, _, cx| {
                if let Some(editor) = &this.editor {
                    editor.update(cx, |editor, cx| match event {
                        InputEvent::Change => editor.set_search_query(
                            input.read(cx).value().to_string(),
                            this.case_insensitive,
                            cx,
                        ),
                        InputEvent::PressEnter { shift, .. } => {
                            if *shift {
                                editor.previous_search_match(cx);
                            } else {
                                editor.next_search_match(cx);
                            }
                        }
                        _ => {}
                    });
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
            dirty: false,
            saving: false,
            file_error: None,
            discard: None,
            preview,
            table: None,
            table_subscription: None,
            markdown,
            markdown_subscription: None,
            preview_scroll: ScrollHandle::new(),
            source,
            search_open: false,
            search_input,
            _search_subscription: search_subscription,
            case_insensitive: true,
            path: vec![],
            copied: false,
            window: window.window_handle(),
            bounds: Default::default(),
            focus_handle: cx.focus_handle(),
        };
        this.sync_table(window, cx);
        if source {
            this.open_source(None, window, cx);
        }
        this
    }

    /// The same reading state fits the workspace instead of an inline result.
    pub fn workspace(mut self, cx: &mut Context<Self>) -> Self {
        self.placement = ReaderPlacement::Workspace;
        self.observe_edits(cx);
        self.observe_links(cx);
        self
    }

    pub fn focus(&self, window: &mut Window, cx: &mut App) {
        if self.search_open {
            self.search_input
                .update(cx, |input, cx| input.focus(window, cx));
        } else if !self.source && self.table.is_some() {
            self.table
                .as_ref()
                .unwrap()
                .update(cx, |table, cx| table.focus(window, cx));
        } else if let Some(editor) = &self.editor {
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
        serde_json::json!({"bounds":self.bounds.snapshot(),"id":self.document.id,"revision":self.document.revision,"bytes":self.document.bytes,
            "dirty":self.dirty,"saving":self.saving,"fileError":self.file_error,"confirmClose":self.discard.is_some(),"editable":self.editable(),"markdown":self.markdown.is_some(),"workspace":self.placement==ReaderPlacement::Workspace,"source":self.source,"editor":self.editor.is_some(),"rows":self.preview.as_ref().map(|p|p.rows.len()).ok(),
            "table":self.table.as_ref().map(|table|table.read(cx).snapshot(cx)),
            "columns":self.preview.as_ref().map(|p|p.columns.len()).ok(),"error":self.preview.as_ref().err(),
            "selection":self.editor.as_ref().map(|e|e.read(cx).selected_range()),
            "search":self.editor.as_ref().map(|e| {let s=e.read(cx).search_session();serde_json::json!({"open":self.search_open,"query":s.query,"matches":s.matcher.len(),"current":s.matcher.current()})}),
            "foldable":self.editor.as_ref().map(|e|e.read(cx).display_map().is_fold_candidate(0)),
            "cursor":self.editor.as_ref().map(|e|e.read(cx).cursor_position()),
            "folds":self.editor.as_ref().map(|e|e.read(cx).display_map().folded_ranges().len()),
            "language":self.document.language(),
            "editorBytes":self.editor.as_ref().map(|e|e.read(cx).text().len())})
    }

    fn observe_links(&mut self, cx: &mut Context<Self>) {
        if self.placement == ReaderPlacement::Workspace && self.markdown_subscription.is_none() {
            if let Some(markdown) = &self.markdown {
                markdown.update(cx, |view, _| view.capture_links = true);
                self.markdown_subscription = Some(cx.subscribe(
                    markdown,
                    |_, _, link: &crate::stream::MarkdownLink, cx| {
                        cx.emit(ReaderAction::Link(link.0.clone()))
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
        if self.editor_subscription.is_none() && self.editable() {
            if let Some(editor) = &self.editor {
                self.editor_subscription = Some(cx.subscribe(editor, |this, editor, event, cx| {
                    if matches!(event, InputEvent::Change) {
                        let text = editor.read(cx).text();
                        this.dirty = text.len() != this.document.bytes
                            || !text.bytes().eq(this.document.source().bytes());
                        this.copied = false;
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
            self.source = false;
            cx.notify();
            return;
        }
        let draft = self.editor.as_ref().filter(|_| self.dirty).map(|editor| {
            self.document
                .header()
                .into_document(editor.read(cx).text().to_string())
        });
        let document = draft.unwrap_or_else(|| self.document.clone());
        self.preview_document = document.clone();
        self.preview = self.preview_document.preview().map(Arc::new);
        self.sync_table(window, cx);
        self.path.clear();
        if let Some(markdown) = &self.markdown {
            markdown.update(cx, |view, cx| view.replace(document.source(), cx));
        }
        self.source = false;
        cx.notify();
    }
    fn t(&self, key: &str) -> &'static str {
        pero_contracts::i18n::text(&self.locale, key)
    }

    fn open_source(
        &mut self,
        range: Option<Range<usize>>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.editor.is_none() {
            let language = self.document.language();
            // Long single-line JSON must not shape a screenful of wrapped text.
            self.editor = Some(cx.new(|cx| {
                EditorState::new(window, cx)
                    .language(language.to_owned())
                    .searchable(true)
                    .soft_wrap(false)
                    .default_value(self.document.source().to_owned())
            }));
        }
        self.observe_edits(cx);
        if let (Some(editor), Some(range)) = (&self.editor, range) {
            editor.update(cx, |editor, cx| {
                let position = editor.text().offset_to_position(range.start);
                editor.unfold_at(position, cx);
                editor.set_cursor_position(position, window, cx);
            });
        }
        self.source = true;
        self.copied = false;
        cx.notify();
    }

    fn search_source(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.search_open = true;
        let seed = self
            .editor
            .as_ref()
            .map(|editor| editor.read(cx).selected_range())
            .filter(|range| !range.is_empty())
            .map(|range| self.document.text(&range).to_owned());
        self.search_input.update(cx, |input, cx| {
            if let Some(seed) = &seed {
                input.set_value(seed.clone(), window, cx);
            }
            input.focus(window, cx);
            input.select_all(window, cx);
        });
        if let (Some(editor), Some(seed)) = (&self.editor, seed) {
            editor.update(cx, |editor, cx| {
                editor.set_search_query(seed, self.case_insensitive, cx)
            });
        }
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
                    this.preview = this.preview_document.preview().map(Arc::new);
                    this.sync_table(window, cx);
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
                    this.observe_links(cx);
                    this.path.clear();
                    this.copied = false;
                    if let Some(editor) = &this.editor {
                        editor.update(cx, |editor, cx| {
                            editor.set_highlighter(this.document.language(), cx);
                            editor.set_value(this.document.source().to_owned(), window, cx)
                        });
                    }
                    if matches!(
                        this.document.format,
                        ContentFormat::Code(_) | ContentFormat::Text
                    ) {
                        this.open_source(None, window, cx);
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
                    let range = &event.0;
                    if this.preview_document.text(range).starts_with(['{', '[']) {
                        this.preview = this.preview_document.project(range.clone()).map(Arc::new);
                        this.path.push(range.clone());
                        this.sync_table(window, cx);
                        this.copied = false;
                        cx.notify();
                    } else {
                        this.open_source(Some(range.clone()), window, cx);
                    }
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
                (60. + 28. * preview.rows.len().max(1) as f32).min(400.)
            })
        };
        let editor_height: DefiniteLength = if workspace {
            relative(1.).into()
        } else {
            px(height - if self.search_open { 66. } else { 34. }).into()
        };
        let no_matches = self
            .editor
            .as_ref()
            .is_none_or(|editor| editor.read(cx).search_session().matcher.is_empty());
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
                Button::new("content-source")
                    .ghost()
                    .small()
                    .label(self.t("content.source"))
                    .toggled(self.source)
                    .on_click(
                        cx.listener(|this, _, window, cx| this.open_source(None, window, cx)),
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
                            this.path.pop();
                            this.preview = this
                                .path
                                .last()
                                .map_or_else(
                                    || this.preview_document.preview(),
                                    |range| this.preview_document.project(range.clone()),
                                )
                                .map(Arc::new);
                            this.sync_table(window, cx);
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
            .capture_key_down(cx.listener(|this, event: &KeyDownEvent, window, cx| {
                if this.search_open && event.keystroke.key == "escape" {
                    this.close_search(window, cx);
                    cx.stop_propagation();
                }
            }))
            .relative()
            .child(self.bounds.probe())
            .flex()
            .flex_col()
            .h(px(height))
            .when(workspace, |el| el.flex_1().h_full())
            .w_full()
            .min_w_0()
            .border_1()
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
                el.child(
                    div()
                        .flex()
                        .items_center()
                        .h(px(32.))
                        .gap(px(4.))
                        .child(Input::new(&self.search_input).small().flex_1())
                        .child(
                            Button::new("content-case")
                                .ghost()
                                .small()
                                .label("Aa")
                                .toggled(!self.case_insensitive)
                                .tooltip(self.t("content.case_sensitive"))
                                .on_click(cx.listener(|this, _, _, cx| {
                                    this.case_insensitive = !this.case_insensitive;
                                    if let Some(editor) = &this.editor {
                                        editor.update(cx, |editor, cx| {
                                            editor.set_search_query(
                                                this.search_input.read(cx).value().to_string(),
                                                this.case_insensitive,
                                                cx,
                                            )
                                        });
                                    }
                                    cx.notify();
                                })),
                        )
                        .child(
                            div().text_size(px(12.)).child(
                                self.editor
                                    .as_ref()
                                    .map(|editor| editor.read(cx).search_session().matcher.label())
                                    .unwrap_or_default(),
                            ),
                        )
                        .child(
                            Button::new("content-prev")
                                .disabled(no_matches)
                                .ghost()
                                .small()
                                .icon(IconName::ChevronLeft)
                                .tooltip(self.t("content.previous_match"))
                                .on_click(cx.listener(|this, _, _, cx| {
                                    if let Some(editor) = &this.editor {
                                        editor.update(cx, |editor, cx| {
                                            editor.previous_search_match(cx);
                                        });
                                    }
                                    cx.notify();
                                })),
                        )
                        .child(
                            Button::new("content-next")
                                .disabled(no_matches)
                                .ghost()
                                .small()
                                .icon(IconName::ChevronRight)
                                .tooltip(self.t("content.next_match"))
                                .on_click(cx.listener(|this, _, _, cx| {
                                    if let Some(editor) = &this.editor {
                                        editor.update(cx, |editor, cx| {
                                            editor.next_search_match(cx);
                                        });
                                    }
                                    cx.notify();
                                })),
                        )
                        .child(
                            Button::new("content-close-find")
                                .ghost()
                                .small()
                                .icon(IconName::Close)
                                .tooltip(self.t("content.close_find"))
                                .on_click(
                                    cx.listener(|this, _, window, cx| {
                                        this.close_search(window, cx)
                                    }),
                                ),
                        ),
                )
            });
        if self.source {
            if let Some(editor) = &self.editor {
                view = view.child(
                    div()
                        .id("content-source-area")
                        .when(workspace, |el| el.flex_1().min_h_0())
                        .child(
                            Editor::new(editor)
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
