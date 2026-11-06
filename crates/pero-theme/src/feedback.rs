//! Shared Native feedback. Hosts own status, recovery commands and disclosure state.
use crate::{Chrome, SPACE_8, SPACE_12, SPACE_16, SPACE_24, TYPE_BODY, TYPE_CAPTION, TYPE_HEADING};
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
