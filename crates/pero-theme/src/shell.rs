//! Workbench chrome. These components own presentation; navigation and window
//! dragging remain in the host. The React shell uses the same design contract.
use crate::{
    Chrome, RADIUS_PANEL, SIDEBAR_GROUP_GAP, SIDEBAR_PADDING, SPACE_4, SPACE_8, TYPE_CAPTION,
    WINDOW_TITLEBAR,
};
use gpui_kit::{prelude::*, *};

/// Flat single-column bar. The workbench titleband is the headers of the
/// columns under it: each segment is that column's primary and actions, at
/// that column's width. It is not a row of global buttons.
pub fn window_bar(
    id: impl Into<ElementId>,
    leading: AnyElement,
    tabs: Option<AnyElement>,
    actions: AnyElement,
    chrome: Chrome,
) -> Stateful<Div> {
    div()
        .id(id)
        .w_full()
        .h(chrome.control(WINDOW_TITLEBAR))
        .flex_shrink_0()
        .flex()
        .items_center()
        .bg(chrome.palette.surface_muted)
        .child(leading)
        .child(
            div()
                .flex_1()
                .min_w_0()
                .h_full()
                .flex()
                .items_center()
                .children(tabs),
        )
        .child(div().flex_shrink_0().pr(chrome.geo(SPACE_8)).child(actions))
}

/// An opaque navigation surface. The page beside it carries the corner and shadow.
pub fn sidebar_surface(id: impl Into<ElementId>, width: f32, chrome: Chrome) -> Stateful<Div> {
    div()
        .id(id)
        .w(px(width))
        .h_full()
        .flex_shrink_0()
        .relative()
        .flex()
        .flex_col()
        .bg(chrome.palette.surface_muted)
        .text_color(chrome.palette.text)
        .p(chrome.geo(SIDEBAR_PADDING))
        .gap(chrome.geo(SPACE_4))
}

/// Room for the shadow halo on the leading and top sides. GPUI rasters a
/// drop shadow out to three blur radii; 4px covers that and the corner.
const EDGE_SHADOW_MARGIN: f32 = 4.;

/// A short lift on the leading and top edges, about 2px. The ink is the border
/// tone, so the seam stays in the same family as the chrome instead of reading
/// as a black cut.
///
/// The shadow box sits 0.5px outside the leading and top edges and is flush
/// with the trailing and bottom edges. [`edge_shadow_plate`] clips the blur
/// past those flush edges, so the leading edge still meets the bottom corner.
pub fn edge_shadow(color: Hsla) -> Vec<BoxShadow> {
    vec![BoxShadow::new(px(-0.25), px(-0.25), color.opacity(0.7))
        .blur_radius(px(0.7))
        .spread_radius(px(0.25))]
}

/// Paints [`edge_shadow`] for a page that fills its relative parent.
pub fn edge_shadow_plate(color: Hsla) -> Div {
    let margin = px(EDGE_SHADOW_MARGIN);
    div()
        .absolute()
        .top(px(-EDGE_SHADOW_MARGIN))
        .left(px(-EDGE_SHADOW_MARGIN))
        .right_0()
        .bottom_0()
        .overflow_hidden()
        .child(
            div()
                .absolute()
                .top(margin)
                .left(margin)
                .right_0()
                .bottom_0()
                .rounded_tl(px(RADIUS_PANEL))
                .shadow(edge_shadow(color)),
        )
}

/// Group related navigation; a separator marks a change of navigation scope,
/// not every item. The compact inset also works in an icon-only sidebar.
pub fn sidebar_group(label: Option<SharedString>, separated: bool, chrome: Chrome) -> Div {
    div()
        .flex()
        .flex_col()
        .gap(chrome.geo(SPACE_4))
        .pt(chrome.geo(if separated { SPACE_8 } else { SIDEBAR_GROUP_GAP }))
        .children(separated.then(|| crate::hairline(chrome).mb(chrome.geo(SPACE_4))))
        .children(label.filter(|label| !label.is_empty()).map(|label| {
            div()
                .px(chrome.geo(SPACE_8))
                .pb(chrome.geo(SPACE_4))
                .text_size(chrome.text(TYPE_CAPTION))
                .text_color(chrome.palette.text_muted)
                .child(label)
        }))
}

/// Workspace tab state. Ordering, dirty-close confirmation and focus belong to the host.
#[derive(Clone, Copy, Default)]
pub struct ContentTabState {
    pub active: bool,
    pub focused: bool,
    pub pinned: bool,
}

/// Same compact tab box in the window bar and in split panes; never stretches to 42px.
pub fn content_tab(
    id: impl Into<ElementId>,
    state: ContentTabState,
    chrome: Chrome,
) -> Stateful<Div> {
    let p = chrome.palette;
    div()
        .id(id)
        .flex()
        .items_center()
        .flex_shrink_0()
        .h(chrome.control(crate::CONTENT_TAB))
        .max_w(px(if state.pinned { 160. } else { 220. }))
        .px(chrome.geo(SPACE_8))
        .gap(chrome.geo(SPACE_4))
        .rounded(chrome.geo(crate::RADIUS_SELECTION))
        .cursor_pointer()
        .bg(if state.active && state.focused {
            p.accent_soft
        } else if state.active {
            p.surface
        } else {
            p.text.opacity(0.)
        })
        .text_color(if state.active && state.focused {
            p.accent_text
        } else if state.active {
            p.text
        } else {
            p.text_muted
        })
        .border_1()
        .border_color(if state.active && state.focused {
            p.action
        } else if state.active {
            p.border
        } else {
            p.text.opacity(0.)
        })
        .when(!state.active, |el| el
            .hover(|el| el.bg(p.surface_hover).text_color(p.text))
            .active(|el| el.bg(p.surface_pressed)))
        .when(state.active && state.focused, |el| el.hover(|el| el.border_color(p.action)))
}

/// Truncation is visual only; the host supplies the full title as the accessible name/tooltip.
pub fn content_tab_label(title: SharedString, preview: bool, chrome: Chrome) -> Div {
    div()
        .flex_1()
        .min_w_0()
        .overflow_hidden()
        .whitespace_nowrap()
        .text_ellipsis()
        .line_height(relative(1.4))
        .text_size(chrome.text(crate::TYPE_TAB))
        .when(preview, |label| label.italic())
        .child(title)
}

/// A smaller glyph keeps editor tabs quiet while the close target stays usable.
pub fn content_tab_close_button(id: impl Into<ElementId>, chrome: Chrome, cx: &App) -> gpui_kit::component::button::Button {
    crate::ghost_icon_button(id, chrome, cx)
        .w(chrome.control(crate::CONTENT_TAB_CLOSE))
        .h(chrome.control(crate::CONTENT_TAB_CLOSE))
        .max_h_full()
}
