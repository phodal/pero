use crate::app::Workbench;
use crate::workspace::WorkspaceItem;
use gpui_kit::component::{
    button::*,
    menu::{DropdownMenu, PopupMenuItem},
    *,
};
use gpui_kit::{prelude::*, *};
use serde_json::{Value, json};

enum ChromeAction {
    Pair(String),
    Status(String),
    Stop,
    PrepareFolder,
    SiteRules,
    ClearSiteRules,
    DeveloperMode(Option<bool>),
}

#[derive(Default)]
pub(crate) struct CloudBrowserView {
    pending: bool,
    active: Option<(String, String)>,
    #[cfg(feature = "native-probe")]
    pub(crate) probe: Option<async_channel::Sender<Value>>,
}

impl Workbench {
    pub(super) fn native_chrome_approval(
        &mut self,
        event: pero_contracts::HostEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(id) = event.request_id else { return };
        let apps = crate::native::apps();
        let thread = event.data["thread"].as_str().unwrap_or_default();
        let origin = event.data["origin"].as_str().unwrap_or_default();
        if origin.is_empty() || self.browser_thread(cx).as_deref() != Some(thread) {
            apps.shell_reply(&id, Ok(json!("decline")));
            return;
        }
        let diagnostics = event.data["action"] == "chrome-diagnostic-approval";
        let mut buttons = vec![self.t("browser_use.deny")];
        if diagnostics {
            buttons.push(self.t("browser_use.allow"));
        } else {
            buttons.extend([
                self.t("browser_use.site_once"),
                self.t("browser_use.site_allow"),
                self.t("browser_use.site_block"),
            ]);
        }
        let detail = format!("{origin}\n\n{}", self.t(if diagnostics {
            "browser_use.diagnostic_detail"
        } else {
            "browser_use.site_detail"
        }));
        let answer = window.prompt(
            if diagnostics { PromptLevel::Warning } else { PromptLevel::Info },
            self.t(if diagnostics {
                "browser_use.diagnostic_prompt"
            } else {
                "browser_use.site_prompt"
            }),
            Some(&detail),
            &buttons,
            cx,
        );
        cx.spawn(async move |_, _| {
            let decision = match (diagnostics, answer.await) {
                (true, Ok(1)) => "allow",
                (false, Ok(1)) => "once",
                (false, Ok(2)) => "allow",
                (false, Ok(3)) => "block",
                _ => "decline",
            };
            apps.shell_reply(&id, Ok(json!(decision)));
        }).detach();
    }

    pub(crate) fn cloud_browser_button(
        &self,
        task_id: &str,
        run_id: &str,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        crate::native::chrome_relay_owner()?;
        let shared = self
            .remote
            .browser_share
            .active
            .as_ref()
            .is_some_and(|(_, run)| run == run_id);
        let task_id = task_id.to_owned();
        let button = Button::new("native-cloud-browser")
            .outline()
            .small()
            .disabled(self.remote.browser_share.pending)
            .label(self.t(if shared {
                "browser_use.cloud_stop"
            } else {
                "browser_use.cloud_chrome"
            }))
            .on_click(cx.listener(move |this, _, _, cx| {
                this.request_cloud_browser(&task_id, shared, cx);
            }));
        Some(
            div()
                .flex()
                .items_center()
                .gap(px(8.))
                .when(shared, |row| row.child(self.t("browser_use.cloud_active")))
                .child(button)
                .into_any_element(),
        )
    }

    pub(crate) fn request_cloud_browser(&mut self, task_id: &str, stop: bool, cx: &mut Context<Self>) {
        self.remote.browser_share.pending = true;
        self.command(
            if stop {
                json!({"action":"remote_browser_stop"})
            } else {
                json!({"action":"remote_browser_prepare","task_id":task_id})
            },
            cx,
        );
        cx.notify();
    }

