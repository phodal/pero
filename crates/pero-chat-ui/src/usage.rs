//! Compact display of measurements already normalized by Host.
use crate::theme::Palette;
use gpui_kit::{
    component::{Sizable, button::*, popover::Popover},
    prelude::*,
    *,
};
use pero_contracts::{i18n::text, usage::SessionUsage};

pub fn render_usage(usage: &SessionUsage, locale: &str, palette: &Palette, cx: &App) -> impl IntoElement {
    let context_label = text(locale, "chat.usage_context");
    let summary = usage
        .context_ratio()
        .map(|ratio| format!("{context_label} {:.0}%", ratio * 100.0))
        .unwrap_or_else(|| text(locale, "chat.usage").into());
    let mut rows = Vec::new();
    if let Some(used) = usage.context_used {
        let context = usage
            .context_capacity
            .map(|capacity| format!("{used} / {capacity}"))
            .unwrap_or_else(|| used.to_string());
        rows.push(format!("{context_label}: {context}"));
    }
    if let Some(tokens) = usage.input_tokens {
        rows.push(format!("{}: {tokens}", text(locale, "chat.usage_input")));
    }
    if let Some(tokens) = usage.output_tokens {
        rows.push(format!("{}: {tokens}", text(locale, "chat.usage_output")));
    }
    if let Some(cost) = &usage.cost {
        rows.push(format!(
            "{}: {:.4} {}",
            text(locale, "chat.usage_cost"),
            cost.amount,
            cost.currency
        ));
    }
    div()
        .id("chat-usage-row")
        .px(px(16.))
        .pb(px(4.))
        .text_size(pero_theme::UiAppearance::global(cx).text(pero_theme::TextRole::Caption))
        .text_color(palette.text_muted)
        .child(
            Popover::new("chat-usage")
                .trigger(
                    Button::new("chat-usage-trigger")
                        .ghost()
                        .small()
                        .label(summary)
                        .accessibility_label(text(locale, "chat.usage")),
                )
                .flex()
                .flex_col()
                .gap(px(6.))
                .max_w(px(320.))
                .text_size(pero_theme::UiAppearance::global(cx).text(pero_theme::TextRole::Caption))
                .children(rows.into_iter().map(|row| div().child(row))),
        )
}
