use crate::app::Workbench;
use gpui_kit::component::{
    button::*,
    menu::{DropdownMenu, PopupMenuItem},
    *,
};
use gpui_kit::{prelude::*, *};
use serde_json::json;

enum ChromeAction {
    Pair(String),
    Stop,
    PrepareFolder,
}

impl Workbench {
    pub(crate) fn chrome_settings(&self, cx: &mut Context<Self>) -> AnyElement {
        let chrome = pero_theme::Chrome::from_app(cx);
        let available = crate::native::chrome_relay_owner().is_some();
        let thread = self.browser_thread(cx);
        let chat = self.chat.read(cx);
        let title = thread
            .as_ref()
            .and_then(|_| chat.active_chat.and_then(|i| chat.chats.get(i)))
            .map(|c| c.title.display().to_owned())
            .unwrap_or_else(|| self.t("browser_use.choose_chat").into());
        let pair = pero_theme::action_button(
            "settings-chrome-pair",
            self.t("browser_use.open_chrome"),
            pero_theme::ActionKind::Primary,
            chrome,
            cx,
        )
        .disabled(thread.is_none() || !available)
        .on_click(cx.listener(|this, _, window, cx| {
            if let Some(thread) = this.browser_thread(cx) {
                this.native_chrome_relay(ChromeAction::Pair(thread), window, cx);
            }
        }));
        let folder = pero_theme::action_button(
            "settings-chrome-folder",
            self.t("browser_use.extension_folder"),
            pero_theme::ActionKind::Ghost,
            chrome,
            cx,
        )
        .disabled(!available)
        .on_click(cx.listener(|this, _, window, cx| {
            this.native_chrome_relay(ChromeAction::PrepareFolder, window, cx)
        }));
        let stop = pero_theme::action_button(
            "settings-chrome-stop",
            self.t("browser_use.chrome_stop"),
            pero_theme::ActionKind::Ghost,
            chrome,
            cx,
        )
        .disabled(!available)
        .on_click(cx.listener(|this, _, window, cx| {
            this.native_chrome_relay(ChromeAction::Stop, window, cx)
        }));
        div()
            .flex()
            .flex_col()
            .child(pero_theme::settings_status(
                self.t("browser_use.chrome_selected_chat"),
                title,
                chrome,
            ))
            .child(pero_theme::settings_message(
                self.t("browser_use.setup_hint"),
                pero_theme::SettingMessage::Help,
                chrome,
            ))
            .when(!available, |body| {
                body.child(pero_theme::settings_message(
                    self.t("browser_use.unavailable"),
                    pero_theme::SettingMessage::Error,
                    chrome,
                ))
            })
            .child(pero_theme::settings_actions(
                [
                    pair.into_any_element(),
                    folder.into_any_element(),
                    stop.into_any_element(),
                ],
                chrome,
            ))
            .into_any_element()
    }

    pub(crate) fn native_chrome_relay_menu(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
        let thread = self.browser_thread(cx)?;
        let owner = cx.entity();
        let pair = self.t("browser_use.open_chrome").to_owned();
        let stop = self.t("browser_use.chrome_stop").to_owned();
        Some(
            Button::new("chrome-relay")
                .ghost()
                .small()
                .label(self.t("browser_use.chrome_menu"))
                .accessibility_label(self.t("browser_use.chrome_menu"))
                .dropdown_menu(move |menu, _, _| {
                    let start_owner = owner.clone();
                    let stop_owner = owner.clone();
                    let thread = thread.clone();
                    menu.item(
                        PopupMenuItem::new(pair.clone()).on_click(move |_, window, cx| {
                            start_owner.update(cx, |this, cx| {
                                this.native_chrome_relay(
                                    ChromeAction::Pair(thread.clone()),
                                    window,
                                    cx,
                                )
                            });
                        }),
                    )
                    .item(
                        PopupMenuItem::new(stop.clone()).on_click(move |_, window, cx| {
                            stop_owner.update(cx, |this, cx| {
                                this.native_chrome_relay(ChromeAction::Stop, window, cx)
                            });
                        }),
                    )
                })
                .into_any_element(),
        )
    }

    fn native_chrome_relay(
        &mut self,
        action: ChromeAction,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(owner) = crate::native::chrome_relay_owner() else {
            return;
        };
        let request = match &action {
            ChromeAction::Pair(thread) => {
                let label = self
                    .chat
                    .read(cx)
                    .chats
                    .iter()
                    .find(|chat| &chat.id == thread)
                    .map(|chat| chat.title.display())
                    .unwrap_or(self.t("browser_use.chrome_selected_chat"));
                json!({"operation": "chrome-relay-pair", "thread": thread, "label": label})
            }
            ChromeAction::Stop => json!({"operation":"chrome-relay-stop"}),
            ChromeAction::PrepareFolder => json!({"operation":"chrome-extension-folder"}),
        };
        cx.spawn_in(window, async move |entity, cx| {
            let result = cx
                .background_executor()
                .spawn(async move { owner.request(request) })
                .await;
            let _ = entity.update_in(cx, |this, window, cx| {
                let failure = match result {
                    Ok(value) if value["ok"] == true => {
                        let mut open = std::process::Command::new("/usr/bin/open");
                        match &action {
                            ChromeAction::Stop => return,
                            ChromeAction::Pair(thread) => {
                                if this.browser_thread(cx).as_ref() != Some(thread) {
                                    return;
                                }
                                open.args(["-b", "com.google.Chrome"]);
                            }
                            ChromeAction::PrepareFolder => {}
                        }
                        match value["url"].as_str().or_else(|| value["folder"].as_str()) {
                            Some(path)
                                if open.arg(path).status().is_ok_and(|status| status.success()) =>
                            {
                                return;
                            }
                            _ => this.t("browser_use.open_failed").to_owned(),
                        }
                    }
                    Ok(value) => value["message"]
                        .as_str()
                        .unwrap_or("Chrome Relay is unavailable.")
                        .to_owned(),
                    Err(error) => error.to_string(),
                };
                let _ = window.prompt(
                    PromptLevel::Warning,
                    this.t("browser_use.unavailable"),
                    Some(&failure),
                    &[this.t("remote.close_form")],
                    cx,
                );
            });
        })
        .detach();
    }
}
