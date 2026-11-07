//! Memory page: a switch and two Markdown layers. Insights sessions do not receive them.
use super::settings_view::{SettingsAction, SettingsPanel};
use gpui_kit::{
    component::{
        button::*,
        checkbox::Checkbox,
        input::{Input, Textarea, TextareaState},
        *,
    },
    prelude::*,
    *,
};
use pero_contracts::{HostEvent, engram::MemoryPage};
use std::path::Path;

impl SettingsPanel {
    pub(crate) fn apply_engram(&mut self, event: &HostEvent, window: &mut Window, cx: &mut Context<Self>) {
        if event.kind == "engram_settings_error" {
            let key = if event.text.starts_with("engram.") {
                event.text.clone()
            } else {
                "engram.invalid".into()
            };
            self.error = Some(key);
            cx.notify();
            return;
        }
        let Ok(page) = serde_json::from_value::<MemoryPage>(event.data.clone()) else {
            return;
        };
        self.engram.enabled = page.enabled;
        self.engram.binary = page.binary.clone();
        if self.error.as_deref().is_some_and(|error| error.starts_with("engram.")) {
            self.error = None;
        }
        self.engram_binary.update(cx, |input, cx| input.set_value(page.binary, window, cx));
        assign(&self.memory_global, &page.global, window, cx);
        assign(&self.memory_project, &page.project, window, cx);
        self.memory_global_saved = page.global;
        self.memory_project_saved = page.project;
        self.memory_workspace = page.workspace;
        cx.notify();
    }

    pub(crate) fn save_engram(&mut self, binary: String, cx: &mut Context<Self>) {
        let settings = pero_contracts::engram::EngramSettings { enabled: self.engram.enabled, binary };
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
        let name = Path::new(&self.memory_workspace)
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .filter(|name| !name.is_empty())
            .unwrap_or_else(|| self.memory_workspace.clone());
        let global_dirty = self.memory_global.read(cx).value().as_ref() != self.memory_global_saved;
        let project_dirty = self.memory_project.read(cx).value().as_ref() != self.memory_project_saved;
        let global = self.memory_editor(
            "engram-global",
            self.t("engram.global"),
            self.t("engram.global_hint"),
            &self.memory_global,
            "global",
            global_dirty,
            cx,
        );
        let project = (!self.memory_workspace.is_empty()).then(|| {
            self.memory_editor(
                "engram-project",
                format!("{} — {name}", self.t("engram.project")),
                self.t("engram.project_hint"),
                &self.memory_project,
                "project",
                project_dirty,
                cx,
            )
        });
        let chrome = pero_theme::Chrome::from_app(cx);
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
                chrome,
            ))
            .child(global)
            .child(project.unwrap_or_else(|| {
                pero_theme::settings_field(
                    self.t("engram.project"),
                    Some(self.t("engram.project_hint").into()),
                    div().text_color(chrome.palette.text_muted).child(self.t("engram.project_none")).into_any_element(),
                    chrome,
                ).into_any_element()
            }))
            .when(!self.engram.enabled, |page| {
                page.child(
                    div()
                        .px(chrome.geo(pero_theme::SPACE_16))
                        .text_size(chrome.text(pero_theme::TYPE_CAPTION))
                        .text_color(chrome.palette.text_muted)
                        .child(self.t("engram.disabled_note")),
                )
            })
            .child(pero_theme::settings_field(
                self.t("engram.binary"),
                Some(self.t("engram.binary_hint").into()),
                Input::new(&self.engram_binary).small().w_full().into_any_element(),
                chrome,
            ))
            .into_any_element()
    }

    fn memory_editor(
        &self,
        id: &'static str,
        title: impl Into<SharedString>,
        hint: impl Into<SharedString>,
        state: &Entity<TextareaState>,
        scope: &'static str,
        dirty: bool,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let chrome = pero_theme::Chrome::from_app(cx);
        pero_theme::settings_field(
            title,
            Some(hint.into()),
            div()
                .flex()
                .flex_col()
                .gap(chrome.geo(pero_theme::SPACE_8))
                .child(Textarea::new(state).aria_label(self.t("engram.title")).h(px(140.)))
                .child(
                    div().flex().justify_end().child(
                        Button::new(id)
                            .small()
                            .primary()
                            .label(self.t("engram.save"))
                            .disabled(!dirty)
                            .on_click(cx.listener(move |this, _, _, cx| {
                                let text = match scope {
                                    "global" => this.memory_global.read(cx).value().to_string(),
                                    _ => this.memory_project.read(cx).value().to_string(),
                                };
                                cx.emit(SettingsAction::Mcp(serde_json::json!({
                                    "method": "settings.engram.document",
                                    "scope": scope,
                                    "text": text,
                                })));
                            })),
                    ),
                )
                .into_any_element(),
            chrome,
        )
        .into_any_element()
    }
}

fn assign(input: &Entity<TextareaState>, text: &str, window: &mut Window, cx: &mut App) {
    if input.read(cx).value().as_ref() != text {
        input.update(cx, |state, cx| state.set_value(text.to_string(), window, cx));
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