    pub(crate) fn receive_cloud_browser(
        &mut self,
        data: &Value,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        #[cfg(feature = "native-probe")]
        let probe = self.remote.browser_share.probe.as_ref().is_some_and(|probe| {
            let _ = probe.try_send(data.clone());
            true
        });
        #[cfg(not(feature = "native-probe"))]
        let probe = false;
        let id = data["id"].as_str().unwrap_or_default();
        match data["state"].as_str() {
            Some("confirm") => {
                if probe { return; }
                let task = WorkspaceItem::Task(data["taskId"].as_str().unwrap_or_default().into());
                if self.navigation.current() != Some(&task) {
                    self.command(json!({"action":"remote_browser_dismiss"}), cx);
                    return;
                }
                let mut detail = ["taskTitle", "cloudOrigin", "pageTitle", "pageOrigin"]
                    .map(|key| data[key].as_str().unwrap_or_default())
                    .join("\n");
                detail.push_str("\n\n");
                detail.push_str(self.t("browser_use.native_cloud_detail"));
                if data["screenshots"] == true {
                    detail.push('\n');
                    detail.push_str(self.t("browser_use.cloud_screenshots"));
                }
                let answer = window.prompt(
                    PromptLevel::Warning,
                    self.t("browser_use.cloud_confirm"),
                    Some(&detail),
                    &[self.t("browser_use.deny"), self.t("browser_use.allow")],
                    cx,
                );
                let id = id.to_owned();
                cx.spawn_in(window, async move |view, cx| {
                    let approved = answer.await == Ok(1);
                    let _ = view.update_in(cx, |view, _, cx| {
                        view.command(
                            if approved && view.navigation.current() == Some(&task) {
                                json!({"action":"remote_browser_approve","id":id})
                            } else {
                                json!({"action":"remote_browser_dismiss"})
                            },
                            cx,
                        );
                    });
                })
                .detach();
            }
            Some("sharing") => {
                self.remote.browser_share.pending = false;
                self.remote.browser_share.active =
                    Some((id.to_owned(), data["runId"].as_str().unwrap_or_default().into()));
            }
            Some("closed") => {
                if self.remote.browser_share.active.as_ref().is_some_and(|(active, _)| active == id) {
                    self.remote.browser_share.active = None;
                }
            }
            Some("idle" | "error") => {
                self.remote.browser_share.pending = false;
                if !probe && let Some(key) = data["key"].as_str() {
                    let _ = window.prompt(
                        PromptLevel::Warning,
                        self.t("browser_use.unavailable"),
                        Some(self.t(key)),
                        &[self.t("remote.close_form")],
                        cx,
                    );
                }
            }
            _ => {}
        }
        cx.notify();
    }

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
        let sites = pero_theme::action_button(
            "settings-chrome-sites",
            self.t("browser_use.site_settings"),
            pero_theme::ActionKind::Ghost,
            chrome,
            cx,
        )
        .disabled(!available)
        .on_click(cx.listener(|this, _, window, cx| {
            this.native_chrome_relay(ChromeAction::SiteRules, window, cx)
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
                    sites.into_any_element(),
                ],
                chrome,
            ))
            .into_any_element()
    }

    pub(crate) fn native_chrome_relay_menu(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
        let thread = self.browser_thread(cx)?;
        let owner = cx.entity();
        let pair = self.t("browser_use.open_chrome").to_owned();
        let status = self.t("browser_use.chrome_status").to_owned();
        let stop = self.t("browser_use.chrome_stop").to_owned();
        let developer = self.t("browser_use.developer_mode").to_owned();
        Some(
            Button::new("chrome-relay")
                .ghost()
                .small()
                .label(self.t("browser_use.chrome_menu"))
                .accessibility_label(self.t("browser_use.chrome_menu"))
                .dropdown_menu(move |menu, _, _| {
                    let start_owner = owner.clone();
                    let status_owner = owner.clone();
                    let stop_owner = owner.clone();
                    let developer_owner = owner.clone();
                    let thread = thread.clone();
                    let status_thread = thread.clone();
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
                    .item(PopupMenuItem::new(status.clone()).on_click(move |_, window, cx| {
                        status_owner.update(cx, |this, cx| {
                            this.native_chrome_relay(
                                ChromeAction::Status(status_thread.clone()),
                                window,
                                cx,
                            );
                        });
                    }))
                    .item(
                        PopupMenuItem::new(developer.clone()).on_click(move |_, window, cx| {
                            developer_owner.update(cx, |this, cx| {
                                this.native_chrome_relay(ChromeAction::DeveloperMode(None), window, cx)
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

    pub(super) fn pair_sidebar_conversation(&mut self, thread: String, window: &mut Window, cx: &mut Context<Self>) {
        self.native_chrome_relay(ChromeAction::Pair(thread), window, cx)
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
            ChromeAction::Status(thread) => json!({"operation":"chrome-relay-status", "thread":thread}),
            ChromeAction::Stop => json!({"operation":"chrome-relay-stop"}),
            ChromeAction::PrepareFolder => json!({"operation":"chrome-extension-folder"}),
            ChromeAction::SiteRules => json!({"operation":"chrome-site-rules"}),
            ChromeAction::ClearSiteRules => json!({"operation":"chrome-site-clear"}),
            ChromeAction::DeveloperMode(enabled) => json!({"operation":"chrome-developer-mode", "enabled":enabled}),
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
                            ChromeAction::Stop | ChromeAction::ClearSiteRules => return,
                            ChromeAction::DeveloperMode(update) => {
                                if update.is_some() { return; }
                                let enabled = value["enabled"] == true;
                                let answer = window.prompt(
                                    PromptLevel::Info,
                                    this.t("browser_use.developer_mode"),
                                    Some(this.t(if enabled { "browser_use.developer_on" } else { "browser_use.developer_off" })),
                                    &[this.t("remote.close_form"), this.t(if enabled { "apps.disable" } else { "apps.enable" })],
                                    cx,
                                );
                                cx.spawn_in(window, async move |view, cx| {
                                    if answer.await == Ok(1) {
                                        let _ = view.update_in(cx, |view, window, cx| {
                                            view.native_chrome_relay(ChromeAction::DeveloperMode(Some(!enabled)), window, cx);
                                        });
                                    }
                                }).detach();
                                return;
                            }
                            ChromeAction::SiteRules => {
                                let rules = value["rules"].as_object().into_iter().flatten()
                                    .filter_map(|(origin, decision)| Some(format!(
                                        "{origin} · {}",
                                        this.t(&format!("browser_use.site_rule_{}", decision.as_str()?)),
                                    )))
                                    .collect::<Vec<_>>();
                                let mut buttons = vec![this.t("remote.close_form")];
                                if !rules.is_empty() {
                                    buttons.push(this.t("browser_use.site_clear"));
                                }
                                let detail = if rules.is_empty() {
                                    this.t("browser_use.site_empty").to_owned()
                                } else {
                                    rules.join("\n")
                                };
                                let answer = window.prompt(
                                    PromptLevel::Info, this.t("browser_use.site_settings"),
                                    Some(&detail), &buttons, cx,
                                );
                                cx.spawn_in(window, async move |view, cx| {
                                    if answer.await == Ok(1) {
                                        let _ = view.update_in(cx, |view, window, cx| {
                                            view.native_chrome_relay(ChromeAction::ClearSiteRules, window, cx);
                                        });
                                    }
                                }).detach();
                                return;
                            }
                            ChromeAction::Status(thread) => {
                                if this.browser_thread(cx).as_ref() == Some(thread)
                                    && let Some(state) = value["state"].as_str()
                                {
                                    let _ = window.prompt(
                                        PromptLevel::Info,
                                        this.t(&format!("browser_use.chrome_status_{state}")),
                                        value["message"].as_str(),
                                        &[this.t("remote.close_form")],
                                        cx,
                                    );
                                }
                                return;
                            }
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
