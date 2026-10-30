//! GPUI controls for the TypeSpec design contract. Geometry and default colors
//! come from `design_tokens`; accent overrides still flow through the resolved palette.
use crate::design_tokens::{
    ACTION_BUTTON_HEIGHT, ACTION_BUTTON_PADDING, GHOST_ICON_BUTTON, ICON_GAP, LEAD_BOX,
    LIBRARY_HEADER, LIST_DARK, LIST_LIGHT, MENU_ROW, RADIUS_BADGE, RADIUS_BUTTON,
    RADIUS_SELECTION, READER_MAX_WIDTH, ROW_NAV, ROW_SUB, SEARCH_FIELD_HEIGHT, SPACE_12, SPACE_16,
    SPACE_24, SPACE_4, SPACE_8, SUB_INDENT, TYPE_BODY, TYPE_CAPTION, TYPE_HEADING, TYPE_LABEL,
    TYPE_TITLE, WEIGHT_BODY, WEIGHT_HEADING, WEIGHT_LIST_TITLE, WEIGHT_TITLE,
};
use crate::Palette;
use gpui_kit::{
    component::{Selectable, Sizable, button::*, input::Input},
    prelude::*,
    *,
};

#[derive(Clone, Copy)]
pub struct Chrome<'a> {
    pub palette: &'a Palette,
    pub dark: bool,
    pub ui: f32,
}

impl<'a> Chrome<'a> {
    pub fn from_app(cx: &'a App) -> Self {
        let appearance = crate::UiAppearance::global(cx);
        Self {
            palette: &appearance.palette,
            dark: appearance.dark,
            ui: appearance.typography.ui,
        }
    }

    /// Contract geometry stays at the spec pixel. Type scales with the UI size.
    pub fn geo(self, base: f32) -> Pixels {
        px(base)
    }

    pub fn text(self, base: f32) -> Pixels {
        px(base * self.ui / TYPE_BODY)
    }

    pub fn list(self) -> Hsla {
        paint(if self.dark { LIST_DARK } else { LIST_LIGHT })
    }
}

fn paint(hex: &str) -> Hsla {
    let value = u32::from_str_radix(hex.trim_start_matches('#'), 16).expect("design hex");
    rgb(value).into()
}

