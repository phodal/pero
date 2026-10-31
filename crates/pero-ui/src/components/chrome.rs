//! The two content headers. An open sidebar keeps the split header. A collapsed
//! rail shares one title bar with the content: the sidebar surface, one bottom
//! edge, the expand control, and the current session or app.
use super::sidebar::{self, keep_click, window_drag};
use super::Ui;
use gpui_kit::component::Icon;
use gpui_kit::{prelude::*, *};

pub(crate) fn expanded_content_chrome(
    tabs: Option<AnyElement>,
    dragging: &Entity<bool>,
    background: Hsla,
    border: Hsla,
    window: &Window,
) -> Stateful<Div> {
    let ruled = tabs.is_none();
    window_drag(
        div()
            .id("content-chrome")
            .h(px(sidebar::WINDOW_CHROME))
            .w_full()
            .flex_shrink_0()
            .flex()
            .items_center()
            .bg(background)
            .when(ruled, |el| el.border_b_1().border_color(border)),
        dragging,
        window,
    )
    .when_some(tabs, |el, tabs| el.child(tabs))
}

pub(crate) fn collapsed_titlebar(
    ui: Ui<'_>,
    title: SharedString,
    tabs: Option<AnyElement>,
    on_expand: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
    dragging: &Entity<bool>,
    window: &Window,
    cx: &App,
) -> Stateful<Div> {
    let p = ui.palette;
    let chrome = ui.chrome();
    let spill = (sidebar::traffic_inset(window) - crate::layout::SIDEBAR_RAIL).max(0.);
    let show_title = tabs.is_none() && !title.is_empty();
    window_drag(
        div()
            .id("content-chrome")
            .h(px(sidebar::WINDOW_CHROME))
            .w_full()
            .flex_shrink_0()
            .flex()
            .items_center()
            .gap(px(pero_theme::ICON_GAP))
            .bg(p.surface_muted)
            .border_b_1()
            .border_color(p.border)
            .pr(px(12.)),
        dragging,
        window,
    )
    .child(div().w(px(spill)).h_full().flex_shrink_0())
    .child(keep_click(div()).child(
        pero_theme::ghost_icon_button("sidebar-expand", chrome, cx)
            .icon(Icon::default().path("icons/panel-left-open.svg"))
            .tooltip(ui.t("sidebar.show"))
            .accessibility_label(ui.t("sidebar.show"))
            .on_click(on_expand),
    ))
    .when(show_title, |el| {
        el.child(
            div()
                .min_w_0()
                .flex_1()
                .overflow_hidden()
                .text_ellipsis()
                .text_size(chrome.text(pero_theme::TYPE_BODY))
                .text_color(p.text)
                .child(title),
        )
    })
    .when_some(tabs, |el, tabs| el.child(tabs))
}
