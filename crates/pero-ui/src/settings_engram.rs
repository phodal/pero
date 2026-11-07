//! Engram is an optional external process. Insights sessions do not receive it.
use super::settings_view::{SettingsAction, SettingsPanel};
use gpui_kit::{
    component::{checkbox::Checkbox, input::Input, *},
    prelude::*,
    *,
};
use pero_contracts::{HostEvent, engram::EngramSettings};

impl SettingsPanel {
    pub(crate) fn apply_engram(&mut self, event: &HostEvent, window: &mut Window, cx: &mut Context<Self>) {
        if event.kind == "engram_settings_error" {
            self.error = Some("engram.invalid".into());
            cx.notify();
            return;
        }
        let Ok(settings) = serde_json::from_value::<EngramSettings>(event.data.clone()) else {
            return;
        };
        self.engram = settings.clone();
        if self.error.as_deref() == Some("engram.invalid") {
            self.error = None;
        }
        self.engram_binary.update(cx, |input, cx| input.set_value(settings.binary, window, cx));
        cx.notify();
    }

    pub(crate) fn save_engram(&mut self, binary: String, cx: &mut Context<Self>) {
        let settings = EngramSettings { enabled: self.engram.enabled, binary };
        if !settings.valid() {
            self.error = Some("engram.invalid".into());
            cx.notify();
            return;
        }
        self.engram = settings.clone();
        self.error = None;
        cx.emit(SettingsAction::Engram(settings));
        cx.notify();
    }

    pub(crate) fn engram_settings(&self, cx: &mut Context<Self>) -> AnyElement {
        div().id("engram-settings").flex().flex_col()
            .child(pero_theme::settings_check(
                self.t("engram.enable"),
                Some(self.t("engram.hint").into()),
                Checkbox::new("engram-enable")
                    .label(self.t("engram.enable"))
                    .checked(self.engram.enabled)
                    .on_click(cx.listener(|this, enabled: &bool, _, cx| {
                        this.engram.enabled = *enabled;
                        let binary = this.engram_binary.read(cx).value().to_string();
                        this.save_engram(binary, cx);
                    }))
                    .into_any_element(),
                pero_theme::Chrome::from_app(cx),
            ))
            .child(pero_theme::settings_field(
                self.t("engram.binary"),
                None,
                Input::new(&self.engram_binary).small().w_full().into_any_element(),
                pero_theme::Chrome::from_app(cx),
            ))
            .into_any_element()
    }
}

impl crate::app::Workbench {
    pub(crate) fn receive_engram(&mut self, event: &HostEvent, window: &mut Window, cx: &mut Context<Self>) -> bool {
        if event.kind != "engram_settings" && event.kind != "engram_settings_error" {
            return false;
        }
        if let Some(panel) = &self.settings_panel {
            panel.update(cx, |panel, cx| panel.apply_engram(event, window, cx));
        }
        true
    }
}
