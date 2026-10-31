//! One window title bar. The sidebar and the content sit under it, so the
//! window has a single top edge instead of a bar on each column.
use super::Ui;
use super::sidebar::{self, keep_click, window_drag};
use gpui_kit::component::Icon;
use gpui_kit::{prelude::*, *};

pub(crate) fn window_titlebar(
    ui: Ui<'_>,
    collapsed: bool,
    sidebar_width: f32,
    title: SharedString,
    tabs: Option<AnyElement>,
    on_toggle: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
    on_search: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
    dragging: &Entity<bool>,
    window: &Window,
    cx: &App,
) -> Stateful<Div> {
    let p = ui.palette;
    let chrome = ui.chrome();
    let has_tabs = tabs.is_some();
    let show_title = !has_tabs && !title.is_empty();
    let (toggle_icon, toggle_label) = if collapsed {
        ("icons/panel-left-open.svg", ui.t("sidebar.show"))
    } else {
        ("icons/panel-left-close.svg", ui.t("sidebar.hide"))
    };
    let shortcut = if cfg!(target_os = "macos") {
        "⌘⇧K"
    } else {
        "Ctrl+Shift+K"
    };
    let search_label = format!("{}  {shortcut}", ui.t("spotlight.open"));
    window_drag(
        div()
            .id("window-chrome")
            .h(px(sidebar::WINDOW_CHROME))
            .w_full()
            .flex_shrink_0()
            .flex()
            .items_center()
            .bg(p.surface_muted)
            .border_b_1()
            .border_color(p.border),
        dragging,
        window,
    )
    .child(
        div()
            .id("window-sidebar-chrome")
            .w(px(sidebar_width.max(sidebar::traffic_inset(window) + 36.)))
            .h_full()
            .flex_shrink_0()
            .flex()
            .items_center()
            .justify_end()
            .pl(px(sidebar::traffic_inset(window)))
            .pr(px(8.))
            .border_r_1()
            .border_color(p.border)
            .child(
                keep_click(div()).child(
                    pero_theme::ghost_icon_button("sidebar-toggle", chrome, cx)
                        .icon(Icon::default().path(toggle_icon))
                        .tooltip(toggle_label.to_string())
                        .accessibility_label(toggle_label.to_string())
                        .on_click(on_toggle),
                ),
            ),
    )
    .child(
        div()
            .id("window-content-chrome")
            .flex_1()
            .min_w_0()
            .h_full()
            .flex()
            .items_center()
            .bg(p.bg)
            .pr(px(8.))
            .when_some(tabs, |el, tabs| {
                el.child(keep_click(div()).flex_1().min_w_0().h_full().child(tabs))
            })
            .when(show_title, |el| {
                el.child(
                    div()
                        .min_w_0()
                        .flex_1()
                        .overflow_hidden()
                        .text_ellipsis()
                        .pl(px(12.))
                        .text_size(chrome.text(pero_theme::TYPE_BODY))
                        .text_color(p.text)
                        .child(title),
                )
            })
            .when(!has_tabs && !show_title, |el| el.child(div().flex_1()))
            .child(
                keep_click(div()).child(
                    pero_theme::ghost_icon_button("spotlight-open", chrome, cx)
                        .icon(Icon::default().path("icons/search.svg"))
                        .tooltip(search_label.clone())
                        .accessibility_label(search_label)
                        .on_click(on_search),
                ),
            ),
    )
}
