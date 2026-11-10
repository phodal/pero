//! Shared Native feedback. Hosts own status, recovery commands and disclosure state.
use crate::{
    Chrome, RADIUS_PANEL, RADIUS_SELECTION, SPACE_8, SPACE_12, SPACE_16, SPACE_20,
    SPACE_24, TYPE_BODY, TYPE_CAPTION, TYPE_HEADING, TYPE_TITLE,
};
use std::time::Duration;

use gpui_kit::{component::Icon, prelude::*, *};

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum FeedbackKind {
    Info,
    Progress,
    Success,
    Warning,
    Error,
}

/// A concise status block. Actions and optional diagnostics can be appended by
/// the host; the block never stretches a recovery button across the surface.
pub fn feedback(
    id: impl Into<ElementId>,
    title: impl Into<SharedString>,
    description: impl Into<SharedString>,
    kind: FeedbackKind,
    chrome: Chrome,
) -> Div {
    let (icon, color) = match kind {
        FeedbackKind::Info => ("icons/info.svg", chrome.palette.info),
        FeedbackKind::Progress => ("icons/loader-circle.svg", chrome.palette.info),
        FeedbackKind::Success => ("icons/circle-check.svg", chrome.palette.success),
        FeedbackKind::Warning => ("icons/circle-alert.svg", chrome.palette.warning),
        FeedbackKind::Error => ("icons/circle-x.svg", chrome.palette.error),
    };
    div()
        .flex().flex_col().items_start().min_w_0().w_full()
        .max_w(px(680.)).gap(chrome.geo(SPACE_12)).p(chrome.geo(SPACE_24))
        .text_color(chrome.palette.text).text_size(chrome.text(TYPE_BODY))
        .child(div().flex().items_start().gap(chrome.geo(SPACE_12)).min_w_0()
            .child(Icon::default().path(icon).size(chrome.text(TYPE_HEADING)).text_color(color))
            .child(div().id(id).flex().flex_col().gap(chrome.geo(SPACE_8)).min_w_0()
                .role(if kind == FeedbackKind::Error { Role::Alert } else { Role::Status })
                .child(div().font_weight(FontWeight::SEMIBOLD)
                    .text_size(chrome.text(TYPE_HEADING)).whitespace_normal().child(title.into()))
                .child(div().text_color(chrome.palette.text_muted)
                    .whitespace_normal().child(description.into()))))
}

/// Full-surface indeterminate progress while an App panel is starting.
/// Centered hero layout: not EmptyState (no empty CTA) and not inline Feedback.
pub fn opening_panel(
    id: impl Into<ElementId>,
    kicker: impl Into<SharedString>,
    title: impl Into<SharedString>,
    description: impl Into<SharedString>,
    chrome: Chrome,
) -> Div {
    let p = chrome.palette;
    div()
        .flex()
        .flex_1()
        .flex_col()
        .items_center()
        .justify_center()
        .min_h_0()
        .min_w_0()
        .w_full()
        .h_full()
        .p(chrome.geo(SPACE_24))
        .child(
            div()
                .id(id)
                .w_full()
                .max_w(px(520.))
                .flex()
                .flex_col()
                .items_center()
                .gap(chrome.geo(SPACE_20))
                .rounded(chrome.geo(RADIUS_PANEL))
                .bg(p.tint_blue_surface)
                .px(chrome.geo(SPACE_24))
                .py(px(48.))
                .role(Role::Status)
                .child(opening_motif(chrome))
                .child(
                    div()
                        .text_size(chrome.text(TYPE_CAPTION))
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(p.tint_blue_text)
                        .text_center()
                        .child(kicker.into()),
                )
                .child(
                    div()
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_size(chrome.text(TYPE_TITLE))
                        .text_color(p.text)
                        .text_center()
                        .whitespace_normal()
                        .child(title.into()),
                )
                .child(
                    div()
                        .max_w(px(360.))
                        .text_size(chrome.text(TYPE_BODY))
                        .text_color(p.text_muted)
                        .text_center()
                        .whitespace_normal()
                        .child(description.into()),
                )
                .child(opening_spinner(chrome)),
        )
}

