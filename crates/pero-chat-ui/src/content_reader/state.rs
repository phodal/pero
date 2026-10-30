//! A view exports values; the workspace/Host owns persistence and recovery.
use super::*;

impl ContentReader {
    pub fn reading_state(&self, cx: &App) -> ReaderState {
        let mut state = self.deferred_editor_state.clone().unwrap_or_default();
        state.source = self.source;
        state.query = self.search_input.read(cx).value().to_string();
        state.search = self.search_options;
        state.search_open = self.search_open;
        state.path = self.path.clone();
        state.preview_reveal = self
            .markdown
            .as_ref()
            .filter(|_| !self.source)
            .and_then(|view| view.read(cx).source_reveal());
        let offset = self.preview_scroll.offset();
        state.preview_scroll = [f32::from(offset.x), f32::from(offset.y)];
        if let Some(editor) = &self.editor {
            let editor = editor.read(cx);
            let offset = editor.scroll_offset();
            state.scroll = [f32::from(offset.x), f32::from(offset.y)];
            state.selection = editor.selected_range();
            state.folded_lines = if self.pending_folded_lines.is_empty() {
                editor
                    .display_map()
                    .folded_ranges()
                    .iter()
                    .map(|range| range.start_line)
                    .collect()
            } else {
                self.pending_folded_lines.clone()
            };
        }
        if !self.source {
            if let Some(range) = self.markdown.as_ref().and_then(|view| {
                view.read(cx)
                    .selected_source_range(&self.preview_document, cx)
            }) {
                state.selection = range;
            }
        }
        state
    }
    pub fn restore_reading_state(
        &mut self,
        state: ReaderState,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let draft = self.draft(cx);
        let state = state.for_source(draft.as_deref().unwrap_or_else(|| self.document.source()));
        self.pending_anchor = None;
        self.source_pointer_selection = None;
        if self.dirty {
            self.refresh_preview(window, cx);
        }
        self.search_options = state.search;
        self.search_open = state.search_open;
        self.search_input.update(cx, |input, cx| {
            input.set_value(state.query.clone(), window, cx)
        });
        self.path = state.path.clone();
        self.refresh_projection(false, window, cx);
        self.preview_scroll.set_offset(point(
            px(state.preview_scroll[0]),
            px(state.preview_scroll[1]),
        ));
        let source = state.source
            || !matches!(
                self.document.format,
                ContentFormat::Json | ContentFormat::JsonLines | ContentFormat::Markdown
            );
        if source || self.editor.is_some() {
            self.open_source(None, window, cx);
            self.apply_editor_state(&state, cx);
        } else {
            self.deferred_editor_state = Some(state.clone());
        }
        self.source = source;
        if let Some(markdown) = &self.markdown {
            let reveal = (!source).then_some(state.preview_reveal).flatten();
            markdown.update(cx, |view, cx| {
                view.restore_source_reveal(&self.preview_document, reveal, cx)
            });
        }
        cx.notify();
    }
    pub(super) fn finish_navigation(&mut self, before: ReaderState, cx: &mut Context<Self>) {
        if self.placement == ReaderPlacement::Workspace {
            let after = self.reading_state(cx);
            if !before.same_location(&after) {
                cx.emit(ReaderAction::Navigate { before, after });
            }
        }
    }
    fn apply_editor_state(&mut self, state: &ReaderState, cx: &mut Context<Self>) {
        if let Some(editor) = self.editor.clone() {
            editor.update(cx, |editor, cx| {
                editor.set_selected_range(state.selection.clone(), cx);
                editor.set_scroll_offset(point(px(state.scroll[0]), px(state.scroll[1])), cx);
                if state.folded_lines.is_empty() {
                    editor.set_folded_lines(&[], cx);
                }
            });
            self.pending_folded_lines = state.folded_lines.clone();
            self.restore_folded_lines(cx);
            if state.search_open {
                self.apply_search(cx);
            } else {
                editor.update(cx, |editor, cx| editor.close_search(cx));
            }
        }
    }
    pub(super) fn apply_deferred_editor_state(&mut self, cx: &mut Context<Self>) {
        if let Some(state) = self.deferred_editor_state.take() {
            self.apply_editor_state(&state, cx);
        }
    }
    pub(super) fn observe_editor(&mut self, cx: &mut Context<Self>) {
        if self.editor_observer.is_none() {
            if let Some(editor) = &self.editor {
                self.editor_observer = Some(cx.observe(editor, |this, _, cx| {
                    this.restore_folded_lines(cx);
                    cx.notify();
                }));
            }
        }
    }
    fn restore_folded_lines(&mut self, cx: &mut Context<Self>) {
        if self.pending_folded_lines.is_empty() {
            return;
        }
        if let Some(editor) = &self.editor {
            if self
                .pending_folded_lines
                .iter()
                .all(|&line| editor.read(cx).display_map().is_fold_candidate(line))
            {
                let lines = std::mem::take(&mut self.pending_folded_lines);
                editor.update(cx, |editor, cx| editor.set_folded_lines(&lines, cx));
            }
        }
    }
    pub fn draft(&self, cx: &App) -> Option<String> {
        self.dirty
            .then(|| {
                self.editor
                    .as_ref()
                    .map(|editor| editor.read(cx).text().to_string())
            })
            .flatten()
    }
    pub fn restore_draft(&mut self, text: String, window: &mut Window, cx: &mut Context<Self>) {
        if !self.editable() {
            return;
        }
        self.open_source(None, window, cx);
        if let Some(editor) = &self.editor {
            editor.update(cx, |editor, cx| editor.set_value(text, window, cx));
        }
        self.dirty = self
            .editor
            .as_ref()
            .is_some_and(|editor| editor.read(cx).text().to_string() != self.document.source());
        self.saving = false;
        self.copied = false;
        cx.notify();
    }
    pub fn follow_anchor(
        &mut self,
        fragment: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        if !matches!(self.document.format, ContentFormat::Markdown) {
            return false;
        }
        let before = self.reading_state(cx);
        self.show_preview(window, cx);
        let index = self
            .markdown_index
            .get_or_insert_with(|| MarkdownSource::parse(self.preview_document.source()));
        let Some(range) = index.anchor(fragment) else {
            return false;
        };
        self.pending_anchor = Some(range.clone());
        if let Some(editor) = &self.editor {
            editor.update(cx, |editor, cx| {
                editor.set_selected_range(range.clone(), cx)
            });
        } else {
            self.deferred_editor_state
                .get_or_insert_with(ReaderState::default)
                .selection = range.clone();
        }
        if let Some(markdown) = &self.markdown {
            markdown.update(cx, |view, cx| {
                view.reveal_source(&self.preview_document, range, cx)
            });
        }
        self.source = false;
        self.finish_navigation(before, cx);
        cx.notify();
        true
    }
    pub(super) fn reveal_markdown_selection(&mut self, cx: &mut Context<Self>) {
        let (Some(markdown), Some(editor)) = (&self.markdown, &self.editor) else {
            return;
        };
        let mut range = editor.read(cx).selected_range();
        let source = self.preview_document.source();
        let text = editor.read(cx).text();
        if text.len() != source.len() || !text.bytes().eq(source.bytes()) {
            return;
        }
        if range.is_empty() {
            let cursor = range.start.min(source.len());
            let start = source[..cursor].rfind('\n').map_or(0, |offset| offset + 1);
            let end = source[cursor..]
                .find('\n')
                .map_or(source.len(), |offset| cursor + offset);
            range = start..end;
        }
        markdown.update(cx, |view, cx| {
            view.reveal_source(&self.preview_document, range, cx)
        });
    }
}
