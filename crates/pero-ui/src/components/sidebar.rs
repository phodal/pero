use super::{ActionHandler, Ui, click};
use gpui_kit::{
    component::{button::*, *},
    prelude::*,
    *,
};

pub(crate) struct SidebarProps {
    pub navigation: usize,
    pub connected: bool,
    pub dark: bool,
}
pub(crate) enum SidebarAction {
    Navigate(usize),
    ConfigureGitHub,
    ChooseWorkspace,
    ToggleLocale,
    ToggleTheme,
}
pub(crate) fn sidebar(
    ui: Ui<'_>,
    width: f32,
    props: SidebarProps,
    on_action: ActionHandler<SidebarAction>,
) -> Div {
    let p = ui.palette;
    div()
        .w(px(width))
        .h_full()
        .flex_shrink_0()
        .flex()
        .flex_col()
        .bg(p.color("bg"))
        .border_r_1()
        .border_color(p.color("border"))
        .px(px(12.))
        .py(px(16.))
        .gap(px(4.))
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(10.))
                .px(px(6.))
                .mb(px(8.))
                .child(ui.icon("circle-filled").text_color(p.color("action")))
                .child(
                    div()
                        .text_size(px(18.))
                        .font_weight(FontWeight::BOLD)
                        .child(ui.t("workbench.title")),
                ),
        )
        .child(
            Button::new("workspace-label")
                .outline()
                .label(ui.t("workspace.local"))
                .w_full()
                .h(px(32.))
                .on_click(click(&on_action, SidebarAction::ChooseWorkspace)),
        )
        .children(
            [
                (3, "layout-list", "nav.tasks"),
                (0, "terminal", "nav.sessions"),
                (1, "folder", "nav.projects"),
                (2, "devices", "nav.environments"),
            ]
            .into_iter()
            .map(|(i, icon, label)| {
                div()
                    .id(("nav", i))
                    .flex()
                    .items_center()
                    .gap(px(4.))
                    .px(px(12.))
                    .h(px(32.))
                    .rounded(px(6.))
                    .cursor_pointer()
                    .bg(p.color(if props.navigation == i {
                        "accent-soft"
                    } else {
                        "bg"
                    }))
                    .text_color(p.color(if props.navigation == i {
                        "accent-text"
                    } else {
                        "text-muted"
                    }))
                    .child(ui.icon(icon).text_color(p.color(if props.navigation == i {
                        "accent-text"
                    } else {
                        "text-muted"
                    })))
                    .child(
                        div()
                            .font_weight(if props.navigation == i {
                                FontWeight::BOLD
                            } else {
                                FontWeight::NORMAL
                            })
                            .child(ui.t(label)),
                    )
                    .on_click(click(&on_action, SidebarAction::Navigate(i)))
            }),
        )
        .child(div().flex_1())
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(4.))
                .child(
                    Button::new("language")
                        .ghost()
                        .small()
                        .w(px(32.))
                        .h(px(32.))
                        .icon(Icon::default().path("icons/languages.svg"))
                        .tooltip(format!("{} · 中文 / English", ui.t("menu.language")))
                        .accessibility_label(ui.t("menu.language"))
                        .on_click(click(&on_action, SidebarAction::ToggleLocale)),
                )
                .child(
                    Button::new("theme")
                        .ghost()
                        .small()
                        .w(px(32.))
                        .h(px(32.))
                        .icon(Icon::default().path(if props.dark {
                            "icons/sun.svg"
                        } else {
                            "icons/moon.svg"
                        }))
                        .tooltip(ui.t(if props.dark {
                            "appearance.light"
                        } else {
                            "appearance.dark"
                        }))
                        .accessibility_label(ui.t(if props.dark {
                            "appearance.light"
                        } else {
                            "appearance.dark"
                        }))
                        .on_click(click(&on_action, SidebarAction::ToggleTheme)),
                ),
        )
        .when(props.navigation != 3, |el| {
            el.child(
                Button::new("github-connector")
                    .ghost()
                    .w_full()
                    .label(ui.t("connector.title"))
                    .on_click(click(&on_action, SidebarAction::ConfigureGitHub)),
            )
        })
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(9.))
                .px(px(8.))
                .text_size(px(12.))
                .text_color(p.color("text-muted"))
                .child(ui.icon("devices"))
                .child(ui.t(if props.connected {
                    "status.local_connected"
                } else {
                    "status.disconnected"
                })),
        )
}