fn weight(name: &str) -> FontWeight {
    if name == WEIGHT_TITLE || name == WEIGHT_HEADING {
        FontWeight::SEMIBOLD
    } else if name == WEIGHT_LIST_TITLE {
        FontWeight::MEDIUM
    } else {
        FontWeight::NORMAL
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum RowLevel {
    Nav,
    Sub,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum ActionKind {
    Primary,
    Ghost,
    Danger,
}

fn wash(chrome: Chrome) -> Hsla {
    chrome.palette.text.opacity(0.08)
}

fn clear(chrome: Chrome) -> Hsla {
    chrome.palette.text.opacity(0.)
}

/// Full-width row. Selection is the row fill, not a pill around the label.
pub fn interaction_row(
    id: impl Into<ElementId>,
    active: bool,
    height: f32,
    chrome: Chrome,
) -> Stateful<Div> {
    let text = chrome.palette.text;
    let selected = chrome.palette.accent_soft;
    let hover = wash(chrome);
    div()
        .id(id)
        .w_full()
        .h(chrome.geo(height))
        .flex_shrink_0()
        .flex()
        .items_center()
        .rounded(chrome.geo(RADIUS_SELECTION))
        .text_size(chrome.text(TYPE_BODY))
        .text_color(text)
        .when(active, |row| row.bg(selected))
        .when(!active, move |row| row.hover(move |row| row.bg(hover)))
}

pub fn sidebar_row(
    id: impl Into<ElementId>,
    label: impl Into<SharedString>,
    caption: Option<SharedString>,
    count: Option<SharedString>,
    active: bool,
    level: RowLevel,
    lead: Option<AnyElement>,
    chrome: Chrome,
    on_click: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
) -> Stateful<Div> {
    let sub = level == RowLevel::Sub;
    let muted = chrome.palette.text_muted;
    interaction_row(
        id,
        active,
        if sub { ROW_SUB } else { ROW_NAV },
        chrome,
    )
    .cursor_pointer()
    .pl(chrome.geo(if sub { SPACE_8 + SUB_INDENT } else { SPACE_8 }))
    .pr(chrome.geo(SPACE_8))
    .gap(chrome.geo(ICON_GAP))
    .text_size(chrome.text(if sub { TYPE_CAPTION } else { TYPE_BODY }))
    .font_weight(weight(WEIGHT_BODY))
    .on_click(on_click)
        .child(
            div()
                .w(chrome.geo(LEAD_BOX))
                .h(chrome.geo(LEAD_BOX))
                .flex_shrink_0()
                .flex()
                .items_center()
                .justify_center()
                .children(lead),
        )
        .child(
            div()
                .flex_1()
                .min_w_0()
                .text_ellipsis()
                .child(label.into()),
        )
        .children(caption.map(|caption| {
            div()
                .flex_shrink_0()
                .text_size(chrome.text(TYPE_CAPTION))
                .text_color(muted)
                .child(caption)
        }))
        .children(count.map(|count| badge(count, chrome)))
}

pub fn library_header(
    id: impl Into<ElementId>,
    title: impl Into<SharedString>,
    subtitle: Option<SharedString>,
    actions: Option<AnyElement>,
    chrome: Chrome,
) -> Stateful<Div> {
    let muted = chrome.palette.text_muted;
    div()
        .id(id)
        .w_full()
        .h(chrome.geo(LIBRARY_HEADER))
        .flex_shrink_0()
        .px(chrome.geo(SPACE_16))
        .flex()
        .items_center()
        .justify_between()
        .gap(chrome.geo(SPACE_12))
        .bg(chrome.palette.bg)
        .text_color(chrome.palette.text)
        .child(
            div()
                .flex_1()
                .min_w_0()
                .flex()
                .flex_col()
                .gap(px(2.))
                .child(
                    div()
                        .text_ellipsis()
                        .text_size(chrome.text(TYPE_TITLE))
                        .font_weight(weight(WEIGHT_TITLE))
                        .child(title.into()),
                )
                .children(subtitle.filter(|text| !text.is_empty()).map(|subtitle| {
                    div()
                        .text_ellipsis()
                        .text_size(chrome.text(TYPE_LABEL))
                        .text_color(muted)
                        .child(subtitle)
                })),
        )
        .children(actions.map(|actions| {
            div()
                .flex_shrink_0()
                .flex()
                .items_center()
                .gap(chrome.geo(ICON_GAP))
                .child(actions)
        }))
}

pub fn list_row(
    id: impl Into<ElementId>,
    title: impl Into<SharedString>,
    caption: Option<SharedString>,
    count: Option<SharedString>,
    active: bool,
    actions: Option<AnyElement>,
    chrome: Chrome,
) -> Stateful<Div> {
    let text = chrome.palette.text;
    let muted = chrome.palette.text_muted;
    let selected = chrome.palette.accent_soft;
    let hover = wash(chrome);
    div()
        .id(id)
        .w_full()
        .min_w_0()
        .rounded(chrome.geo(RADIUS_SELECTION))
        .px(chrome.geo(SPACE_12))
        .py(chrome.geo(SPACE_8))
        .flex()
        .items_center()
        .gap(chrome.geo(SPACE_8))
        .text_color(text)
        .when(active, |row| row.bg(selected))
        .when(!active, move |row| row.hover(move |row| row.bg(hover)))
        .child(
            div()
                .flex_1()
                .min_w_0()
                .flex()
                .flex_col()
                .gap(chrome.geo(SPACE_4))
                .child(
                    div()
                        .text_ellipsis()
                        .text_size(chrome.text(TYPE_BODY))
                        .font_weight(weight(WEIGHT_LIST_TITLE))
                        .text_color(text)
                        .child(title.into()),
                )
                .children(caption.filter(|text| !text.is_empty()).map(|caption| {
                    div()
                        .text_ellipsis()
                        .text_size(chrome.text(TYPE_CAPTION))
                        .text_color(muted)
                        .child(caption)
                })),
        )
        .children(count.map(|count| badge(count, chrome)))
        .children(actions)
}

pub fn reader_frame(
    title: impl Into<SharedString>,
    subtitle: Option<SharedString>,
    body: AnyElement,
    chrome: Chrome,
) -> Div {
    let muted = chrome.palette.text_muted;
    div()
        .flex()
        .flex_col()
        .min_w_0()
        .min_h_0()
        .flex_1()
        .child(
            div()
                .flex_shrink_0()
                .h(chrome.geo(ROW_NAV))
                .px(chrome.geo(SPACE_16))
                .flex()
                .items_center()
                .gap(chrome.geo(SPACE_8))
                .bg(chrome.palette.bg)
                .border_b_1()
                .border_color(chrome.palette.border)
                .child(
                    div()
                        .min_w_0()
                        .text_ellipsis()
                        .text_size(chrome.text(TYPE_HEADING))
                        .font_weight(weight(WEIGHT_HEADING))
                        .text_color(chrome.palette.text)
                        .child(title.into()),
                )
                .children(subtitle.filter(|text| !text.is_empty()).map(|subtitle| {
                    div()
                        .text_size(chrome.text(TYPE_CAPTION))
                        .text_color(muted)
                        .child(subtitle)
                })),
        )
        .child(
            div()
                .flex_1()
                .min_h_0()
                .bg(chrome.palette.surface)
                .text_color(chrome.palette.text)
                .child(
                    div().w_full().flex().justify_center().child(
                        div()
                            .w_full()
                            .max_w(chrome.geo(READER_MAX_WIDTH))
                            .px(chrome.geo(SPACE_24))
                            .py(chrome.geo(SPACE_16))
                            .child(body),
                    ),
                ),
        )
}

pub fn badge(label: impl Into<SharedString>, chrome: Chrome) -> Div {
    div()
        .flex_shrink_0()
        .px(chrome.geo(ICON_GAP))
        .rounded(chrome.geo(RADIUS_BADGE))
        .text_size(chrome.text(TYPE_LABEL))
        .font_weight(weight(WEIGHT_LIST_TITLE))
        .bg(chrome.palette.text.opacity(0.08))
        .text_color(chrome.palette.text_muted)
        .child(label.into())
}

pub fn outline_badge(label: impl Into<SharedString>, chrome: Chrome) -> Div {
    div()
        .flex_shrink_0()
        .px(chrome.geo(ICON_GAP))
        .rounded(chrome.geo(RADIUS_BADGE))
        .text_size(chrome.text(TYPE_LABEL))
        .font_weight(weight(WEIGHT_LIST_TITLE))
        .border_1()
        .border_color(chrome.palette.border)
        .text_color(chrome.palette.text_muted)
        .child(label.into())
}

pub fn empty_state(
    heading: impl Into<SharedString>,
    caption: Option<SharedString>,
    chrome: Chrome,
) -> Div {
    div()
        .flex()
        .flex_col()
        .gap(chrome.geo(SPACE_8))
        .px(chrome.geo(SPACE_24))
        .py(chrome.geo(SPACE_24))
        .text_color(chrome.palette.text)
        .child(
            div()
                .text_size(chrome.text(TYPE_HEADING))
                .font_weight(weight(WEIGHT_HEADING))
                .child(heading.into()),
        )
        .children(caption.filter(|text| !text.is_empty()).map(|caption| {
            div()
                .text_size(chrome.text(TYPE_CAPTION))
                .text_color(chrome.palette.text_muted)
                .whitespace_normal()
                .child(caption)
        }))
}

/// Help under a control. JetBrains inline help: do not repeat the setting name.
fn setting_help(label: &str, text: Option<SharedString>) -> Option<SharedString> {
    text.filter(|text| {
        let text = text.as_ref().trim();
        !text.is_empty() && text != label.trim()
    })
}

fn setting_caption(text: SharedString, chrome: Chrome) -> Div {
    div()
        .text_size(chrome.text(TYPE_CAPTION))
        .text_color(chrome.palette.text_muted)
        .whitespace_normal()
        .child(text)
}

/// `group(title)`. Related rows stack under the title. The page background is
/// the surface; a group does not draw a card or a rule.
pub fn settings_group(
    label: Option<SharedString>,
    rows: impl IntoIterator<Item = AnyElement>,
    chrome: Chrome,
) -> Div {
    div()
        .flex()
        .flex_col()
        .gap(chrome.geo(SPACE_4))
        .children(label.filter(|text| !text.is_empty()).map(|label| {
            let id = SharedString::from(format!("settings-group-{label}"));
            div()
                .id(id)
                .role(Role::Heading)
                .aria_level(2)
                .px(chrome.geo(SPACE_16))
                .pt(chrome.geo(SPACE_8))
                .text_size(chrome.text(TYPE_LABEL))
                .font_weight(weight(WEIGHT_LIST_TITLE))
                .text_color(chrome.palette.text_muted)
                .child(label)
        }))
        .children(rows)
}

/// `row(label) { control }.rowComment(comment)`.
pub fn settings_row(
    label: impl Into<SharedString>,
    caption: Option<SharedString>,
    accessory: Option<AnyElement>,
    actions: AnyElement,
    chrome: Chrome,
) -> Div {
    let label = label.into();
    let caption = setting_help(&label, caption);
    div()
        .min_h(chrome.geo(ROW_NAV))
        .px(chrome.geo(SPACE_16))
        .py(chrome.geo(SPACE_8))
        .flex()
        .items_center()
        .gap(chrome.geo(ICON_GAP))
        .child(
            div()
                .flex_1()
                .min_w_0()
                .flex()
                .flex_col()
                .gap(chrome.geo(SPACE_4))
                .child(
                    div()
                        .flex()
                        .flex_wrap()
                        .items_center()
                        .gap(chrome.geo(SPACE_8))
                        .text_size(chrome.text(TYPE_BODY))
                        .font_weight(weight(WEIGHT_BODY))
                        .text_color(chrome.palette.text)
                        .child(label)
                        .children(accessory),
                )
                .children(caption.map(|caption| setting_caption(caption, chrome))),
        )
        .child(div().flex_shrink_0().child(actions))
}

/// `checkBox(label).comment(help)`.
pub fn settings_check(
    label: impl Into<SharedString>,
    comment: Option<SharedString>,
    control: AnyElement,
    chrome: Chrome,
) -> Div {
    let label = label.into();
    let comment = setting_help(&label, comment);
    div()
        .px(chrome.geo(SPACE_16))
        .py(chrome.geo(SPACE_8))
        .flex()
        .flex_col()
        .gap(chrome.geo(SPACE_4))
        .child(control)
        .children(comment.map(|comment| setting_caption(comment, chrome).pl(chrome.geo(SPACE_24))))
}

/// `textField().label(text, TOP)` for a field that fills the row.
pub fn settings_field(
    label: impl Into<SharedString>,
    comment: Option<SharedString>,
    control: AnyElement,
    chrome: Chrome,
) -> Div {
    let label = label.into();
    let comment = setting_help(&label, comment);
    div()
        .min_w_0()
        .px(chrome.geo(SPACE_16))
        .py(chrome.geo(SPACE_8))
        .flex()
        .flex_col()
        .gap(chrome.geo(SPACE_4))
        .child(
            div()
                .text_size(chrome.text(TYPE_BODY))
                .text_color(chrome.palette.text)
                .child(label),
        )
        .child(control)
        .children(comment.map(|comment| setting_caption(comment, chrome)))
}

/// Label and a trailing value. A value that repeats the label is omitted.
pub fn settings_status(
    label: impl Into<SharedString>,
    value: impl Into<SharedString>,
    chrome: Chrome,
) -> Div {
    let label = label.into();
    let value = setting_help(&label, Some(value.into()));
    div()
        .min_h(chrome.geo(ROW_NAV))
        .px(chrome.geo(SPACE_16))
        .py(chrome.geo(SPACE_8))
        .flex()
        .items_center()
        .justify_between()
        .gap(chrome.geo(SPACE_12))
        .child(
            div()
                .min_w_0()
                .text_size(chrome.text(TYPE_BODY))
                .text_color(chrome.palette.text)
                .child(label),
        )
        .children(value.map(|value| {
            div()
                .flex_shrink_0()
                .text_size(chrome.text(TYPE_CAPTION))
                .text_color(chrome.palette.text_muted)
                .child(value)
        }))
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum SettingMessage {
    Help,
    Status,
    Success,
    Error,
}

/// `comment()` for help that belongs to the group or the row above it.
pub fn settings_message(
    text: impl Into<SharedString>,
    kind: SettingMessage,
    chrome: Chrome,
) -> Div {
    let (color, size) = match kind {
        SettingMessage::Help => (chrome.palette.text_muted, TYPE_CAPTION),
        SettingMessage::Status => (chrome.palette.text, TYPE_BODY),
        SettingMessage::Success => (chrome.palette.success, TYPE_BODY),
        SettingMessage::Error => (chrome.palette.error, TYPE_BODY),
    };
    div()
        .px(chrome.geo(SPACE_16))
        .pb(chrome.geo(SPACE_8))
        .text_size(chrome.text(size))
        .text_color(color)
        .whitespace_normal()
        .child(text.into())
}

/// Button row. Related actions share one row and do not draw a rule.
pub fn settings_actions(actions: impl IntoIterator<Item = AnyElement>, chrome: Chrome) -> Div {
    div()
        .px(chrome.geo(SPACE_16))
        .py(chrome.geo(SPACE_8))
        .flex()
        .flex_wrap()
        .items_center()
        .gap(chrome.geo(SPACE_8))
        .children(actions)
}

/// Flat settings body. Rows supply their own inset.
pub fn settings_panel(child: AnyElement, _chrome: Chrome) -> Div {
    div().flex().flex_col().child(child)
}

fn ghost_colors(chrome: Chrome, cx: &App, active: Hsla) -> ButtonCustomVariant {
    ButtonCustomVariant::new(cx)
        .foreground(chrome.palette.text)
        .hover(wash(chrome))
        .active(active)
}

/// Primary, ghost, and danger share one height, padding, and radius.
/// Focus tints the border; the theme draws no ring outside the control.
pub fn action_button(
    id: impl Into<ElementId>,
    label: impl Into<SharedString>,
    kind: ActionKind,
    chrome: Chrome,
    cx: &App,
) -> Button {
    let button = match kind {
        ActionKind::Primary => Button::new(id).primary().border_color(chrome.palette.action),
        ActionKind::Ghost => Button::new(id)
            .custom(ghost_colors(chrome, cx, wash(chrome)))
            .border_color(clear(chrome)),
        ActionKind::Danger => Button::new(id).danger().border_color(chrome.palette.error),
    };
    button
        .small()
        .h(chrome.geo(ACTION_BUTTON_HEIGHT))
        .px(chrome.geo(ACTION_BUTTON_PADDING))
        .rounded(chrome.geo(RADIUS_BUTTON))
        .border_1()
        .text_size(chrome.text(TYPE_BODY))
        .label(label)
}

pub fn ghost_icon_button(id: impl Into<ElementId>, chrome: Chrome, cx: &App) -> Button {
    Button::new(id)
        .custom(ghost_colors(chrome, cx, wash(chrome)))
        .small()
        .w(chrome.geo(GHOST_ICON_BUTTON))
        .h(chrome.geo(GHOST_ICON_BUTTON))
        .rounded(chrome.geo(RADIUS_BUTTON))
        .border_1()
        .border_color(clear(chrome))
        .p_0()
}

/// Menu row. Open and current items use the same fill as a selected sidebar row.
pub fn menu_button(
    id: impl Into<ElementId>,
    label: impl Into<SharedString>,
    selected: bool,
    chrome: Chrome,
    cx: &App,
) -> Button {
    Button::new(id)
        .custom(ghost_colors(chrome, cx, chrome.palette.accent_soft))
        .selected(selected)
        .small()
        .w_full()
        .h(chrome.geo(MENU_ROW))
        .px(chrome.geo(SPACE_8))
        .rounded(chrome.geo(RADIUS_SELECTION))
        .justify_start()
        .border_1()
        .border_color(clear(chrome))
        .text_size(chrome.text(TYPE_BODY))
        .label(label)
}

pub fn hairline(chrome: Chrome) -> Div {
    div()
        .w_full()
        .h(px(1.))
        .flex_shrink_0()
        .bg(chrome.palette.border)
}

pub fn search_field(input: Input, chrome: Chrome) -> Input {
    let fill = chrome.palette.surface_muted;
    Styled::h(
        input
            .small()
            .appearance(true)
            .bordered(true)
            .bg(fill)
            .border_color(fill)
            .rounded(chrome.geo(RADIUS_SELECTION)),
        chrome.geo(SEARCH_FIELD_HEIGHT),
    )
    .text_size(chrome.text(TYPE_BODY))
    .line_height(relative(1.3))
}
