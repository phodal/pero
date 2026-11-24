use crate::app::Workbench;
use crate::workspace::WorkspaceItem;
use gpui_kit::component::{button::*, *};
use gpui_kit::{prelude::*, *};
use serde::Deserialize;
use serde_json::{Value, json};
use std::time::Duration;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
enum ChromeRelayState {
    Unavailable,
    NotPaired,
    Pairing,
    Connected,
    Expired,
    Disconnected,
    Incompatible,
}

impl ChromeRelayState {
    fn key(self) -> &'static str {
        match self {
            Self::Unavailable => "browser_use.unavailable",
            Self::NotPaired => "browser_use.chrome_status_notPaired",
            Self::Pairing => "browser_use.chrome_status_pairing",
            Self::Connected => "browser_use.chrome_status_connected",
            Self::Expired => "browser_use.chrome_status_expired",
            Self::Disconnected => "browser_use.chrome_status_disconnected",
            Self::Incompatible => "browser_use.chrome_status_incompatible",
        }
    }
}

#[derive(Default)]
pub(crate) struct ChromeConnectionView {
    polling: bool,
    status: Option<(String, ChromeRelayState)>,
}

#[derive(Clone, Copy)]
enum ChromeMode {
    Developer,
    SiteTools,
}

impl ChromeMode {
    fn operation(self) -> &'static str {
        match self {
            Self::Developer => "chrome-developer-mode",
            Self::SiteTools => "chrome-site-tools",
        }
    }

    fn labels(self, enabled: bool) -> (&'static str, &'static str) {
        match self {
            Self::Developer => (
                "browser_use.developer_mode",
                if enabled { "browser_use.developer_on" } else { "browser_use.developer_off" },
            ),
            Self::SiteTools => (
                "browser_use.site_tools",
                if enabled { "browser_use.site_tools_on" } else { "browser_use.site_tools_off" },
            ),
        }
    }
}

