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
    pub(crate) fn open_remote_connection(&mut self, window: &mut Window, cx: &mut Context<Self>) {
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
        self.remote.connection.editing = true;
        let focus = self.remote.connection.url.focus_handle(cx);
        window.focus(&focus, cx);
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
        div()
            .id("connector-scroll")
            .flex_1()
            .min_h_0()
            .overflow_y_scroll()
            .p(px(24.))
            .child(
                div()
                    .max_w(px(700.))
                    .flex()
                    .flex_col()
                    .gap(px(16.))
                    .child(
                        div()
                            .text_size(pero_theme::UiAppearance::global(cx).text(pero_theme::TextRole::Heading))
                            .font_weight(FontWeight::BOLD)
                            .child(self.t("connector.title")),
                    )
                    .child(
                        div()
                            .whitespace_normal()
                            .text_color(p.text_muted)
                            .child(self.t("connector.description")),
                    )
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap(px(6.))
                            .child(self.t("connector.url"))
                            .child(
                                Input::new(&self.remote.connection.url)
                                    .id("connector-url")
                                    .aria_label(self.t("connector.url"))
                                    .w_full()
                                    .disabled(busy),
                            ),
                    )
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap(px(6.))
                            .child(
                                Button::new("connector-github-login")
                                    .primary()
                                    .label(self.t(if authenticating {
                                        "connector.login_waiting"
                                    } else {
                                        "connector.login"
                                    }))
                                    .disabled(busy || !storage || authenticating)
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        let url = this
                                            .remote
                                            .connection
                                            .url
                                            .read(cx)
                                            .value()
                                            .trim()
                                            .to_string();
                                        this.command(
                                            json!({"action":"remote_login","url":url}),
                                            cx,
                                        );
                                    })),
                            )
                            .when(authenticating, |el| {
                                el.child(
                                    Button::new("connector-login-cancel")
                                        .outline()
                                        .label(self.t("connector.login_cancel"))
                                        .on_click(cx.listener(|this, _, _, cx| {
                                            this.command(
                                                json!({"action":"remote_login_cancel"}),
                                                cx,
                                            )
                                        })),
                                )
                            })
                            .child(
                                div()
                                    .text_color(p.text_muted)
                                    .child(self.t("connector.manual")),
                            )
                            .child(self.t("connector.token"))
                            .child(
                                Input::new(&self.remote.connection.token)
                                    .id("connector-token")
                                    .aria_label(self.t("connector.token"))
                                    .w_full()
                                    .content_type(
                                        gpui_kit::component::input::InputContentType::Password,
                                    )
                                    .disabled(busy),
                            )
                            .child(
                                div()
                                    .text_size(pero_theme::UiAppearance::global(cx).text(pero_theme::TextRole::Caption))
                                    .text_color(p.text_muted)
                                    .child(self.t("connector.token_help")),
                            ),
                    )
                    .child(
                        div().flex().items_center().gap(px(8.)).children(
                            ["connector.client", "connector.operator"]
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
                                }),
                        ),
                    )
                    .when(self.remote.connection.error, |el| {
                        el.child(
                            div()
                                .id("connector-required")
                                .role(Role::Alert)
                                .text_color(p.error)
                                .child(self.t("connector.required")),
                        )
                    })
                    .when(!storage, |el| {
                        el.child(
                            div()
                                .id("connector-storage-error")
                                .role(Role::Alert)
                                .text_color(p.error)
                                .whitespace_normal()
                                .child(self.t("connector.storage_unavailable")),
                        )
                    })
                    .child(
                        div()
                            .flex()
                            .flex_wrap()
                            .gap(px(8.))
                            .child(
                                Button::new("connector-save")
                                    .primary()
                                    .label(self.t(if busy {
                                        "connector.connecting"
                                    } else {
                                        "connector.connect"
                                    }))
                                    .disabled(busy || !storage)
                                    .on_click(cx.listener(|this, _, window, cx| {
                                        this.save_remote_connection(window, cx)
                                    })),
                            )
                            .when(configured, |el| {
                                el.child(
                                    Button::new("connector-cancel")
                                        .outline()
                                        .label(self.t("connector.cancel"))
                                        .disabled(busy)
                                        .on_click(cx.listener(|this, _, _, cx| {
                                            this.remote.connection.editing = false;
                                            cx.notify();
                                        })),
                                )
                            })
                            .when(configured, |el| {
                                el.child(
                                    Button::new("connector-disconnect")
                                        .outline()
                                        .label(self.t("connector.disconnect"))
                                        .disabled(busy)
                                        .on_click(cx.listener(|this, _, _, cx| {
                                            this.remote.connection.editing = false;
                                            this.command(json!({"action":"remote_disconnect"}), cx);
                                        })),
                                )
                            }),
                    ),
            )
    }
}
