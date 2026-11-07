//! Shared read-only unified comparison, with source coordinates and semantic tones.
use gpui_kit::{component::*, prelude::*, *};
use pero_contracts::workspace_changes::{DiffLineKind, FileComparison};

pub fn unified_comparison(
    comparison: &FileComparison,
    limit_label: impl Into<SharedString>,
    cx: &App,
) -> AnyElement {
    let appearance = pero_theme::UiAppearance::global(cx);
    let p = &appearance.palette;
    let code = appearance.typography.code;
    let lines = comparison.lines();
    div()
        .flex()
        .flex_col()
        .min_w_0()
        .w_full()
        .text_size(px(code))
        .font_family(cx.theme().mono_font_family.clone())
        .children(lines.iter().take(5000).map(|line| {
            let bg = match line.kind {
                DiffLineKind::Added => p.success_bg,
                DiffLineKind::Deleted => p.error_bg,
                _ => p.surface,
            };
            div()
                .flex()
                .items_start()
                .min_h(px(code * 1.5))
                .bg(bg)
                .gap(px(8.))
                .px(px(8.))
                .child(
                    div()
                        .w(px(code * 3.5))
                        .flex_shrink_0()
                        .text_color(p.text_muted)
                        .child(line.old.map(|n| n.to_string()).unwrap_or_default()),
                )
                .child(
                    div()
                        .w(px(code * 3.5))
                        .flex_shrink_0()
                        .text_color(p.text_muted)
                        .child(line.new.map(|n| n.to_string()).unwrap_or_default()),
                )
                .child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .whitespace_normal()
                        .child(line.text.clone()),
                )
        }))
        .when(lines.len() > 5000, |el| {
            el.child(div().p(px(12.)).child(limit_label.into()))
        })
        .into_any_element()
}
