//! Retained reading state; an editor is mounted only when source is requested.
use pero_contracts::content_document::{ContentDocument, ContentFormat, PreviewShape, StructuredPreview};
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
use std::ops::Range;

pub struct ContentReader {
    pub document: ContentDocument,
    pub locale: String,
    editor: Option<Entity<EditorState>>,
    preview: Result<StructuredPreview, String>,
    source: bool,
    search_open: bool,
    search_input: Entity<InputState>,
    _search_subscription: Subscription,
    case_insensitive: bool,
    path: Vec<Range<usize>>,
    copied: bool,
    window: AnyWindowHandle,
    bounds: crate::view_bounds::ViewBounds,
}

impl ContentReader {
    pub fn new(
        document: ContentDocument,
        locale: String,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        // wasm32-unknown-unknown takes the non-macOS Kit keymap.
        cx.bind_keys([KeyBinding::new("cmd-f", Search, Some("Input"))]);
        let preview = document.preview();
        let source = !matches!(
            document.format,
            ContentFormat::Json | ContentFormat::JsonLines
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
        let mut this = Self {
            document,
            locale,
            editor: None,
            preview,
            source,
            search_open: false,
            search_input,
            _search_subscription: search_subscription,
            case_insensitive: true,
            path: vec![],
            copied: false,
            window: window.window_handle(),
            bounds: Default::default(),
        };
        if source {
            this.open_source(None, window, cx);
        }
        this
    }

    pub fn snapshot(&self, cx: &App) -> serde_json::Value {
        serde_json::json!({"bounds":self.bounds.snapshot(),"id":self.document.id,"revision":self.document.revision,"bytes":self.document.bytes,
            "source":self.source,"editor":self.editor.is_some(),"rows":self.preview.as_ref().map(|p|p.rows.len()).ok(),
            "columns":self.preview.as_ref().map(|p|p.columns.len()).ok(),"error":self.preview.as_ref().err(),
            "selection":self.editor.as_ref().map(|e|e.read(cx).selected_range()),
            "search":self.editor.as_ref().map(|e| {let s=e.read(cx).search_session();serde_json::json!({"open":self.search_open,"query":s.query,"matches":s.matcher.len(),"current":s.matcher.current()})}),
            "foldable":self.editor.as_ref().map(|e|e.read(cx).display_map().is_fold_candidate(0)),
            "cursor":self.editor.as_ref().map(|e|e.read(cx).cursor_position()),
            "folds":self.editor.as_ref().map(|e|e.read(cx).display_map().folded_ranges().len()),
            "language":self.document.language(),
            "editorBytes":self.editor.as_ref().map(|e|e.read(cx).text().len())})
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
        if document.id == self.document.id && document.revision == self.document.revision {
            return;
        }
        self.document = document;
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
                    this.preview = this.document.preview();
                    this.path.clear();
                    this.copied = false;
                    if let Some(editor) = &this.editor {
                        editor.update(cx, |editor, cx| {
                            editor.set_highlighter(this.document.language(), cx);
                            editor.set_value(this.document.source().to_owned(), window, cx)
                        });
                    }
                    cx.notify();
                })
            });
        });
    }

    fn row(&self, index: usize, cx: &mut Context<Self>) -> AnyElement {
        let preview = self
            .preview
            .as_ref()
            .expect("rows only exist in a valid preview");
        let row = &preview.rows[index];
        let properties = preview.shape == PreviewShape::Properties;
        let mut element = div()
            .id(("content-row", index))
            .h(px(pero_theme::UiAppearance::global(cx)
                .typography
                .row_height()))
            .flex()
            .items_center()
            .border_b_1()
            .border_color(cx.theme().border)
            .text_size(pero_theme::UiAppearance::global(cx).text(pero_theme::TextRole::Caption))
            .child(
                div()
                    .w(px(48.))
                    .flex_shrink_0()
                    .text_color(cx.theme().muted_foreground)
                    .child(row.line.to_string()),
            );
        if properties {
            element = element.child(
                div()
                    .w(px(160.))
                    .flex_shrink_0()
                    .truncate()
                    .child(preview.columns[index].clone()),
            );
        }
        for (column, cell) in row.cells.iter().enumerate() {
            let range = cell.clone();
            let raw = range.as_ref().map(|r| self.document.text(r));
            let nested = raw.is_some_and(|value| value.starts_with(['{', '[']));
            let text = raw
                .map(|s| s.chars().take(160).collect::<String>())
                .unwrap_or_else(|| self.t("content.missing").into());
            element = element.child(
                Button::new(("content-cell", column))
                    .ghost()
                    .small()
                    .w(px(if properties { 420. } else { 180. }))
                    .flex_shrink_0()
                    .justify_start()
                    .label(text)
                    .disabled(range.is_none())
                    .on_click(cx.listener(move |this, _, window, cx| {
                        if let Some(range) = &range {
                            if nested {
                                this.preview = this.document.project(range.clone());
                                this.path.push(range.clone());
                                this.copied = false;
                                cx.notify();
                            } else {
                                this.open_source(Some(range.clone()), window, cx);
                            }
                        }
                    })),
            );
        }
        // Later records may introduce columns; absence is a distinct virtual cell.
        if !properties {
            for column in row.cells.len()..preview.columns.len() {
                element = element.child(
                    div()
                        .w(px(180.))
                        .flex_shrink_0()
                        .child(self.t("content.missing"))
                        .id(("missing", column)),
                );
            }
        }
        element.into_any_element()
    }
}

