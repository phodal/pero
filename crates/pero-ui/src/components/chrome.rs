//! Host behavior for the shared window bar: native dragging, sidebar and search.
use super::Ui;
use super::sidebar::{self, keep_click, window_drag};
use gpui_kit::component::Icon;
use gpui_kit::{prelude::*, *};

pub(crate) fn window_titlebar(
    ui: Ui<'_>,
    collapsed: bool,
    sidebar_width: f32,
    tabs: Option<AnyElement>,
    on_toggle: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
    on_search: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
    dragging: &Entity<bool>,
    window: &Window,
    cx: &App,
) -> Stateful<Div> {
    let chrome = ui.chrome();
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
    let leading = div()
        .id("window-sidebar-chrome")
        .w(px(sidebar_width.max(sidebar::traffic_inset(window) + 36.)))
        .h_full()
        .flex_shrink_0()
        .flex()
        .items_center()
        .justify_end()
        .pl(px(sidebar::traffic_inset(window)))
        .pr(chrome.geo(pero_theme::SPACE_8))
        .child(
            keep_click(div()).child(
                pero_theme::ghost_icon_button("sidebar-toggle", chrome, cx)
                    .icon(Icon::default().path(toggle_icon))
                    .tooltip(toggle_label)
                    .accessibility_label(toggle_label)
                    .on_click(on_toggle),
            ),
        );
    let actions = keep_click(div()).child(
        pero_theme::ghost_icon_button("spotlight-open", chrome, cx)
            .icon(Icon::default().path("icons/search.svg"))
            .tooltip(search_label.clone())
            .accessibility_label(search_label)
            .on_click(on_search),
    );
    window_drag(
        pero_theme::window_bar(
            "window-chrome",
            leading.into_any_element(),
            tabs,
            actions.into_any_element(),
            chrome,
        ),
        dragging,
        window,
    )
}
