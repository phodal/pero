//! The connector form holds a credential only until handing it to the native bridge.
use crate::app::Workbench;
use gpui_kit::{
    component::{
        button::*,
        input::{Input, InputEvent, InputState},
        *,
    },
    prelude::*,
    *,
};
use serde_json::json;

pub(crate) struct ConnectionForm {
    pub editing: bool,
    pub submitting: bool,
    pub url: Entity<InputState>,
    pub token: Entity<InputState>,
    pub mode: usize,
    error: bool,
    _subscriptions: Vec<Subscription>,
}

impl ConnectionForm {
    pub fn new(window: &mut Window, cx: &mut Context<Workbench>) -> Self {
        let url = cx.new(|cx| InputState::new(window, cx).placeholder("https://app.openpero.com"));
        let token = cx.new(|cx| InputState::new(window, cx).masked(true));
        let subscriptions = [&url, &token]
            .into_iter()
            .map(|input| cx.subscribe(input, |_, _, _: &InputEvent, cx| cx.notify()))
            .collect();
        Self {
            editing: false,
            submitting: false,
            url,
            token,
            mode: 0,
            error: false,
            _subscriptions: subscriptions,
        }
    }
}

impl Workbench {
    pub(crate) fn prepare_remote_connection(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let url = self.remote.data["connection"]["url"]
            .as_str()
            .unwrap_or("")
            .to_string();
        self.remote
            .connection
            .url
            .update(cx, |input, cx| input.set_value(url, window, cx));
        self.remote
            .connection
            .token
            .update(cx, |input, cx| input.set_value("", window, cx));
        self.remote.connection.mode =
            usize::from(self.remote.data["connection"]["mode"] == "operator");
        self.remote.connection.error = false;
        cx.notify();
    }

    fn save_remote_connection(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let mut url = self
            .remote
            .connection
            .url
            .read(cx)
            .value()
            .trim()
            .to_string();
        if url.is_empty() {
            url = self.remote.data["connection"]["url"]
                .as_str()
                .unwrap_or("")
                .to_string();
        }
        let token = self
            .remote
            .connection
            .token
            .read(cx)
            .value()
            .trim()
            .to_string();
        if url.is_empty() || token.is_empty() || url.len() > 2048 || token.len() > 512 {
            self.remote.connection.error = true;
            cx.notify();
            return;
        }
        self.remote.connection.error = false;
        self.remote.connection.submitting = true;
        self.remote
            .connection
            .token
            .update(cx, |input, cx| input.set_value("", window, cx));
        self.command(
            json!({"action":"remote_configure","url":url,"token":token,
            "mode":if self.remote.connection.mode == 1 {"operator"} else {"client"}}),
            cx,
        );
    }

