//! Computer Use controls project Desktop state; the Host persists the switch.
use crate::{
    app::Workbench,
    settings_view::{SettingsAction, SettingsPanel},
};
use gpui_kit::{
    component::{checkbox::Checkbox, *},
    prelude::*,
    *,
};
use pero_contracts::{
    HostEvent,
    computer_runtime::{ComputerControl, ComputerPermissionState, ComputerUseState},
};
use pero_theme::SettingMessage;

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
        let mut body = div().id("computer-settings").flex().flex_col().child(
            pero_theme::settings_check(
                self.t("computer.enable"),
                Some(self.t("computer.hint").into()),
                Checkbox::new("computer-enable")
                    .label(self.t("computer.enable"))
                    .checked(enabled)
                    .disabled((unavailable && !enabled) || self.computer_pending)
                    .on_click(cx.listener(|this, enabled: &bool, _, cx| {
                        this.computer_control(ComputerControl::Set { enabled: *enabled }, cx)
                    }))
                    .into_any_element(),
                pero_theme::Chrome::from_app(cx),
            ),
        );
        if let Some(state) = state {
            for (label, value) in [
                ("computer.accessibility", state.status.accessibility),
                ("computer.screen_recording", state.status.screen_recording),
            ] {
                body = body.child(pero_theme::settings_status(
                    self.t(label),
                    permission(value),
                    pero_theme::Chrome::from_app(cx),
                ));
            }
            body = body.child(pero_theme::settings_message(
                self.t(if unavailable {
                    "computer.unsupported"
                } else if running {
                    "computer.running"
                } else if enabled {
                    "computer.ready"
                } else {
                    "computer.disabled"
                }),
                SettingMessage::Status,
                pero_theme::Chrome::from_app(cx),
            ));
            if let Some(error) = &state.error {
                body = body.child(
                    pero_theme::settings_message(error.clone(), SettingMessage::Error, pero_theme::Chrome::from_app(cx))
                        .id("computer-error")
                        .role(Role::Alert),
                );
            }
        } else {
            body = body.child(pero_theme::settings_message(
                self.t("computer.loading"),
                SettingMessage::Status,
                pero_theme::Chrome::from_app(cx),
            ));
        }
        body.child(pero_theme::settings_actions(
            [
                pero_theme::action_button(
                    "computer-permissions",
                    self.t("computer.permissions"),
                    pero_theme::ActionKind::Ghost,
                    pero_theme::Chrome::from_app(cx),
                    cx,
                )
                .disabled(unavailable || self.computer_pending || state.is_some_and(|s| s.status.accessibility == ComputerPermissionState::Unsupported && s.status.screen_recording == ComputerPermissionState::Unsupported))
                .on_click(cx.listener(|this, _, _, cx| {
                    this.computer_control(ComputerControl::Permissions {}, cx)
                }))
                .into_any_element(),
                pero_theme::action_button(
                    "computer-refresh",
                    self.t("computer.refresh"),
                    pero_theme::ActionKind::Ghost,
                    pero_theme::Chrome::from_app(cx),
                    cx,
                )
                .disabled(self.computer_pending)
                .on_click(cx.listener(|this, _, _, cx| {
                    this.computer_control(ComputerControl::Get {}, cx)
                }))
                .into_any_element(),
                pero_theme::action_button(
                    "computer-stop",
                    self.t("computer.stop"),
                    pero_theme::ActionKind::Ghost,
                    pero_theme::Chrome::from_app(cx),
                    cx,
                )
                .disabled(!enabled && !running)
                .on_click(cx.listener(|this, _, _, cx| {
                    this.computer_control(ComputerControl::Stop {}, cx)
                }))
                .into_any_element(),
            ],
            pero_theme::Chrome::from_app(cx),
        ))
        .child(pero_theme::settings_message(
            self.t("computer.stop_hint"),
            SettingMessage::Help,
            pero_theme::Chrome::from_app(cx),
        ))
        .into_any_element()
    }
}
