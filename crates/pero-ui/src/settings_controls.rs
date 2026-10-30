//! Shared presentation and keyboard behavior for Settings fields.
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
use pero_theme::{TextRole, UiAppearance};
use std::rc::Rc;

pub(crate) fn selection_button(
    id: &'static str,
    label: &'static str,
    name: &'static str,
    cx: &App,
) -> Button {
    let appearance = UiAppearance::global(cx);
    Button::new(id)
        .outline()
        .small()
        .min_w(px(92.))
        .h(px(appearance.typography.control_height()))
        .bg(appearance.palette.surface_muted)
        .border_color(appearance.palette.border)
        .label(label)
        .accessibility_label(name)
}

pub(crate) fn setting_row(
    label: &str,
    description: &str,
    accessory: Option<AnyElement>,
    control: AnyElement,
    divider: bool,
    cx: &App,
) -> Div {
    let appearance = UiAppearance::global(cx);
    div()
        .min_w_0()
        .py(px(6.))
        .flex()
        .items_center()
        .gap(px(16.))
        .when(divider, |el| {
            el.border_b(px(0.5)).border_color(appearance.palette.border)
        })
        .child(
            div()
                .flex_1()
                .min_w_0()
                .flex()
                .flex_col()
                .gap(px(4.))
                .child(
                    div()
                        .flex()
                        .flex_wrap()
                        .items_center()
                        .gap(px(8.))
                        .child(label.to_owned())
                        .children(accessory),
                )
                .when(!description.is_empty(), |el| {
                    el.child(
                        div()
                            .text_size(appearance.text(TextRole::Caption))
                            .text_color(appearance.palette.text_muted)
                            .whitespace_normal()
                            .child(description.to_owned()),
                    )
                }),
        )
        .child(div().flex_shrink_0().child(control))
}

/// One editor owns focus; step buttons and keys request the same domain action.
#[derive(IntoElement)]
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
        let appearance = UiAppearance::global(cx).clone();
        let p = appearance.palette;
        let focused = self.input.read(cx).focus_handle(cx).is_focused(window);
        let size = self
            .input
            .read(cx)
            .value()
            .parse::<FontSize>()
            .unwrap_or(self.size);
        let height = px(appearance.typography.control_height());
        let decrement = self.on_step.clone();
        let increment = self.on_step.clone();
        let on_key = self.on_step;
        div()
            .id("font-size-field")
            .flex()
            .items_center()
            .w(px(124.))
            .h(height)
            .rounded(px(3.))
            .bg(p.surface_muted)
            .border_1()
            .border_color(p.border)
            .when(focused && !self.disabled, |el| {
                el.focus_ring_style(window, cx)
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
                Button::new("decrease-font")
                    .ghost()
                    .small()
                    .w(px(26.))
                    .h_full()
                    .tab_stop(false)
                    .border_r(px(0.5))
                    .border_color(p.border)
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
                    .w(px(70.))
                    .text_align(TextAlign::Center)
                    .disabled(self.disabled)
                    .aria_label(self.label),
            )
            .child(
                Button::new("increase-font")
                    .ghost()
                    .small()
                    .w(px(26.))
                    .h_full()
                    .tab_stop(false)
                    .border_l(px(0.5))
                    .border_color(p.border)
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