fn opening_motif(chrome: Chrome) -> Div {
    let p = chrome.palette;
    div()
        .relative()
        .flex()
        .items_center()
        .gap(chrome.geo(SPACE_12))
        .child(opening_tile("icons/clock.svg", 40., chrome))
        .child(opening_connector(chrome))
        .child(
            div()
                .relative()
                .child(opening_tile("icons/layout-grid.svg", 56., chrome))
                .child(
                    div()
                        .absolute()
                        .top(px(-6.))
                        .right(px(-8.))
                        .size(px(22.))
                        .rounded(chrome.geo(RADIUS_SELECTION))
                        .bg(p.surface)
                        .border_1()
                        .border_color(p.border)
                        .flex()
                        .items_center()
                        .justify_center()
                        .with_animation(
                            "opening-sparkle",
                            Animation::new(Duration::from_millis(1400)).repeat(),
                            |mark, delta| {
                                let wave = (delta * std::f32::consts::TAU).sin().abs();
                                mark.opacity(0.4 + 0.6 * wave)
                            },
                        )
                        .child(
                            Icon::default()
                                .path("icons/sparkles.svg")
                                .size(px(12.))
                                .text_color(p.tint_blue_strong),
                        ),
                ),
        )
        .child(opening_connector(chrome))
        .child(opening_tile("icons/file.svg", 40., chrome))
}

/// Linear spin. An ease that settles each turn reads as a pause, which is the
/// frozen state this indicator is meant to avoid.
fn opening_spinner(chrome: Chrome) -> Div {
    div()
        .mt(chrome.geo(SPACE_8))
        .flex()
        .items_center()
        .justify_center()
        .text_color(chrome.palette.info)
        .child(
            Icon::default()
                .path("icons/loader-circle.svg")
                .size(px(22.))
                .with_animation(
                    "opening-spinner",
                    Animation::new(Duration::from_millis(900)).repeat(),
                    |icon, delta| icon.rotate(percentage(delta)),
                ),
        )
}

fn opening_tile(path: &'static str, size: f32, chrome: Chrome) -> Div {
    let p = chrome.palette;
    let icon = (size * 0.42).max(16.);
    div()
        .size(px(size))
        .rounded(chrome.geo(RADIUS_SELECTION))
        .bg(p.surface)
        .border_1()
        .border_color(p.border)
        .flex()
        .items_center()
        .justify_center()
        .shadow(vec![
            BoxShadow::new(px(0.), px(2.), p.text.opacity(0.06)).blur_radius(px(8.)),
        ])
        .child(
            Icon::default()
                .path(path)
                .size(px(icon))
                .text_color(p.tint_blue_text),
        )
}

fn opening_connector(chrome: Chrome) -> Div {
    let color = chrome.palette.tint_blue_soft;
    div()
        .flex()
        .items_center()
        .gap(px(4.))
        .children((0..4).map(move |_| {
            div()
                .size(px(3.))
                .rounded(px(99.))
                .bg(color)
        }))
}

pub fn feedback_actions(actions: impl IntoIterator<Item = AnyElement>, chrome: Chrome) -> Div {
    div().flex().flex_wrap().items_center().gap(chrome.geo(SPACE_8)).children(actions)
}

/// Bounded diagnostic text, shown only when the host's disclosure is open.
pub fn feedback_details(
    id: impl Into<ElementId>,
    details: impl Into<SharedString>,
    chrome: Chrome,
) -> Stateful<Div> {
    div().id(id).w_full().min_w_0().max_h(px(240.))
        .overflow_y_scroll().p(chrome.geo(SPACE_16))
        .bg(chrome.palette.surface_muted).text_color(chrome.palette.text_muted)
        .text_size(chrome.text(TYPE_CAPTION)).whitespace_normal().child(details.into())
}
