//! Shortcut settings edit the contract model; Host acknowledgement owns saved state.
use crate::{settings_menu::PreferenceSaveState, settings_view::SettingsPanel};
use gpui_kit::{
    component::{
        button::*,
        input::{Input, InputState},
        *,
    },
    prelude::*,
    *,
};
use pero_contracts::shortcuts::{CommandId, KeySequence, ShortcutEdit, ShortcutError};

pub(crate) struct ShortcutEditor {
    pub search: Entity<InputState>,
    pub input: Entity<InputState>,
    focus: FocusHandle,
    editing: Option<(CommandId, Option<usize>)>,
    recording: bool,
    strokes: Vec<String>,
    error: Option<String>,
    conflict: bool,
    modified_only: bool,
    reset_all: bool,
    saving: bool,
}
impl ShortcutEditor {
    pub fn new(window: &mut Window, cx: &mut App) -> Self {
        Self {
            search: cx.new(|cx| InputState::new(window, cx)),
            input: cx.new(|cx| InputState::new(window, cx)),
            focus: cx.focus_handle(),
            editing: None,
            recording: false,
            strokes: vec![],
            error: None,
            conflict: false,
            modified_only: false,
            reset_all: false,
            saving: false,
        }
    }
    pub fn recording(&self) -> bool {
        self.recording
    }
    pub fn clear_error(&mut self) {
        self.error = None;
        self.conflict = false;
    }
    pub fn receive(&mut self, status: PreferenceSaveState, error: Option<&str>) -> bool {
        if self.saving && status == PreferenceSaveState::Saved && error.is_none() {
            self.editing = None;
            self.error = None;
            self.saving = false;
            self.reset_all = false;
            return true;
        } else if error.is_some() {
            self.saving = false;
        }
        false
    }
}