impl Render for ContentReader {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let structured = matches!(
            self.document.format,
            ContentFormat::Json | ContentFormat::JsonLines
        );
        let height = if self.source {
            let lines = self.document.source().lines().take(16).count().max(1) as f32;
            (64. + lines * pero_theme::UiAppearance::global(cx).typography.code * 1.5)
                .clamp(112., 400.)
        } else {
            self.preview.as_ref().map_or(120., |preview| {
                (60. + 28. * preview.rows.len().max(1) as f32).min(400.)
            })
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
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.source = false;
                            cx.notify();
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
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.path.pop();
                            this.preview = this.path.last().map_or_else(
                                || this.document.preview(),
                                |range| this.document.project(range.clone()),
                            );
                            cx.notify();
                        })),
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
                        cx.write_to_clipboard(ClipboardItem::new_string(
                            this.document.source().to_owned(),
                        ));
                        this.copied = true;
                        cx.notify();
                    })),
            );
        let mut view = div()
            .id("content-reader")
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
            .w_full()
            .min_w_0()
            .border_1()
            .border_color(cx.theme().border)
            .bg(cx.theme().background)
            .text_color(cx.theme().foreground)
            .child(toolbar)
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
                    div().id("content-source-area").child(
                        Editor::new(editor)
                            .readonly(true)
                            .aria_label(self.t("content.source"))
                            .h(px(height - if self.search_open { 66. } else { 34. })),
                    ),
                );
            }
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
                Ok(preview) if preview.rows.is_empty() => {
                    view = view.child(div().p(px(12.)).child(self.t("content.empty")))
                }
                Ok(preview) => {
                    let properties = preview.shape == PreviewShape::Properties;
                    let width = if properties {
                        640.
                    } else {
                        48. + 180. * preview.columns.len().max(1) as f32
                    };
                    let header = div()
                        .flex()
                        .h(px(28.))
                        .flex_shrink_0()
                        .text_size(
                            pero_theme::UiAppearance::global(cx)
                                .text(pero_theme::TextRole::Caption),
                        )
                        .child(div().w(px(48.)).flex_shrink_0().child("#"))
                        .children(
                            (!properties)
                                .then_some(&preview.columns)
                                .into_iter()
                                .flatten()
                                .map(|name| {
                                    div()
                                        .w(px(180.))
                                        .flex_shrink_0()
                                        .truncate()
                                        .child(name.clone())
                                }),
                        );
                    let count = preview.rows.len();
                    view = view.child(
                        div()
                            .id("content-grid")
                            .overflow_x_scroll()
                            .flex_1()
                            .min_h_0()
                            .child(
                                div()
                                    .w(px(width))
                                    .h_full()
                                    .flex()
                                    .flex_col()
                                    .child(header)
                                    .child(
                                        uniform_list(
                                            "content-rows",
                                            count,
                                            cx.processor(|this, range: Range<usize>, _, cx| {
                                                range.map(|i| this.row(i, cx)).collect::<Vec<_>>()
                                            }),
                                        )
                                        .flex_1()
                                        .min_h_0(),
                                    ),
                            ),
                    );
                }
            }
        }
        view
    }
}
