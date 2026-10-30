//! Built-in provider form uses the Desktop credential boundary and Host settings store.
use crate::{
    app::Workbench,
    settings_view::{SettingsAction, SettingsPanel},
};
use gpui_kit::{
    component::{input::Input, *},
    prelude::*,
    *,
};
use pero_contracts::{
    HostEvent,
    harness_settings::{HarnessControl, HarnessState},
};
use pero_theme::{TextRole, UiAppearance};

impl Workbench {
    pub(crate) fn receive_harness(&mut self, event: &HostEvent, cx: &mut Context<Self>) -> bool {
        if event.kind != "harness_state" {
            return false;
        }
        if let Ok(state) = serde_json::from_value::<HarnessState>(event.data.clone()) {
            self.harness = Some(state.clone());
            if let Some(panel) = &self.settings_panel {
                panel.update(cx, |panel, cx| {
                    panel.harness_sync |= panel.harness.is_none() || state.status == "saved";
                    panel.harness = Some(state);
                    cx.notify();
                });
            }
            cx.notify();
        }
        true
    }
}
impl SettingsPanel {
    pub(crate) fn sync_harness_inputs(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if !self.harness_sync {
            return;
        }
        self.harness_sync = false;
        self.harness_remove_confirm = false;
        if let Some(state) = &self.harness {
            for (index, value) in [state.endpoint.clone(), state.model.clone(), String::new()]
                .into_iter()
                .enumerate()
            {
                self.harness_inputs[index]
                    .update(cx, |input, cx| input.set_value(value, window, cx));
            }
            let hint = self.t(if state.credential_configured {
                "harness.key_keep"
            } else {
                "harness.key_placeholder"
            });
            self.harness_inputs[2].update(cx, |input, cx| input.set_placeholder(hint, window, cx));
        }
    }
    pub(crate) fn harness_settings(&self, cx: &mut Context<Self>) -> AnyElement {
        let p = UiAppearance::global(cx);
        let state = self.harness.as_ref();
        let saving = state.is_some_and(|s| s.status == "saving");
        let disabled = state.is_none() || saving;
        let mut body = div().flex().flex_col().gap(px(12.));
        for (index, label) in ["harness.endpoint", "harness.model", "harness.api_key"]
            .into_iter()
            .enumerate()
        {
            body = body.child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(4.))
                    .child(self.t(label))
                    .child(
                        Input::new(&self.harness_inputs[index])
                            .small()
                            .disabled(disabled),
                    ),
            );
        }
        if let Some(state) = state {
            body = body.child(
                div()
                    .text_color(p.palette.text_muted)
                    .text_size(p.text(TextRole::Caption))
                    .child(self.t(if state.source == "settings" {
                        "harness.source_settings"
                    } else {
                        "harness.source_env"
                    })),
            );
            if let Some(error) = &state.error {
                body = body.child(
                    div()
                        .id("harness-error")
                        .role(Role::Alert)
                        .text_color(p.palette.error)
                        .whitespace_normal()
                        .child(self.t(error)),
                );
            } else if state.status == "saved" {
                body = body.child(
                    div()
                        .id("harness-status")
                        .role(Role::Status)
                        .text_color(p.palette.success)
                        .child(self.t("harness.saved")),
                );
            }
            body = body.child(
                div()
                    .flex()
                    .flex_wrap()
                    .items_center()
                    .gap(px(8.))
                    .child(
                        pero_theme::action_button(
                            "harness-save",
                            self.t(if saving {
                                "harness.saving"
                            } else {
                                "harness.save"
                            }),
                            pero_theme::ActionKind::Primary,
                            pero_theme::Chrome::from_app(cx),
                            cx,
                        )
                            .disabled(disabled || !state.persistence_available)
                            .on_click(cx.listener(|this, _, _, cx| {
                                let values = this
                                    .harness_inputs
                                    .each_ref()
                                    .map(|input| input.read(cx).value().to_string());
                                if let Some(state) = this.harness.as_mut() {
                                    state.status = "saving".into();
                                    state.error = None;
                                }
                                cx.emit(SettingsAction::Harness(HarnessControl::Save {
                                    endpoint: values[0].clone(),
                                    model: values[1].clone(),
                                    api_key: values[2].clone(),
                                    clear_key: false,
                                }));
                                cx.notify();
                            })),
                    )
                    .child(
                        pero_theme::action_button(
                            "harness-clear-key",
                            self.t(if self.harness_remove_confirm {
                                "harness.confirm_remove"
                            } else {
                                "harness.clear_key"
                            }),
                            pero_theme::ActionKind::Ghost,
                            pero_theme::Chrome::from_app(cx),
                            cx,
                        )
                            .disabled(
                                disabled
                                    || !state.credential_configured
                                    || !state.persistence_available,
                            )
                            .on_click(cx.listener(|this, _, _, cx| {
                                if !this.harness_remove_confirm {
                                    this.harness_remove_confirm = true;
                                    cx.notify();
                                    return;
                                }
                                let Some(state) = this.harness.as_mut() else {
                                    return;
                                };
                                state.status = "saving".into();
                                state.error = None;
                                cx.emit(SettingsAction::Harness(HarnessControl::Save {
                                    endpoint: state.endpoint.clone(),
                                    model: state.model.clone(),
                                    api_key: String::new(),
                                    clear_key: true,
                                }));
                                cx.notify();
                            })),
                    ),
            );
            if !state.persistence_available {
                body = body.child(
                    div()
                        .id("harness-error")
                        .role(Role::Alert)
                        .text_color(p.palette.error)
                        .whitespace_normal()
                        .child(self.t("harness.storage_error")),
                );
            }
        } else {
            body = body.child(self.t("harness.loading"));
        }
        body.child(
            div()
                .text_size(p.text(TextRole::Caption))
                .text_color(p.palette.text_muted)
                .whitespace_normal()
                .child(self.t("harness.new_sessions")),
        )
        .into_any_element()
    }
}