    pub(crate) fn remote_connection_view(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let p = &pero_theme::UiAppearance::global(cx).palette.clone();
        let busy = self.remote.connection.submitting
            || self.remote.data["loading"].as_bool().unwrap_or(false);
        let configured = self.remote.data["configured"].as_bool().unwrap_or(false);
        let authenticating = self.remote.data["connection"]["authenticating"]
            .as_bool()
            .unwrap_or(false);
        let storage = self.remote.data["connection"]["persistence_available"]
            .as_bool()
            .unwrap_or(true);
        let height = px(pero_theme::UiAppearance::global(cx).typography.control_height());
        let url = pero_theme::WorkbenchStyle::input(Input::new(&self.remote.connection.url), cx)
            .id("connector-url")
            .aria_label(self.t("connector.url"))
            .w_full()
            .disabled(busy)
            .into_any_element();
        let token = Input::new(&self.remote.connection.token)
            .id("connector-token")
            .aria_label(self.t("connector.token"))
            .w_full()
            .content_type(gpui_kit::component::input::InputContentType::Password)
            .disabled(busy)
            .into_any_element();
        let mut login = vec![Button::new("connector-github-login")
            .primary()
            .small()
            .h(height)
            .label(self.t(if authenticating {
                "connector.login_waiting"
            } else {
                "connector.login"
            }))
            .disabled(busy || !storage || authenticating)
            .on_click(cx.listener(|this, _, _, cx| {
                let url = this.remote.connection.url.read(cx).value().trim().to_string();
                this.command(json!({"action":"remote_login","url":url}), cx);
            }))
            .into_any_element()];
        if authenticating {
            login.push(
                Button::new("connector-login-cancel")
                    .outline()
                    .label(self.t("connector.login_cancel"))
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.command(json!({"action":"remote_login_cancel"}), cx)
                    }))
                    .into_any_element(),
            );
        }
        let modes = ["connector.client", "connector.operator"]
            .into_iter()
            .enumerate()
            .map(|(mode, key)| {
                Button::new(("connector-mode", mode))
                    .outline()
                    .small()
                    .label(self.t(key))
                    .toggled(self.remote.connection.mode == mode)
                    .disabled(busy)
                    .bg(p.color(if self.remote.connection.mode == mode {
                        "accent-soft"
                    } else {
                        "surface"
                    }))
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.remote.connection.mode = mode;
                        cx.notify();
                    }))
                    .into_any_element()
            })
            .collect::<Vec<_>>();
        let mut save = vec![Button::new("connector-save")
            .primary()
            .small()
            .h(height)
            .label(self.t(if busy {
                "connector.connecting"
            } else {
                "connector.connect"
            }))
            .disabled(busy || !storage)
            .on_click(cx.listener(|this, _, window, cx| this.save_remote_connection(window, cx)))
            .into_any_element()];
        if configured && self.remote.connection.editing {
            save.push(
                Button::new("connector-cancel")
                    .outline()
                    .label(self.t("connector.cancel"))
                    .disabled(busy)
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.remote.connection.editing = false;
                        cx.notify();
                    }))
                    .into_any_element(),
            );
        }
        if configured {
            save.push(
                Button::new("connector-disconnect")
                    .outline()
                    .label(self.t("connector.disconnect"))
                    .disabled(busy)
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.remote.connection.editing = false;
                        this.command(json!({"action":"remote_disconnect"}), cx);
                    }))
                    .into_any_element(),
            );
        }
        let mut form = div()
            .id("connector-form")
            .flex()
            .flex_col()
            .child(pero_theme::settings_message(
                self.t("connector.description"),
                pero_theme::SettingMessage::Help,
                pero_theme::Chrome::from_app(cx),
            ))
            .child(pero_theme::settings_field(
                self.t("connector.url"),
                None,
                url,
                pero_theme::Chrome::from_app(cx),
            ))
            .child(pero_theme::settings_actions(
                login,
                pero_theme::Chrome::from_app(cx),
            ))
            .child(pero_theme::settings_message(
                self.t("connector.manual"),
                pero_theme::SettingMessage::Help,
                pero_theme::Chrome::from_app(cx),
            ))
            .child(pero_theme::settings_field(
                self.t("connector.token"),
                Some(self.t("connector.token_help").into()),
                token,
                pero_theme::Chrome::from_app(cx),
            ))
            .child(pero_theme::settings_actions(
                modes,
                pero_theme::Chrome::from_app(cx),
            ));
        if self.remote.connection.error {
            form = form.child(
                pero_theme::settings_message(
                    self.t("connector.required"),
                    pero_theme::SettingMessage::Error,
                    pero_theme::Chrome::from_app(cx),
                )
                .id("connector-required")
                .role(Role::Alert),
            );
        }
        if !storage {
            form = form.child(
                pero_theme::settings_message(
                    self.t("connector.storage_unavailable"),
                    pero_theme::SettingMessage::Error,
                    pero_theme::Chrome::from_app(cx),
                )
                .id("connector-storage-error")
                .role(Role::Alert),
            );
        }
        form.child(pero_theme::settings_actions(
            save,
            pero_theme::Chrome::from_app(cx),
        ))
    }
}
