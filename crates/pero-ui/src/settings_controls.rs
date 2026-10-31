//! Settings controls follow the IntelliJ Kotlin UI DSL row factories:
//! `row`, `checkBox`, `textField`, `comment`, and `group`.
//! Help text that repeats a label is dropped by those factories.
use gpui_kit::{
    component::{
        button::*,
        input::{Input, InputState},
        *,
    },
    prelude::*,
    *,
};
use pero_contracts::appearance::FontSize;
use std::rc::Rc;

pub(crate) fn selection_button(
    id: &'static str,
    label: &'static str,
    name: &'static str,
    cx: &App,
) -> Button {
    let chrome = pero_theme::Chrome::from_app(cx);
    pero_theme::action_button(id, label, pero_theme::ActionKind::Ghost, chrome, cx)
        .accessibility_label(name)
}

pub(crate) fn setting_row(
    label: &str,
    description: &str,
    accessory: Option<AnyElement>,
    control: AnyElement,
    cx: &App,
) -> Div {
    let caption = (!description.is_empty()).then(|| SharedString::from(description.to_owned()));
    pero_theme::settings_row(
        label.to_owned(),
        caption,
        accessory,
        control,
        pero_theme::Chrome::from_app(cx),
    )
}

/// One editor owns focus; step buttons and keys request the same domain action.
#[derive(gpui_kit::IntoElement)]
pub(crate) struct FontSizeField {
    input: Entity<InputState>,
    size: FontSize,
    label: SharedString,
    locale: String,
    disabled: bool,
    on_step: Rc<dyn Fn(i8, &mut Window, &mut App)>,
}
impl FontSizeField {
    pub(crate) fn new(
        input: &Entity<InputState>,
        size: FontSize,
        label: SharedString,
        locale: &str,
        disabled: bool,
        on_step: impl Fn(i8, &mut Window, &mut App) + 'static,
    ) -> Self {
        Self {
            input: input.clone(),
            size,
            label,
            locale: locale.into(),
            disabled,
            on_step: Rc::new(on_step),
        }
    }
}
impl RenderOnce for FontSizeField {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let chrome = pero_theme::Chrome::from_app(cx);
        let p = chrome.palette;
        let focused = self.input.read(cx).focus_handle(cx).is_focused(window);
        let size = self
            .input
            .read(cx)
            .value()
            .parse::<FontSize>()
            .unwrap_or(self.size);
        let height = chrome.geo(pero_theme::ACTION_BUTTON_HEIGHT);
        let decrement = self.on_step.clone();
        let increment = self.on_step.clone();
        let on_key = self.on_step;
        let field = SharedString::from(self.label.to_string());
        div()
            .id(SharedString::from(format!("font-size-field-{field}")))
            .flex()
            .items_center()
            .h(height)
            .rounded(chrome.geo(pero_theme::RADIUS_SELECTION))
            .bg(p.surface_muted)
            .border_1()
            .border_color(if focused && !self.disabled {
                p.focus
            } else {
                p.surface_muted
            })
            .capture_key_down(move |event, window, cx| {
                if self.disabled
                    || event.keystroke.modifiers.control
                    || event.keystroke.modifiers.alt
                    || event.keystroke.modifiers.platform
                {
                    return;
                }
                let direction = match event.keystroke.key.as_str() {
                    "up" => 1,
                    "down" => -1,
                    _ => return,
                };
                on_key(
                    direction
                        * if event.keystroke.modifiers.shift {
                            4
                        } else {
                            1
                        },
                    window,
                    cx,
                );
                cx.stop_propagation();
            })
            .child(
                pero_theme::ghost_icon_button(
                    SharedString::from(format!("decrease-font-{field}")),
                    chrome,
                    cx,
                )
                .tab_stop(false)
                .icon(IconName::Minus)
                .disabled(self.disabled || size.adjusted(-1) == size)
                .accessibility_label(pero_contracts::i18n::text(
                    &self.locale,
                    "settings.decrease_font",
                ))
                .on_click(move |_, window, cx| decrement(-1, window, cx)),
            )
            .child(
                pero_theme::WorkbenchStyle::input(Input::new(&self.input), cx)
                    .appearance(false)
                    .w(chrome.geo(pero_theme::ACTION_BUTTON_HEIGHT + pero_theme::SPACE_16))
                    .text_align(TextAlign::Center)
                    .disabled(self.disabled)
                    .aria_label(self.label),
            )
            .child(
                pero_theme::ghost_icon_button(
                    SharedString::from(format!("increase-font-{field}")),
                    chrome,
                    cx,
                )
                .tab_stop(false)
                .icon(IconName::Plus)
                .disabled(self.disabled || size.adjusted(1) == size)
                .accessibility_label(pero_contracts::i18n::text(
                    &self.locale,
                    "settings.increase_font",
                ))
                .on_click(move |_, window, cx| increment(1, window, cx)),
            )
    }
}
