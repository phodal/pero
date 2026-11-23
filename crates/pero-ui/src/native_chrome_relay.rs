use crate::app::Workbench;
use gpui_kit::component::{
    button::*,
    menu::{DropdownMenu, PopupMenuItem},
    *,
};
use gpui_kit::{prelude::*, *};
use serde_json::json;

impl Workbench {
    pub(crate) fn native_chrome_relay_menu(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
        let thread = self.browser_thread(cx)?;
        let owner = cx.entity();
        let pair = self.t("browser_use.chrome_pair").to_owned();
        let stop = self.t("browser_use.chrome_stop").to_owned();
        Some(
            Button::new("chrome-relay")
                .ghost()
                .small()
                .label(self.t("browser_use.chrome_menu"))
                .dropdown_menu(move |menu, _, _| {
                    let start_owner = owner.clone();
                    let stop_owner = owner.clone();
                    let thread = thread.clone();
                    menu.item(
                        PopupMenuItem::new(pair.clone()).on_click(move |_, window, cx| {
                            start_owner.update(cx, |this, cx| {
                                this.native_chrome_relay(Some(thread.clone()), window, cx)
                            });
                        }),
                    )
                    .item(
                        PopupMenuItem::new(stop.clone()).on_click(move |_, window, cx| {
                            stop_owner
                                .update(cx, |this, cx| this.native_chrome_relay(None, window, cx));
                        }),
                    )
                })
                .into_any_element(),
        )
    }

    fn native_chrome_relay(
        &mut self,
        thread: Option<String>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(owner) = crate::native::chrome_relay_owner() else {
            return;
        };
        let request = if let Some(thread) = &thread {
            json!({"operation":"chrome-relay-pair","thread":thread,"label":self.t("browser_use.chrome_selected_chat")})
        } else {
            json!({"operation":"chrome-relay-stop"})
        };
        cx.spawn_in(window, async move |entity, cx| {
            let result = cx
                .background_executor()
                .spawn(async move { owner.request(request) })
                .await;
            let _ = entity.update_in(cx, |this, window, cx| {
                let failure = match result {
                    Ok(value) if value["ok"] == true => {
                        if let Some(thread) = thread.as_deref() {
                            if this.browser_thread(cx).as_deref() != Some(thread) {
                                return;
                            }
                            if let Some(code) = value["code"].as_str() {
                                cx.write_to_clipboard(ClipboardItem::new_string(code.to_owned()));
                                let _ = window.prompt(
                                    PromptLevel::Info,
                                    this.t("browser_use.chrome_copied"),
                                    None,
                                    &[this.t("remote.close_form")],
                                    cx,
                                );
                            }
                        }
                        return;
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
