use crate::app::{Workbench, request_locale};
use gpui_kit::{
    component::{
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

    pub(crate) fn settings_menu(&self, icon_only: bool, cx: &mut Context<Self>) -> impl IntoElement {
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
        let label = t("settings.title");
        let chrome = pero_theme::Chrome::from_app(cx);
        let icon = || Icon::default().path("icons/settings.svg");
        let button = if icon_only {
            pero_theme::ghost_icon_button("sidebar-settings", chrome, cx)
                .tooltip(label.clone())
                .icon(icon())
        } else {
            pero_theme::sidebar_menu_button(
                "sidebar-settings",
                label.clone(),
                icon(),
                false,
                chrome,
                cx,
            )
        };
        button
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
                if !identity.is_empty() || !host.is_empty() {
                    menu = menu.separator();
                }
                let target = workbench.clone();
                let saved = preferences.clone();
                let appearance_choices = appearance_choices.clone();
                menu = menu.submenu(appearance.clone(), window, cx, move |menu, _, _| {
                    appearance_choices.iter().fold(menu.min_w(px(170.)), |menu, (mode, label)| {
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
                    })
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
