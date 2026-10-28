use super::{ActionHandler, Ui, click};
use gpui_kit::{
    component::{button::*, *},
    prelude::*,
    *,
};

/// Cloud facts the sidebar keeps visible on every screen.
pub(crate) struct CloudSummary {
    pub configured: bool,
    pub host: String,
    pub identity: String,
    pub error: bool,
    pub attention: usize,
    pub running: usize,
    pub workers: usize,
}
pub(crate) struct SidebarProps {
    pub navigation: usize,
    pub connection_open: bool,
    pub local_connected: bool,
    pub dark: bool,
    pub cloud: CloudSummary,
}
pub(crate) enum SidebarAction {
    Navigate(usize),
    ConfigureCloud,
    ToggleLocale,
    ToggleTheme,
}

struct NavItem {
    id: usize,
    icon: &'static str,
    label: &'static str,
    /// Count and whether it asks for the user's attention.
    count: Option<(usize, bool)>,
    active: bool,
}

fn nav_item(
    ui: Ui<'_>,
    item: NavItem,
    on_action: &ActionHandler<SidebarAction>,
    action: SidebarAction,
) -> Stateful<Div> {
    let p = ui.palette;
    let active = item.active;
    let fg = p.color(if active { "accent-text" } else { "text-muted" });
    div()
        .id(("nav", item.id))
        .flex()
        .items_center()
        .gap(px(10.))
        .h(px(34.))
        .px(px(10.))
        .rounded(px(6.))
        .cursor_pointer()
        .when(active, |el| el.bg(p.color("accent-soft")))
        .when(!active, |el| el.hover(|el| el.bg(p.color("surface-muted"))))
        .role(Role::Button)
        .aria_label(ui.t(item.label))
        .child(ui.icon(item.icon).size(px(16.)).text_color(fg))
        .child(
            div()
                .flex_1()
                .min_w_0()
                .truncate()
                .when(active, |el| el.font_weight(FontWeight::SEMIBOLD))
                .text_color(p.color(if active { "accent-text" } else { "text" }))
                .child(ui.t(item.label)),
        )
        .when_some(item.count.filter(|(n, _)| *n > 0), |el, (n, alert)| {
            el.child(
                div()
                    .min_w(px(18.))
                    .h(px(18.))
                    .px(px(5.))
                    .rounded_full()
                    .flex()
                    .items_center()
                    .justify_center()
                    .text_size(px(11.))
                    .font_weight(FontWeight::SEMIBOLD)
                    .bg(p.color(if alert { "action" } else { "surface-muted" }))
                    .text_color(p.color(if alert { "on-action" } else { "text-muted" }))
                    .child(n.to_string()),
            )
        })
        .on_click(click(on_action, action))
}

pub(crate) fn sidebar(
    ui: Ui<'_>,
    width: f32,
    props: SidebarProps,
    on_action: ActionHandler<SidebarAction>,
) -> Div {
    let p = ui.palette;
    let cloud = &props.cloud;
    let group_label = |key: &str| {
        div()
            .px(px(10.))
            .pt(px(14.))
            .pb(px(4.))
            .text_size(px(11.))
            .font_weight(FontWeight::SEMIBOLD)
            .text_color(p.color("text-muted"))
            .child(ui.t(key))
    };
    let status_color = if !cloud.configured {
        "text-muted"
    } else if cloud.error {
        "warning"
    } else {
        "success"
    };
    let (host, identity) = if cloud.configured {
        (cloud.host.clone(), cloud.identity.clone())
    } else {
        (
            ui.t("cloud.not_connected").to_string(),
            ui.t("cloud.connect_hint").to_string(),
        )
    };
    let cloud_tasks = props.navigation == 3 && !props.connection_open;
    div()
        .w(px(width))
        .h_full()
        .flex_shrink_0()
        .flex()
        .flex_col()
        .bg(p.color("bg"))
        .border_r_1()
        .border_color(p.color("border"))
        .px(px(10.))
        .pt(px(10.))
        .pb(px(14.))
        .child(
            div()
                .id("cloud-status")
                .flex()
                .items_center()
                .gap(px(8.))
                .p(px(8.))
                .mb(px(4.))
                .rounded(px(8.))
                .border_1()
                .border_color(p.color("border"))
                .bg(p.color("surface"))
                .cursor_pointer()
                .hover(|el| el.bg(p.color("surface-muted")))
                .role(Role::Button)
                .aria_label(format!("{host} · {identity}"))
                .child(
                    div()
                        .size(px(8.))
                        .flex_shrink_0()
                        .rounded_full()
                        .bg(p.color(status_color)),
                )
                .child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .flex()
                        .flex_col()
                        .child(
                            div()
                                .truncate()
                                .font_weight(FontWeight::SEMIBOLD)
                                .child(host),
                        )
                        .child(
                            div()
                                .truncate()
                                .text_size(px(12.))
                                .text_color(p.color("text-muted"))
                                .child(identity),
                        ),
                )
                .on_click(click(&on_action, SidebarAction::ConfigureCloud)),
        )
        .child(group_label("nav.group.cloud"))
        .child(nav_item(
            ui,
            NavItem {
                id: 3,
                icon: "layout-list",
                label: "nav.tasks",
                count: Some((cloud.attention, true)),
                active: cloud_tasks,
            },
            &on_action,
            SidebarAction::Navigate(3),
        ))
        .child(nav_item(
            ui,
            NavItem {
                id: 5,
                icon: "server",
                label: "nav.workers",
                count: Some((cloud.workers, false)),
                active: props.navigation == 5,
            },
            &on_action,
            SidebarAction::Navigate(5),
        ))
        .child(nav_item(
            ui,
            NavItem {
                id: 6,
                icon: "brand-github",
                label: "nav.sources",
                count: None,
                active: props.navigation == 3 && props.connection_open,
            },
            &on_action,
            SidebarAction::ConfigureCloud,
        ))
        .child(group_label("nav.group.local"))
        .children(
            [
                (0, "terminal", "nav.sessions"),
                (1, "folder", "nav.projects"),
                (2, "devices", "nav.environments"),
                (7, "file-code", "nav.apps"),
            ]
            .into_iter()
            .map(|(id, icon, label)| {
                nav_item(
                    ui,
                    NavItem {
                        id,
                        icon,
                        label,
                        count: None,
                        active: props.navigation == id,
                    },
                    &on_action,
                    SidebarAction::Navigate(id),
                )
            }),
        )
        .child(div().flex_1())
        .when(cloud.configured, |el| {
            el.child(
                div()
                    .px(px(8.))
                    .py(px(10.))
                    .mb(px(6.))
                    .border_t_1()
                    .border_color(p.color("border"))
                    .text_size(px(12.))
                    .text_color(p.color("text-muted"))
                    .whitespace_normal()
                    .child(
                        ui.t("cloud.ambient")
                            .replace("{running}", &cloud.running.to_string())
                            .replace("{attention}", &cloud.attention.to_string()),
                    ),
            )
        })
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(4.))
                .px(px(2.))
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
                )
                .child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .flex()
                        .justify_end()
                        .items_center()
                        .gap(px(6.))
                        .text_size(px(11.))
                        .text_color(p.color("text-muted"))
                        .child(div().size(px(6.)).rounded_full().bg(p.color(
                            if props.local_connected {
                                "success"
                            } else {
                                "text-muted"
                            },
                        )))
                        .child(ui.t(if props.local_connected {
                            "status.local_host_ready"
                        } else {
                            "status.disconnected"
                        })),
                ),
        )
}
