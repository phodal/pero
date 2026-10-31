//! One window title bar. The sidebar and the content sit under it, so the
//! window has a single top edge instead of a bar on each column.
use super::sidebar::{self, keep_click, window_drag};
use super::Ui;
use gpui_kit::component::Icon;
use gpui_kit::{prelude::*, *};

pub(crate) fn window_titlebar(
    ui: Ui<'_>,
    collapsed: bool,
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
            .gap(px(pero_theme::ICON_GAP))
            .bg(p.surface_muted)
            .border_b_1()
            .border_color(p.border)
            .pl(px(sidebar::traffic_inset(window)))
            .pr(px(8.)),
        dragging,
        window,
    )
    .child(keep_click(div()).child(
        pero_theme::ghost_icon_button("sidebar-toggle", chrome, cx)
            .icon(Icon::default().path(toggle_icon))
            .tooltip(toggle_label.to_string())
            .accessibility_label(toggle_label.to_string())
            .on_click(on_toggle),
    ))
    .when_some(tabs, |el, tabs| el.child(tabs))
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
    .when(!has_tabs && !show_title, |el| el.child(div().flex_1()))
    .child(keep_click(div()).child(
        pero_theme::ghost_icon_button("spotlight-open", chrome, cx)
            .icon(Icon::default().path("icons/search.svg"))
            .tooltip(search_label.clone())
            .accessibility_label(search_label)
            .on_click(on_search),
    ))
}
