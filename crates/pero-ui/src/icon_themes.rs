//! Settings projects the Host catalog; importing and persistence stay in the runtime.
use crate::{
    app::Workbench,
    settings_controls::selection_button,
    settings_view::{SettingsAction, SettingsPanel},
};
use gpui_kit::{
    component::{
        button::*,
        menu::{DropdownMenu, PopupMenuItem},
        *,
    },
    prelude::*,
    *,
};
use pero_contracts::HostEvent;
use serde_json::json;
use std::sync::atomic::{AtomicBool, Ordering};
static PENDING: AtomicBool = AtomicBool::new(false);
#[derive(Clone)]
pub(crate) enum IconThemeAction {
    Install,
    Select(Option<String>),
    Remove(String),
}
impl Workbench {
    pub(crate) fn icon_theme_action(&mut self, action: IconThemeAction, cx: &mut Context<Self>) {
        PENDING.store(true, Ordering::Relaxed);
        let command = match action {
            IconThemeAction::Install => json!({"action":"choose_icon_theme"}),
            IconThemeAction::Select(id) => {
                json!({"method":"icons","action":"select","request_id":"icons","id":id})
            }
            IconThemeAction::Remove(id) => {
                json!({"method":"icons","action":"remove","request_id":"icons","id":id})
            }
        };
        self.command(command, cx);
        self.sync_settings_panel(cx);
        cx.notify();
    }
    pub(crate) fn receive_icon_themes(
        &mut self,
        event: &HostEvent,
        cx: &mut Context<Self>,
    ) -> bool {
        if !matches!(event.kind.as_str(), "icon_themes" | "icon_themes_error") {
            return false;
        }
        PENDING.store(false, Ordering::Relaxed);
        match serde_json::from_value(event.data.clone()) {
            Ok(state) => {
                pero_chat_ui::icon_theme::install(state);
                self.error = if event.kind == "icon_themes_error" {
                    Some(event.text.clone())
                } else {
                    None
                };
            }
            Err(_) => self.error = Some("The icon theme snapshot is unavailable".into()),
        }
        self.sync_settings_panel(cx);
        cx.notify();
        true
    }
}
pub(crate) fn controls(locale: &str, cx: &mut Context<SettingsPanel>) -> AnyElement {
    let state = pero_chat_ui::icon_theme::snapshot();
    let pending = PENDING.load(Ordering::Relaxed);
    let t = |key| pero_contracts::i18n::text(locale, key).to_owned();
    let target = cx.entity().downgrade();
    let choices = state.installed.clone();
    let selected = state.selected.clone();
    let selected_label = state
        .theme
        .as_ref()
        .map(|theme| theme.name.clone())
        .unwrap_or_else(|| t("icons.default"));
    let default_label = t("icons.default");
    let title = pero_contracts::i18n::text(locale, "icons.title");
    let picker = selection_button("icon-theme", title, title, cx).label(selected_label)
        .disabled(pending)
        .dropdown_menu(move |menu, _, _| {
            let default_target = target.clone();
            let selected = selected.clone();
            let mut menu = menu.item(
                PopupMenuItem::new(default_label.clone())
                    .checked(selected.is_none())
                    .on_click(move |_, _, cx| {
                        let _ = default_target.update(cx, |_, cx| {
                            cx.emit(SettingsAction::Icons(IconThemeAction::Select(None)))
                        });
                    }),
            );
            for theme in &choices {
                let target = target.clone();
                let id = theme.id.clone();
                menu = menu.item(
                    PopupMenuItem::new(theme.name.clone())
                        .checked(selected.as_ref() == Some(&theme.id))
                        .on_click(move |_, _, cx| {
                            let _ = target.update(cx, |_, cx| {
                                cx.emit(SettingsAction::Icons(IconThemeAction::Select(Some(
                                    id.clone(),
                                ))))
                            });
                        }),
                );
            }
            menu
        });
    let mut control = div().flex().items_center().gap(px(6.)).child(picker).child(
        Button::new("icon-theme-install")
            .small()
            .ghost()
            .disabled(pending)
            .label(if pending {
                t("icons.loading")
            } else {
                t("icons.install")
            })
            .on_click(
                cx.listener(|_, _, _, cx| cx.emit(SettingsAction::Icons(IconThemeAction::Install))),
            ),
    );
    if let Some(id) = &state.selected {
        let target = cx.entity().downgrade();
        let id = id.clone();
        let confirm = t("icons.confirm_remove");
        control = control.child(
            Button::new("icon-theme-remove")
                .small()
                .ghost()
                .disabled(pending)
                .label(
                    t("icons.remove").replace(
                        "{name}",
                        &state
                            .theme
                            .as_ref()
                            .map(|theme| theme.name.as_str())
                            .unwrap_or(id.as_str()),
                    ),
                )
                .dropdown_menu(move |menu, _, _| {
                    let target = target.clone();
                    let id = id.clone();
                    menu.item(
                        PopupMenuItem::new(confirm.clone()).on_click(move |_, _, cx| {
                            let _ = target.update(cx, |_, cx| {
                                cx.emit(SettingsAction::Icons(IconThemeAction::Remove(id.clone())))
                            });
                        }),
                    )
                }),
        );
    }
    control.into_any_element()
}
