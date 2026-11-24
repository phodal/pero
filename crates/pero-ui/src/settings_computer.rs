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
    #[cfg(not(target_family = "wasm"))]
    pub(crate) fn computer_failed(&mut self, error: String, cx: &mut Context<Self>) {
        use pero_contracts::computer_runtime::ComputerDriverStatus;
        self.computer = Some(ComputerUseState {
            enabled: false,
            running: false,
            status: ComputerDriverStatus {
                environment: None,
                available: false,
                accessibility: ComputerPermissionState::NotDetected,
                screen_recording: ComputerPermissionState::NotDetected,
                message: String::new(),
            },
            applications: None,
            error: Some(error),
        });
        self.sync_settings_panel(cx);
        cx.notify();
    }

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
        let mut body =
            div()
                .id("computer-settings")
                .flex()
                .flex_col()
                .child(pero_theme::settings_check(
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
                ));
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
            if !state.status.message.is_empty() {
                body = body.child(pero_theme::settings_message(
                    state.status.message.clone(),
                    SettingMessage::Help,
                    pero_theme::Chrome::from_app(cx),
                ));
            }
            body = body.child(pero_theme::settings_message(
                self.t(if unavailable {
                    "computer.unavailable"
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
                    pero_theme::settings_message(
                        error.clone(),
                        SettingMessage::Error,
                        pero_theme::Chrome::from_app(cx),
                    )
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
        let mut actions = Vec::new();
        #[cfg(target_os = "macos")]
        if let Some(path) = crate::native::computer_app().filter(|path| path.is_dir()) {
            let drag_source = pero_theme::settings_status(
                "Pero Computer Use.app",
                self.t("computer.drag_badge"),
                pero_theme::Chrome::from_app(cx),
            )
            .id("computer-drag-helper")
            .cursor_grab()
            .on_drag(path.clone(), |_, _, _, cx| cx.new(|_| gpui_kit::Empty))
            .external_drag_payload(|path: &std::path::PathBuf, _, _| {
                Some(ExternalDragPayload::Files(FileDragPaths::new([(
                    path.clone(),
                    true,
                )])))
            });
            body = body
                .child(pero_theme::settings_message(
                    self.t("computer.drag_help"),
                    SettingMessage::Help,
                    pero_theme::Chrome::from_app(cx),
                ))
                .child(drag_source);
            actions.push(
                pero_theme::action_button(
                    "computer-reveal-helper",
                    self.t("computer.reveal_helper"),
                    pero_theme::ActionKind::Ghost,
                    pero_theme::Chrome::from_app(cx),
                    cx,
                )
                .on_click(move |_, _, _| {
                    if let Err(error) = std::process::Command::new("/usr/bin/open")
                        .arg("-R")
                        .arg(&path)
                        .spawn()
                    {
                        eprintln!("Could not reveal Pero Computer Use: {error}");
                    }
                })
                .into_any_element(),
            );
        }
        #[cfg(target_os = "macos")]
        for (id, label, url) in [
            (
                "computer-permissions-ax",
                "computer.open_accessibility",
                "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
            ),
            (
                "computer-permissions-screen",
                "computer.open_screen_recording",
                "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
            ),
        ] {
            actions.push(
                pero_theme::action_button(
                    id,
                    self.t(label),
                    pero_theme::ActionKind::Ghost,
                    pero_theme::Chrome::from_app(cx),
                    cx,
                )
                .on_click(move |_, _, cx| cx.open_url(url))
                .into_any_element(),
            );
        }
        #[cfg(target_family = "wasm")]
        actions.push(
            pero_theme::action_button(
                "computer-permissions",
                self.t("computer.permissions"),
                pero_theme::ActionKind::Ghost,
                pero_theme::Chrome::from_app(cx),
                cx,
            )
            .disabled(
                unavailable
                    || self.computer_pending
                    || state.is_some_and(|s| {
                        s.status.accessibility == ComputerPermissionState::Unsupported
                            && s.status.screen_recording == ComputerPermissionState::Unsupported
                    }),
            )
            .on_click(cx.listener(|this, _, _, cx| {
                this.computer_control(ComputerControl::Permissions {}, cx)
            }))
            .into_any_element(),
        );
        actions.extend([
            pero_theme::action_button(
                "computer-refresh",
                self.t("computer.refresh"),
                pero_theme::ActionKind::Ghost,
                pero_theme::Chrome::from_app(cx),
                cx,
            )
            .disabled(self.computer_pending)
            .on_click(
                cx.listener(|this, _, _, cx| this.computer_control(ComputerControl::Get {}, cx)),
            )
            .into_any_element(),
            pero_theme::action_button(
                "computer-stop",
                self.t("computer.stop"),
                pero_theme::ActionKind::Ghost,
                pero_theme::Chrome::from_app(cx),
                cx,
            )
            .disabled(!enabled && !running)
            .on_click(
                cx.listener(|this, _, _, cx| this.computer_control(ComputerControl::Stop {}, cx)),
            )
            .into_any_element(),
        ]);
        body = body.child(pero_theme::settings_actions(
            actions,
            pero_theme::Chrome::from_app(cx),
        ));
        #[cfg(any(target_family = "wasm", target_os = "macos"))]
        {
            body = body.child(pero_theme::settings_message(
                self.t("computer.stop_hint"),
                SettingMessage::Help,
                pero_theme::Chrome::from_app(cx),
            ));
        }
        if let Some(applications) = state.and_then(|state| state.applications.as_ref()) {
            let mut rows = vec![
                pero_theme::settings_message(
                    self.t("computer.application_hint"),
                    SettingMessage::Help,
                    pero_theme::Chrome::from_app(cx),
                )
                .into_any_element(),
            ];
            for application in applications {
                let application_id = application.application_id.clone();
                rows.push(
                    pero_theme::settings_check(
                        application.name.clone(),
                        Some(application_id.as_str().to_owned().into()),
                        Checkbox::new(SharedString::from(format!(
                            "computer-app-{}",
                            application_id.as_str()
                        )))
                        .label(application.name.clone())
                        .checked(application.allowed)
                        .disabled(self.computer_pending)
                        .on_click(cx.listener(move |this, allowed: &bool, _, cx| {
                            this.computer_control(
                                ComputerControl::SetApplication {
                                    application_id: application_id.clone(),
                                    allowed: *allowed,
                                },
                                cx,
                            );
                        }))
                        .into_any_element(),
                        pero_theme::Chrome::from_app(cx),
                    )
                    .into_any_element(),
                );
            }
            body = body.child(pero_theme::settings_group(
                Some(self.t("computer.application_access").into()),
                rows,
                pero_theme::Chrome::from_app(cx),
            ));
        }
        body.into_any_element()
    }
}
