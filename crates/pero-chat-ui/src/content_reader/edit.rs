//! Actual editor mutations cross document views without rebuilding the buffer.
use super::*;

impl ContentReader {
    pub fn document_transaction(
        &mut self,
        begin: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if begin && self.editor.is_none() {
            let source = self.source;
            self.open_source(None, window, cx);
            self.source = source;
        }
        if let Some(editor) = &self.editor {
            editor.update(cx, |editor, _| editor.set_external_transaction(begin));
        }
    }
    pub fn apply_shared_edit(
        &mut self,
        range: Range<usize>,
        inserted: String,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.apply_document_mutation(range, inserted, false, window, cx);
    }
    pub fn apply_document_edit(
        &mut self,
        range: Range<usize>,
        inserted: String,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.apply_document_mutation(range, inserted, true, window, cx);
    }
    fn apply_document_mutation(
        &mut self,
        range: Range<usize>,
        inserted: String,
        record: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let source = self.source;
        self.open_source(None, window, cx);
        self.source = source;
        if let Some(editor) = &self.editor {
            editor.update(cx, |editor, cx| {
                if record {
                    editor.record_external_edit(range, &inserted, window, cx);
                } else {
                    editor.apply_external_edit(range, &inserted, window, cx);
                }
            });
            let text = editor.read(cx).text();
            self.dirty = text.len() != self.document.bytes
                || !text.bytes().eq(self.document.source().bytes());
        }
        self.copied = false;
        if self.search_open {
            self.apply_search(cx);
        }
        cx.notify();
    }
    pub fn undo_document(&mut self, redo: bool, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(editor) = &self.editor {
            editor.update(cx, |editor, cx| {
                editor.replay_document_history(!redo, window, cx)
            });
        }
    }
    pub(super) fn request_document_undo(
        &mut self,
        redo: bool,
        window: &Window,
        cx: &mut Context<Self>,
    ) {
        if self.placement == ReaderPlacement::Workspace
            && self.source
            && self
                .editor
                .as_ref()
                .is_some_and(|editor| editor.read(cx).focus_handle(cx).is_focused(window))
        {
            cx.emit(ReaderAction::Undo { redo });
            cx.stop_propagation();
        } else {
            cx.propagate();
        }
    }
}
