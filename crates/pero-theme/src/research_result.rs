//! Content-first scientific results. Callers own provenance and verification facts.
use crate::{Chrome, SPACE_8, SPACE_12, SPACE_16, TYPE_BODY, TYPE_CAPTION};
use gpui_kit::{base::text::TextViewStyle, prelude::*, *};

/// An unboxed conversation section; the title names the result, never its format.
pub fn research_result(title: impl Into<SharedString>, chrome: Chrome) -> Div {
    div()
        .w_full()
        .min_w_0()
        .flex()
        .flex_col()
        .gap(px(SPACE_8))
        .py(px(SPACE_12))
        .child(
            div()
                .text_size(chrome.text(TYPE_BODY))
                .font_weight(FontWeight::SEMIBOLD)
                .child(title.into()),
        )
}

/// Visible provenance and limitations, distinct from optional execution details.
pub fn research_note(chrome: Chrome) -> Div {
    div()
        .w_full()
        .min_w_0()
        .flex()
        .flex_col()
        .gap(px(4.))
        .pl(px(SPACE_12))
        .border_l_1()
        .border_color(chrome.palette.border)
        .text_size(chrome.text(TYPE_CAPTION))
        .text_color(chrome.palette.text_muted)
}

/// The shared Markdown table keeps selection and horizontal scrolling.
pub fn research_table_style(style: TextViewStyle, chrome: Chrome) -> TextViewStyle {
    let mut table = StyleRefinement::default();
    table.overflow.x = Some(Overflow::Scroll);
    style
        .with_table(table)
        .with_table_head(
            StyleRefinement::default()
                .bg(chrome.palette.surface_muted)
                .text_color(chrome.palette.text_muted)
                .font_weight(FontWeight::MEDIUM),
        )
        .with_table_cell(StyleRefinement::default().whitespace_nowrap().px(px(SPACE_16)).py(px(SPACE_12)))
}