enum ChromeAction {
    Pair(String),
    Stop,
    PrepareFolder,
    SiteRules,
    ClearSiteRules,
    Mode(ChromeMode, Option<bool>),
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
enum SiteToolReview {
    Discover { from_origins: Vec<String> },
    Invoke { tool: SiteToolIdentity, input: serde_json::Map<String, Value> },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SiteToolIdentity {
    origin: String,
    frame_url: Option<String>,
    name: String,
}

#[derive(Default)]
pub(crate) struct CloudBrowserView {
    pending: bool,
    active: Option<(String, String)>,
    #[cfg(feature = "native-probe")]
    pub(crate) probe: Option<async_channel::Sender<Value>>,
}

impl Workbench {
    pub(crate) fn watch_chrome_connection(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.chrome_connection.polling || self.browser_thread(cx).is_none() {
            return;
        }
        let Some(owner) = crate::native::chrome_relay_owner() else { return };
        self.chrome_connection.polling = true;
        cx.spawn_in(window, async move |view, cx| {
            loop {
                let Ok(selected) = view.update_in(cx, |this, _, cx| this.browser_thread(cx)) else { break };
                if let Some(thread) = selected {
                    let request = json!({"operation":"chrome-relay-status", "thread":thread});
                    let owner = owner.clone();
                    let result = cx.background_executor().spawn(async move { owner.request(request) }).await;
                    let _ = view.update_in(cx, |this, _, cx| {
                        if this.browser_thread(cx).as_ref() != Some(&thread) { return; }
                        let state = result.ok().and_then(|value| {
                            (value["ok"] == true).then(|| value["state"].clone())
                        }).and_then(|value| serde_json::from_value::<ChromeRelayState>(value).ok());
                        let next = Some((thread, state.unwrap_or(ChromeRelayState::Unavailable)));
                        if this.chrome_connection.status != next {
                            this.chrome_connection.status = next;
                            if let Some(panel) = &this.settings_panel {
                                panel.update(cx, |_, cx| cx.notify());
                            }
                            cx.notify();
                        }
                    });
                }
                cx.background_executor().timer(Duration::from_secs(3)).await;
            }
        }).detach();
    }

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
        let action = event.data["action"].as_str();
        if action == Some("chrome-site-tool-approval") {
            let Ok(review) = serde_json::from_value::<SiteToolReview>(event.data["review"].clone()) else {
                apps.shell_reply(&id, Ok(json!("decline")));
                return;
            };
            let (message, detail) = match review {
                SiteToolReview::Discover { from_origins } => (
                    "browser_use.site_discovery_prompt",
                    [origin, self.t("browser_use.site_discovery_detail"), &from_origins.join("\n")].join("\n\n"),
                ),
                SiteToolReview::Invoke { tool, input } => (
                    "browser_use.site_tool_prompt",
                    [
                        Some(origin),
                        (tool.origin != origin).then_some(tool.origin.as_str()),
                        tool.frame_url.as_deref(),
                        Some(&tool.name),
                        Some(self.t("browser_use.site_tool_detail")),
                        Some(&serde_json::to_string_pretty(&input).expect("a JSON value")),
                    ].into_iter().flatten().collect::<Vec<_>>().join("\n\n"),
                ),
            };
            let answer = window.prompt(
                PromptLevel::Warning, self.t(message), Some(&detail),
                &[self.t("browser_use.deny"), self.t("browser_use.allow")], cx,
            );
            cx.spawn(async move |_, _| {
                let decision = if answer.await == Ok(1) { "allow" } else { "decline" };
                apps.shell_reply(&id, Ok(json!(decision)));
            }).detach();
            return;
        }
        let diagnostics = action == Some("chrome-diagnostic-approval");
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
        let state = thread.as_deref().and_then(|thread| {
            self.chrome_connection.status.as_ref()
                .filter(|(selected, _)| selected == thread)
                .map(|(_, state)| *state)
        });
        let status_key = if !available {
            "browser_use.unavailable"
        } else if thread.is_none() {
            "browser_use.choose_chat"
        } else {
            state.map(ChromeRelayState::key).unwrap_or("browser_use.chrome_status_checking")
        };
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
        let developer = pero_theme::action_button(
            "settings-chrome-developer",
            self.t("browser_use.developer_mode"),
            pero_theme::ActionKind::Ghost,
            chrome,
            cx,
        ).disabled(!available).on_click(cx.listener(|this, _, window, cx| {
            this.native_chrome_relay(ChromeAction::Mode(ChromeMode::Developer, None), window, cx)
        }));
        let site_tools = pero_theme::action_button(
            "settings-chrome-site-tools",
            self.t("browser_use.site_tools"),
            pero_theme::ActionKind::Ghost,
            chrome,
            cx,
        ).disabled(!available).on_click(cx.listener(|this, _, window, cx| {
            this.native_chrome_relay(ChromeAction::Mode(ChromeMode::SiteTools, None), window, cx)
        }));
        div()
            .flex()
            .flex_col()
            .child(pero_theme::settings_status(
                self.t("browser_use.chrome_selected_chat"),
                title,
                chrome,
            ))
            .child(pero_theme::settings_status(
                self.t("browser_use.chrome_status"),
                self.t(status_key),
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
                    developer.into_any_element(),
                    site_tools.into_any_element(),
                ],
                chrome,
            ))
            .into_any_element()
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
            ChromeAction::Stop => json!({"operation":"chrome-relay-stop"}),
            ChromeAction::PrepareFolder => json!({"operation":"chrome-extension-folder"}),
            ChromeAction::SiteRules => json!({"operation":"chrome-site-rules"}),
            ChromeAction::ClearSiteRules => json!({"operation":"chrome-site-clear"}),
            ChromeAction::Mode(mode, enabled) => json!({"operation":mode.operation(), "enabled":enabled}),
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
                            ChromeAction::Mode(mode, update) => {
                                if update.is_some() { return; }
                                let enabled = value["enabled"] == true;
                                let mode = *mode;
                                let (title, detail) = mode.labels(enabled);
                                let answer = window.prompt(
                                    PromptLevel::Info,
                                    this.t(title),
                                    Some(this.t(detail)),
                                    &[this.t("remote.close_form"), this.t(if enabled { "apps.disable" } else { "apps.enable" })],
                                    cx,
                                );
                                cx.spawn_in(window, async move |view, cx| {
                                    if answer.await == Ok(1) {
                                        let _ = view.update_in(cx, |view, window, cx| {
                                            view.native_chrome_relay(ChromeAction::Mode(mode, Some(!enabled)), window, cx);
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
