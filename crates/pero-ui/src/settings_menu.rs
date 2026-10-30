use crate::app::{Workbench, request_locale};
use crate::workspace::WorkbenchPage;
use gpui_kit::{
    component::{
        button::*,
        menu::{DropdownMenu, PopupMenuItem},
        *,
    },
    prelude::*,
    *,
};
use pero_chat_ui::theme::WorkbenchStyle as W;
use pero_contracts::workbench::{Appearance, WorkbenchPreferences};
use serde_json::json;

#[derive(Clone, Copy, Default, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum PreferenceSaveState {
    #[default]
    Idle,
    Saving,
    Saved,
}

#[derive(Clone, Copy)]
pub(crate) struct SettingsDestination {
    pub label_key: &'static str,
    pub icon: &'static str,
    pub page: WorkbenchPage,
}
impl SettingsDestination {
    pub const ALL: [Self; 3] = [
        Self {
            label_key: "settings.connections",
            icon: "external-link",
            page: WorkbenchPage::Connections,
        },
        Self {
            label_key: "settings.resources",
            icon: "server",
            page: WorkbenchPage::Workers,
        },
        Self {
            label_key: "settings.agents",
            icon: "sparkles",
            page: WorkbenchPage::Agents,
        },
    ];
}

impl Workbench {
    pub(crate) fn save_preferences(
        &mut self,
        preferences: WorkbenchPreferences,
        cx: &mut Context<Self>,
    ) {
        self.error = None;
        self.preferences_status = PreferenceSaveState::Saving;
        self.command(
            json!({"method":"settings.workbench","preferences":preferences}),
            cx,
        );
        self.sync_settings_panel(cx);
    }

    pub(crate) fn settings_menu(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let workbench = cx.entity().downgrade();
        let menu_owner = workbench.clone();
        let locale = self.locale.clone();
        let preferences = self.preferences.clone();
        let t = |key| self.t(key).to_string();
        let identity = self.remote.data["identity"]["name"]
            .as_str()
            .unwrap_or("")
            .to_string();
        let host = self.remote.data["connection"]["url"]
            .as_str()
            .unwrap_or("")
            .trim_start_matches("https://")
            .trim_start_matches("http://")
            .trim_end_matches('/')
            .to_string();
        let destinations =
            SettingsDestination::ALL.map(|destination| (destination, t(destination.label_key)));
        let all = t("settings.all");
        let appearance = format!(
            "{} · {}",
            t("settings.appearance"),
            t(preferences.appearance.label_key())
        );
        let language = format!(
            "{} · {}",
            t("menu.language"),
            if locale == "en" {
                "English"
            } else {
                "简体中文"
            }
        );
        let appearance_choices = [Appearance::Light, Appearance::Dark, Appearance::System]
            .map(|mode| (mode, t(mode.label_key())));
        Button::new("sidebar-settings")
            .ghost()
            .small()
            .w_full()
            .h(px(pero_theme::UiAppearance::global(cx)
                .typography
                .row_height()))
            .justify_start()
            .icon(Icon::default().path("icons/settings.svg"))
            .label(if identity.is_empty() {
                t("settings.title")
            } else {
                identity.clone()
            })
            .child(div().flex_1())
            .accessibility_label(t("settings.title"))
            .dropdown_caret(false)
            .dropdown_menu_with_anchor(Anchor::BottomLeft, move |menu, window, cx| {
                let mut menu = menu.min_w(px(W::MENU_WIDTH)).check_side(Side::Right);
                if !identity.is_empty() {
                    menu = menu.item(PopupMenuItem::label(identity.clone()));
                }
                if !host.is_empty() {
                    menu = menu.item(PopupMenuItem::label(host.clone()));
                }
                menu = menu.separator();
                for (destination, label) in &destinations {
                    let target = workbench.clone();
                    let page = destination.page;
                    menu = menu.item(
                        PopupMenuItem::new(label.clone())
                            .icon(Icon::default().path(format!("icons/{}.svg", destination.icon)))
                            .on_click(move |_, window, cx| {
                                let _ = target.update(cx, |this, cx| {
                                    this.navigate(page, cx);
                                    if page == WorkbenchPage::Connections {
                                        this.open_remote_connection(window, cx);
                                    }
                                    if page == WorkbenchPage::Workers {
                                        this.command(json!({"action":"remote_refresh"}), cx);
                                    }
                                    this.sync_follow(cx);
                                    cx.notify();
                                });
                            }),
                    );
                }
                let target = workbench.clone();
                let saved = preferences.clone();
                let appearance_choices = appearance_choices.clone();
                menu =
                    menu.separator()
                        .submenu(appearance.clone(), window, cx, move |menu, _, _| {
                            appearance_choices.iter().fold(
                                menu.min_w(px(170.)),
                                |menu, (mode, label)| {
                                    let target = target.clone();
                                    let mut next = saved.clone();
                                    next.appearance = *mode;
                                    menu.item(
                                        PopupMenuItem::new(label.clone())
                                            .checked(saved.appearance == *mode)
                                            .on_click(move |_, _, cx| {
                                                let _ = target.update(cx, |this, cx| {
                                                    this.save_preferences(next.clone(), cx)
                                                });
                                            }),
                                    )
                                },
                            )
                        });
                let target = workbench.clone();
                let selected_locale = locale.clone();
                menu = menu.submenu(language.clone(), window, cx, move |menu, _, _| {
                    [("zh-CN", "简体中文"), ("en", "English")].into_iter().fold(
                        menu.min_w(px(170.)),
                        |menu, (value, label)| {
                            let target = target.clone();
                            menu.item(
                                PopupMenuItem::new(label)
                                    .checked(selected_locale == value)
                                    .on_click(move |_, _, cx| {
                                        if request_locale(value).is_err() {
                                            let _ = target.update(cx, |this, cx| {
                                                this.error = Some("error.preferences".into());
                                                cx.notify();
                                            });
                                        }
                                    }),
                            )
                        },
                    )
                });
                let target = workbench.clone();
                menu.separator().item(
                    PopupMenuItem::new(all.clone())
                        .icon(Icon::default().path("icons/settings.svg"))
                        .on_click(move |_, window, cx| {
                            let _ = target.update(cx, |this, cx| {
                                this.open_settings(window, cx);
                                cx.notify();
                            });
                        }),
                )
            })
            .on_open_change(move |open, _, cx| {
                let _ = menu_owner.update(cx, |this, cx| {
                    this.settings_menu_open = *open;
                    cx.notify();
                });
            })
    }
}
