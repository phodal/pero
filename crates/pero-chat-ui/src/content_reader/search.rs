//! The source search UI delegates match painting/navigation to Kit.
use super::*;
use pero_contracts::content_search::ContentSearch;

impl ContentReader {
    pub(super) fn apply_search(&mut self, cx: &mut Context<Self>) {
        let Some(editor) = &self.editor else {
            return;
        };
        let query = self.search_input.read(cx).value().to_string();
        let draft = self.dirty.then(|| editor.read(cx).text().to_string());
        let source = draft.as_deref().unwrap_or_else(|| self.document.source());
        let result = ContentSearch::compile(&query, self.search_options)
            .map(|search| search.matches(source));
        let ranges = match result {
            Ok(ranges) => {
                self.search_error = None;
                ranges
            }
            Err(error) => {
                self.search_error = Some(error);
                vec![]
            }
        };
        editor.update(cx, |editor, cx| {
            editor.set_search_matches(query, self.search_options.case_insensitive, ranges, cx)
        });
        cx.notify();
    }
    pub(super) fn move_search(&mut self, previous: bool, cx: &mut Context<Self>) {
        if let Some(editor) = &self.editor {
            editor.update(cx, |editor, cx| {
                if previous {
                    editor.previous_search_match(cx);
                } else {
                    editor.next_search_match(cx);
                }
            });
        }
        cx.notify();
    }
    pub(super) fn search_toolbar(&self, cx: &mut Context<Self>) -> AnyElement {
        let no_matches = self
            .editor
            .as_ref()
            .is_none_or(|editor| editor.read(cx).search_session().matcher.is_empty());
        div()
            .flex()
            .items_center()
            .h(px(32.))
            .gap(px(4.))
            .child(
                Input::new(&self.search_input)
                    .small()
                    .flex_1()
                    .aria_label(self.t("content.find")),
            )
            .child(
                Button::new("content-case")
                    .ghost()
                    .small()
                    .label("Aa")
                    .toggled(!self.search_options.case_insensitive)
                    .tooltip(self.t("content.case_sensitive"))
                    .accessibility_label(self.t("content.case_sensitive"))
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.search_options.case_insensitive =
                            !this.search_options.case_insensitive;
                        this.apply_search(cx);
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
                    .accessibility_label(self.t("content.previous_match"))
                    .on_click(cx.listener(|this, _, _, cx| this.move_search(true, cx))),
            )
            .child(
                Button::new("content-next")
                    .disabled(no_matches)
                    .ghost()
                    .small()
                    .icon(IconName::ChevronRight)
                    .tooltip(self.t("content.next_match"))
                    .accessibility_label(self.t("content.next_match"))
                    .on_click(cx.listener(|this, _, _, cx| this.move_search(false, cx))),
            )
            .child(
                Button::new("content-regex")
                    .ghost()
                    .small()
                    .label(".*")
                    .toggled(self.search_options.regex)
                    .tooltip(self.t("content.regex"))
                    .accessibility_label(self.t("content.regex"))
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.search_options.regex = !this.search_options.regex;
                        this.apply_search(cx);
                    })),
            )
            .child(
                Button::new("content-whole-word")
                    .ghost()
                    .small()
                    .label("ab")
                    .toggled(self.search_options.whole_word)
                    .tooltip(self.t("content.whole_word"))
                    .accessibility_label(self.t("content.whole_word"))
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.search_options.whole_word = !this.search_options.whole_word;
                        this.apply_search(cx);
                    })),
            )
            .child(
                Button::new("content-close-find")
                    .ghost()
                    .small()
                    .icon(IconName::Close)
                    .tooltip(self.t("content.close_find"))
                    .accessibility_label(self.t("content.close_find"))
                    .on_click(cx.listener(|this, _, window, cx| this.close_search(window, cx))),
            )
            .into_any_element()
    }
}
