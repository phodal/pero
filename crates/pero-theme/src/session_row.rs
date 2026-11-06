//! Compact conversation navigation. State and actions belong to the consumer.
use crate::{Chrome, RADIUS_BUTTON, SESSION_ROW, SPACE_4, SPACE_8, TYPE_TAB};
use gpui_kit::{
    component::{button::*, *},
    prelude::*,
    *,
};

/// Navigation and trailing actions are independent sibling buttons. An action
/// slot stays keyboard reachable even when visually disclosed only on hover.
pub fn session_row(
    id: impl Into<ElementId>,
    title: impl Into<SharedString>,
    accessible: impl Into<SharedString>,
    selected: bool,
    status: Option<AnyElement>,
    actions: Option<AnyElement>,
    chrome: Chrome,
    cx: &App,
    on_select: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
) -> Stateful<Div> {
    let p = chrome.palette;
    let title = title.into();
    let trailing_padding = if actions.is_some() {
        px(0.)
    } else {
        chrome.geo(SPACE_8)
    };
    div()
        .id(id)
        .group("session-row")
        .w_full()
        .h(chrome.control(SESSION_ROW))
        .flex_shrink_0()
        .flex()
        .items_center()
        .rounded(chrome.geo(RADIUS_BUTTON))
        .bg(if selected {
            p.surface_muted
        } else {
            p.text.opacity(0.)
        })
        .when(!selected, |el| el.hover(|el| el.bg(p.surface_hover)))
        .child(
            Button::new("session-title")
                .custom(
                    ButtonCustomVariant::new(cx)
                        .foreground(p.text)
                        .hover(p.text.opacity(0.))
                        .active(if selected {
                            p.surface_muted
                        } else {
                            p.surface_pressed
                        }),
                )
                .selected(selected)
                .small()
                .h_full()
                .flex_1()
                .min_w_0()
                .pl(chrome.geo(SPACE_8))
                .pr(trailing_padding)
                .rounded(chrome.geo(RADIUS_BUTTON))
                .border_1()
                .border_color(p.text.opacity(0.))
                .text_size(chrome.text(TYPE_TAB))
                .font_weight(FontWeight::NORMAL)
                .accessibility_label(accessible)
                .tooltip(title.clone())
                .child(
                    div()
                        .w_full()
                        .flex()
                        .items_center()
                        .gap(chrome.geo(SPACE_8))
                        .child(div().flex_1().min_w_0().text_ellipsis().child(title))
                        .children(status.map(|status| {
                            div()
                                .size(chrome.geo(crate::SESSION_STATUS))
                                .flex_shrink_0()
                                .flex()
                                .items_center()
                                .justify_center()
                                .child(status)
                        })),
                )
                .on_click(on_select),
        )
        .children(
            actions.map(|actions| div().flex_shrink_0().pr(chrome.geo(SPACE_4)).child(actions)),
        )
}

/// Apply to the action slot, not to the button, so the pointer can still find it.
/// Focus within the slot and a held-open menu also disclose the action.
pub fn session_actions(
    id: impl Into<ElementId>,
    held: bool,
    child: impl IntoElement,
) -> impl IntoElement {
    SessionActions {
        id: id.into(),
        held,
        child: child.into_any_element(),
    }
}

#[derive(gpui_kit::IntoElement)]
struct SessionActions {
    id: ElementId,
    held: bool,
    child: AnyElement,
}
impl RenderOnce for SessionActions {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let state = window.use_keyed_state(self.id.clone(), cx, |window, cx| {
            let focus = cx.focus_handle().tab_stop(false);
            let entered = cx.on_focus_in(&focus, window, |_, window, _| window.refresh());
            let left = cx.on_focus_out(&focus, window, |_, _, window, _| window.refresh());
            SessionActionFocus {
                focus,
                _subscriptions: vec![entered, left],
            }
        });
        let focus = state.read(cx).focus.clone();
        let disclosed = self.held || focus.contains_focused(window, cx);
        div()
            .id(self.id)
            .track_focus(&focus)
            .opacity(if disclosed { 1. } else { 0. })
            .group_hover("session-row", |el| el.opacity(1.))
            .child(self.child)
    }
}

/// Stable project identity uses readable theme foregrounds, never status colors.
pub fn project_accent(key: &str, chrome: Chrome) -> Hsla {
    let hash = key.bytes().fold(0_u32, |hash, byte| {
        hash.wrapping_mul(31).wrapping_add(byte.into())
    });
    match hash % 3 {
        0 => chrome.palette.tint_blue_text,
        1 => chrome.palette.tint_apricot_text,
        _ => chrome.palette.accent_text,
    }
}

struct SessionActionFocus {
    focus: FocusHandle,
    _subscriptions: Vec<Subscription>,
}
