//! Computer Use controls project Desktop state; the Host persists the switch.
use crate::{
    app::Workbench,
    settings_view::{SettingsAction, SettingsPanel},
};
use gpui_kit::{
    component::{button::*, checkbox::Checkbox, *},
    prelude::*,
    *,
};
use pero_contracts::{
    HostEvent,
    computer_runtime::{ComputerControl, ComputerPermissionState, ComputerUseState},
};
use pero_theme::{TextRole, UiAppearance};

impl Workbench {
    pub(crate) fn receive_computer(&mut self, event: &HostEvent, cx: &mut Context<Self>) -> bool {
        if event.kind != "computer_state" {
            return false;
        }
        if let Ok(state) = serde_json::from_value::<ComputerUseState>(event.data.clone()) {
            self.computer = Some(state);
            self.sync_settings_panel(cx);
            cx.notify();
        }
        true
    }
}

impl SettingsPanel {
    pub(crate) fn computer_control(&mut self, control: ComputerControl, cx: &mut Context<Self>) {
        self.computer_pending = true;
        cx.emit(SettingsAction::Computer(control));
        cx.notify();
    }
    pub(crate) fn computer_settings(&self, cx: &mut Context<Self>) -> AnyElement {
        let p = UiAppearance::global(cx);
        let state = self.computer.as_ref();
        let unavailable = state.is_none_or(|state| !state.status.available);
        let enabled = state.is_some_and(|state| state.enabled);
        let running = state.is_some_and(|state| state.running);
        let permission = |value| {
            self.t(match value {
                ComputerPermissionState::Granted => "computer.granted",
                ComputerPermissionState::NotDetected => "computer.not_detected",
                ComputerPermissionState::Unsupported => "computer.unsupported",
            })
        };
        let mut body = div()
            .flex()
            .flex_col()
            .gap(px(12.))
            .pt(px(12.))
            .child(
                Checkbox::new("computer-enable")
                    .label(self.t("computer.enable"))
                    .checked(enabled)
                    .disabled((unavailable && !enabled) || self.computer_pending)
                    .on_click(cx.listener(|this, enabled: &bool, _, cx| {
                        this.computer_control(ComputerControl::Set { enabled: *enabled }, cx)
                    })),
            )
            .child(
                div()
                    .text_color(p.palette.text_muted)
                    .text_size(p.text(TextRole::Caption))
                    .whitespace_normal()
                    .child(self.t("computer.hint")),
            );
        if let Some(state) = state {
            for (label, value) in [
                ("computer.accessibility", state.status.accessibility),
                ("computer.screen_recording", state.status.screen_recording),
            ] {
                body = body.child(
                    div()
                        .flex()
                        .justify_between()
                        .gap(px(12.))
                        .child(self.t(label))
                        .child(permission(value)),
                );
            }
            body = body.child(div().child(self.t(if unavailable {
                "computer.unsupported"
            } else if running {
                "computer.running"
            } else if enabled {
                "computer.ready"
            } else {
                "computer.disabled"
            })));
            if let Some(error) = &state.error {
                body = body.child(
                    div()
                        .id("computer-error")
                        .role(Role::Alert)
                        .whitespace_normal()
                        .text_color(p.palette.error)
                        .child(error.clone()),
                );
            }
        } else {
            body = body.child(self.t("computer.loading"));
        }
        body.child(
            div()
                .flex()
                .flex_wrap()
                .gap(px(8.))
                .child(
                    Button::new("computer-permissions")
                        .small()
                        .outline()
                        .label(self.t("computer.permissions"))
                        .disabled(unavailable || self.computer_pending || state.is_some_and(|s| s.status.accessibility == ComputerPermissionState::Unsupported && s.status.screen_recording == ComputerPermissionState::Unsupported))
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.computer_control(ComputerControl::Permissions {}, cx)
                        })),
                )
                .child(
                    Button::new("computer-refresh")
                        .small()
                        .outline()
                        .label(self.t("computer.refresh"))
                        .disabled(self.computer_pending)
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.computer_control(ComputerControl::Get {}, cx)
                        })),
                )
                .child(
                    Button::new("computer-stop")
                        .small()
                        .outline()
                        .label(self.t("computer.stop"))
                        .disabled(!enabled && !running)
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.computer_control(ComputerControl::Stop {}, cx)
                        })),
                ),
        )
        .child(
            div()
                .text_size(p.text(TextRole::Caption))
                .text_color(p.palette.text_muted)
                .child(self.t("computer.stop_hint")),
        )
        .into_any_element()
    }
}