impl SettingsPanel {
    pub(crate) fn cancel_shortcut_edit(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        if self.shortcuts.editing.take().is_none() && !self.shortcuts.reset_all {
            return false;
        }
        self.shortcuts.recording = false;
        self.shortcuts.reset_all = false;
        self.shortcuts.error = None;
        self.shortcuts
            .search
            .update(cx, |input, cx| input.focus(window, cx));
        cx.notify();
        true
    }
    fn edit_shortcut(
        &mut self,
        command: CommandId,
        index: Option<usize>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let keys = self
            .preferences
            .shortcuts
            .bindings(command, crate::shortcuts::platform(cx));
        let value = index
            .and_then(|index| keys.get(index))
            .map(ToString::to_string)
            .unwrap_or_default();
        self.shortcuts.editing = Some((command, index));
        self.shortcuts.error = None;
        self.shortcuts.conflict = false;
        self.shortcuts.input.update(cx, |input, cx| {
            input.set_value(value, window, cx);
            input.focus(window, cx);
            input.select_all(window, cx);
        });
        cx.notify();
    }
    fn apply_shortcut_edit(&mut self, edit: ShortcutEdit, cx: &mut Context<Self>) {
        match self
            .preferences
            .shortcuts
            .apply(crate::shortcuts::platform(cx), edit)
        {
            Ok(shortcuts) => {
                let mut next = self.preferences.clone();
                next.shortcuts = shortcuts;
                self.shortcuts.recording = false;
                self.shortcuts.saving = next != self.preferences;
                if !self.shortcuts.saving {
                    self.shortcuts.editing = None;
                    self.shortcuts.reset_all = false;
                }
                self.save_preferences(next, cx);
            }
            Err(error) => {
                self.shortcuts.conflict = matches!(error, ShortcutError::Conflicts(_));
                self.shortcuts.error = Some(match error {
                    ShortcutError::Conflicts(conflicts) => format!(
                        "{}: {}",
                        self.t("shortcuts.conflict"),
                        conflicts
                            .iter()
                            .map(|conflict| format!(
                                "{} / {}",
                                self.t(conflict.command.label_key()),
                                self.t(conflict.other.label_key())
                            ))
                            .collect::<Vec<_>>()
                            .join(", ")
                    ),
                    ShortcutError::Invalid(_) => self.t("shortcuts.invalid").into(),
                });
            }
        }
        cx.notify();
    }
    fn save_shortcut(&mut self, reassign: bool, cx: &mut Context<Self>) {
        let Some((command, index)) = self.shortcuts.editing else {
            return;
        };
        let source = self.shortcuts.input.read(cx).value();
        let sequence = match source.parse::<KeySequence>() {
            Ok(sequence) => sequence,
            Err(_) => {
                self.shortcuts.error = Some(self.t("shortcuts.invalid").into());
                self.shortcuts.conflict = false;
                cx.notify();
                return;
            }
        };
        let mut bindings = self
            .preferences
            .shortcuts
            .bindings(command, crate::shortcuts::platform(cx));
        if let Some(index) = index {
            bindings[index] = sequence;
        } else {
            bindings.push(sequence);
        }
        self.apply_shortcut_edit(
            ShortcutEdit::Replace {
                command,
                bindings,
                reassign,
            },
            cx,
        );
    }
    pub(crate) fn record_shortcut(
        &mut self,
        event: &KeyDownEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        if !self.shortcuts.recording {
            return false;
        }
        window.prevent_default();
        cx.stop_propagation();
        let key = &event.keystroke;
        if key.key == "escape" {
            self.cancel_shortcut_edit(window, cx);
            return true;
        }
        if event.is_held || matches!(key.key.as_str(), "shift" | "control" | "alt" | "cmd" | "fn") {
            return true;
        }
        if self.shortcuts.strokes.len() == 2 {
            return true;
        }
        let m = key.modifiers;
        let mut value = String::new();
        for (enabled, name) in [
            (m.platform, "cmd-"),
            (m.control, "ctrl-"),
            (m.alt, "alt-"),
            (m.shift, "shift-"),
        ] {
            if enabled {
                value.push_str(name);
            }
        }
        value.push_str(&key.key.to_ascii_lowercase());
        self.shortcuts.strokes.push(value);
        let value = self.shortcuts.strokes.join(" ");
        self.shortcuts
            .input
            .update(cx, |input, cx| input.set_value(value, window, cx));
        cx.notify();
        true
    }
    pub(crate) fn shortcut_settings(&self, cx: &mut Context<Self>) -> AnyElement {
        let platform = crate::shortcuts::platform(cx);
        let query = self.shortcuts.search.read(cx).value().to_lowercase();
        let saving = self.preferences_status == PreferenceSaveState::Saving;
        let appearance = pero_theme::UiAppearance::global(cx).clone();
        let p = appearance.palette.clone();
        let mut list = div()
            .flex()
            .flex_col()
            .gap(px(12.))
            .child(
                div()
                    .text_color(p.text_muted)
                    .child(self.t("shortcuts.hint")),
            )
            .child(Input::new(&self.shortcuts.search))
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .gap(px(8.))
                    .child(
                        Button::new("shortcuts-modified")
                            .small()
                            .ghost()
                            .label(self.t(if self.shortcuts.modified_only {
                                "shortcuts.show_all"
                            } else {
                                "shortcuts.modified"
                            }))
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.shortcuts.modified_only = !this.shortcuts.modified_only;
                                cx.notify();
                            })),
                    )
                    .child(
                        Button::new("shortcuts-reset-all")
                            .small()
                            .ghost()
                            .label(self.t("shortcuts.reset_all"))
                            .disabled(saving)
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.shortcuts.reset_all = true;
                                cx.notify();
                            })),
                    ),
            );
        if self.shortcuts.reset_all {
            list = list.child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(8.))
                    .child(self.t("shortcuts.reset_confirm"))
                    .child(
                        div()
                            .flex()
                            .gap(px(8.))
                            .child(
                                Button::new("shortcuts-reset-confirm")
                                    .small()
                                    .label(self.t("shortcuts.reset_all"))
                                    .disabled(saving)
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.apply_shortcut_edit(ShortcutEdit::ResetAll, cx)
                                    })),
                            )
                            .child(
                                Button::new("shortcuts-reset-cancel")
                                    .small()
                                    .ghost()
                                    .label(self.t("shortcuts.cancel"))
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.shortcuts.reset_all = false;
                                        cx.notify();
                                    })),
                            ),
                    ),
            );
        }
        if let Some((command, _)) = self.shortcuts.editing {
            list = list.child(
                div()
                    .id("shortcut-editor")
                    .track_focus(&self.shortcuts.focus)
                    .flex()
                    .flex_col()
                    .gap(px(8.))
                    .child(self.t(command.label_key()))
                    .child(Input::new(&self.shortcuts.input).disabled(saving))
                    .child(div().text_color(p.text_muted).child(self.t(
                        if self.shortcuts.recording {
                            "shortcuts.recording"
                        } else {
                            "shortcuts.syntax"
                        },
                    )))
                    .child(
                        div()
                            .flex()
                            .flex_wrap()
                            .gap(px(8.))
                            .child(
                                Button::new("shortcuts-record")
                                    .small()
                                    .label(self.t("shortcuts.record"))
                                    .disabled(saving)
                                    .on_click(cx.listener(|this, _, window, cx| {
                                        this.shortcuts.recording = true;
                                        this.shortcuts.strokes.clear();
                                        this.shortcuts.focus.focus(window, cx);
                                        cx.notify();
                                    })),
                            )
                            .child(
                                Button::new("shortcuts-save")
                                    .small()
                                    .label(self.t("shortcuts.save"))
                                    .disabled(saving)
                                    .on_click(
                                        cx.listener(|this, _, _, cx| this.save_shortcut(false, cx)),
                                    ),
                            )
                            .when(self.shortcuts.conflict, |el| {
                                el.child(
                                    Button::new("shortcuts-reassign")
                                        .small()
                                        .label(self.t("shortcuts.reassign"))
                                        .disabled(saving)
                                        .on_click(cx.listener(|this, _, _, cx| {
                                            this.save_shortcut(true, cx)
                                        })),
                                )
                            })
                            .child(
                                Button::new("shortcuts-cancel")
                                    .small()
                                    .ghost()
                                    .label(self.t("shortcuts.cancel"))
                                    .disabled(saving)
                                    .on_click(cx.listener(|this, _, window, cx| {
                                        this.cancel_shortcut_edit(window, cx);
                                    })),
                            ),
                    ),
            );
        }
        if let Some(error) = self.shortcuts.error.clone() {
            list = list.child(
                div()
                    .id("shortcut-error")
                    .role(Role::Alert)
                    .text_color(p.error)
                    .child(error),
            );
        }
        let mut count = 0;
        for command in CommandId::ALL.iter().copied() {
            let bindings = self.preferences.shortcuts.bindings(command, platform);
            let modified = self.preferences.shortcuts.modified(command, platform);
            let label = self.t(command.label_key());
            let searchable = format!(
                "{label} {} {}",
                bindings
                    .iter()
                    .map(ToString::to_string)
                    .collect::<Vec<_>>()
                    .join(" "),
                bindings
                    .iter()
                    .map(|key| key.label(platform))
                    .collect::<Vec<_>>()
                    .join(" ")
            )
            .to_lowercase();
            if !query
                .split_whitespace()
                .all(|term| searchable.contains(term))
                || self.shortcuts.modified_only && !modified
            {
                continue;
            }
            count += 1;
            let mut controls = div().flex().flex_wrap().gap(px(4.));
            for (index, key) in bindings.iter().enumerate() {
                controls = controls
                    .child(
                        Button::new(SharedString::from(format!(
                            "shortcut-binding-{command:?}-{index}"
                        )))
                        .small()
                        .label(key.label(platform))
                        .disabled(saving)
                        .on_click(cx.listener(
                            move |this, _, window, cx| {
                                this.edit_shortcut(command, Some(index), window, cx)
                            },
                        )),
                    )
                    .child(
                        Button::new(SharedString::from(format!(
                            "shortcut-remove-{command:?}-{index}"
                        )))
                        .small()
                        .ghost()
                        .label("×")
                        .accessibility_label(self.t("shortcuts.remove"))
                        .disabled(saving)
                        .on_click(cx.listener(move |this, _, _, cx| {
                            let mut bindings = this
                                .preferences
                                .shortcuts
                                .bindings(command, crate::shortcuts::platform(cx));
                            bindings.remove(index);
                            this.apply_shortcut_edit(
                                ShortcutEdit::Replace {
                                    command,
                                    bindings,
                                    reassign: false,
                                },
                                cx,
                            );
                        })),
                    );
            }
            if bindings.is_empty() {
                controls = controls.child(
                    div()
                        .text_color(p.text_muted)
                        .child(self.t("shortcuts.unassigned")),
                );
            }
            controls = controls.child(
                Button::new(("shortcut-add", command as usize))
                    .small()
                    .ghost()
                    .label("+")
                    .accessibility_label(self.t("shortcuts.add"))
                    .disabled(saving || bindings.len() >= 4)
                    .on_click(cx.listener(move |this, _, window, cx| {
                        this.edit_shortcut(command, None, window, cx)
                    })),
            );
            if modified {
                controls = controls.child(
                    Button::new(("shortcut-reset", command as usize))
                        .small()
                        .ghost()
                        .label(self.t("shortcuts.reset"))
                        .disabled(saving)
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.apply_shortcut_edit(ShortcutEdit::Reset(command), cx)
                        })),
                );
            }
            list = list.child(
                div()
                    .id(("shortcut-row", command as usize))
                    .flex()
                    .flex_col()
                    .gap(px(4.))
                    .py(px(8.))
                    .border_b_1()
                    .border_color(p.border)
                    .child(
                        div().flex().flex_wrap().gap(px(8.)).child(label).child(
                            div()
                                .text_color(p.text_muted)
                                .text_size(appearance.text(pero_theme::TextRole::Caption))
                                .child(self.t(match command.scope() {
                                    pero_contracts::shortcuts::ShortcutScope::Workbench => {
                                        "shortcuts.workbench"
                                    }
                                    _ => "shortcuts.settings",
                                })),
                        ),
                    )
                    .child(controls),
            );
        }
        if count == 0 {
            list = list.child(self.t("shortcuts.empty"));
        }
        list.into_any_element()
    }
}
