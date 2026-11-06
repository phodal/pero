//! Source and preview controls shared by inline and workspace readers.
use super::*;

impl ContentReader {
    pub(super) fn toolbar(&self, cx: &mut Context<Self>) -> AnyElement {
        let structured = matches!(
            self.document.format,
            ContentFormat::Json | ContentFormat::JsonLines | ContentFormat::Markdown
        );
        div()
            .flex()
            .items_center()
            .gap(px(pero_theme::SPACE_4))
            .h(px(pero_theme::ACTION_BUTTON_HEIGHT))
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
            .when(self.dirty, |el| {
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
                    .text_size(pero_theme::UiAppearance::global(cx).text(pero_theme::TextRole::Caption))
                    .text_color(cx.theme().muted_foreground)
                    .child(format!("{} B", self.document.bytes)),
            )
            .child(
                Button::new("content-copy")
                    .ghost()
                    .small()
                    .accessibility_label(self.t(if self.copied {
                        "content.copied"
                    } else {
                        "content.copy"
                    }))
                    .tooltip(self.t(if self.copied {
                        "content.copied"
                    } else {
                        "content.copy"
                    }))
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
            )
            .into_any_element()
    }
}
