//! Dataset locations use the root projection's original source spans.
use super::*;
use pero_contracts::content_document::PreviewShape;

impl ContentReader {
    pub fn reveal_record(&mut self, ordinal: usize, window: &mut Window, cx: &mut Context<Self>) {
        self.pending_record = Some(ordinal);
        self.resolve_pending_record_location(window, cx);
    }

    pub(super) fn resolve_pending_record_location(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(ordinal) = self.pending_record else {
            return;
        };
        // The existing root Worker owns large-source parsing. A location never
        // triggers a second synchronous parse, including while a nested node is open.
        let Some(preview) = self.document.cached_preview() else {
            return;
        };
        self.pending_record = None;
        let range = preview.ok().and_then(|preview| {
            if preview.shape == PreviewShape::Properties {
                (ordinal == 0).then_some(0..self.document.bytes)
            } else {
                preview
                    .rows
                    .get(ordinal)
                    .map(|row| row.source.bytes.clone())
            }
        });
        if let Some(range) = range {
            let before = self.reading_state(cx);
            self.open_source(Some(range), window, cx);
            self.focus(window, cx);
            self.finish_navigation(before, cx);
        } else {
            self.file_error = Some(self.t("content.record_missing").into());
            cx.notify();
        }
    }
}
