//! GPUI controls for the TypeSpec design contract. Geometry and default colors
//! come from `design_tokens`; accent overrides still flow through the resolved palette.
use crate::design_tokens::{
    ACTION_BUTTON_HEIGHT, ACTION_BUTTON_PADDING, GHOST_ICON_BUTTON, ICON_GAP, LEAD_BOX,
    LIBRARY_HEADER, LIST_DARK, LIST_LIGHT, RADIUS_BADGE, RADIUS_BUTTON, RADIUS_PANEL,
    RADIUS_SELECTION, READER_MAX_WIDTH, ROW_NAV, ROW_SUB, SEARCH_FIELD_HEIGHT, SPACE_12, SPACE_16,
    SPACE_24, SPACE_4, SPACE_8, SUB_INDENT, TYPE_BODY, TYPE_CAPTION, TYPE_HEADING, TYPE_LABEL,
    TYPE_TITLE, WEIGHT_BODY, WEIGHT_HEADING, WEIGHT_LIST_TITLE, WEIGHT_TITLE,
};
use crate::Palette;
use gpui_kit::{
    component::{Sizable, button::*, input::Input},
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
    let text = chrome.palette.text;
    let muted = chrome.palette.text_muted;
    let selected = chrome.palette.accent_soft;
    let hover = text.opacity(0.08);
    div()
        .id(id)
        .h(chrome.geo(if sub { ROW_SUB } else { ROW_NAV }))
        .w_full()
        .flex_shrink_0()
        .pl(chrome.geo(if sub { SPACE_8 + SUB_INDENT } else { SPACE_8 }))
        .pr(chrome.geo(SPACE_8))
        .rounded(chrome.geo(RADIUS_SELECTION))
        .cursor_pointer()
        .flex()
        .items_center()
        .gap(chrome.geo(ICON_GAP))
        .text_size(chrome.text(if sub { TYPE_CAPTION } else { TYPE_BODY }))
        .font_weight(weight(WEIGHT_BODY))
        .when(active, |row| row.bg(selected).text_color(text))
        .when(!active, |row| {
            row.text_color(text).hover(move |row| row.bg(hover))
        })
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
    let hover = text.opacity(0.08);
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

pub fn settings_group(
    label: Option<SharedString>,
    rows: impl IntoIterator<Item = AnyElement>,
    chrome: Chrome,
) -> Div {
    let border = chrome.palette.border;
    div()
        .flex()
        .flex_col()
        .gap(chrome.geo(SPACE_8))
        .children(label.filter(|text| !text.is_empty()).map(|label| {
            div()
                .text_size(chrome.text(TYPE_LABEL))
                .font_weight(weight(WEIGHT_LIST_TITLE))
                .text_color(chrome.palette.text_muted)
                .child(label)
        }))
        .child(hairline_panel(
            rows.into_iter().enumerate().map(|(index, row)| {
                div()
                    .w_full()
                    .when(index > 0, |row| row.border_t_1().border_color(border))
                    .child(row)
                    .into_any_element()
            }),
            chrome,
        ))
}

pub fn settings_row(
    label: impl Into<SharedString>,
    caption: Option<SharedString>,
    actions: AnyElement,
    chrome: Chrome,
) -> Div {
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
                        .text_size(chrome.text(TYPE_BODY))
                        .font_weight(weight(WEIGHT_BODY))
                        .text_color(chrome.palette.text)
                        .child(label.into()),
                )
                .children(caption.filter(|text| !text.is_empty()).map(|caption| {
                    div()
                        .text_size(chrome.text(TYPE_CAPTION))
                        .text_color(chrome.palette.text_muted)
                        .whitespace_normal()
                        .child(caption)
                })),
        )
        .child(div().flex_shrink_0().child(actions))
}

/// One reading-surface panel. The caller already drew hairlines between rows.
pub fn settings_panel(child: AnyElement, chrome: Chrome) -> Div {
    hairline_panel(std::iter::once(child), chrome)
}

fn hairline_panel(rows: impl IntoIterator<Item = AnyElement>, chrome: Chrome) -> Div {
    div()
        .rounded(chrome.geo(RADIUS_PANEL))
        .overflow_hidden()
        .bg(chrome.palette.surface)
        .border_1()
        .border_color(chrome.palette.border)
        .children(rows)
}

pub fn action_button(
    id: impl Into<ElementId>,
    label: impl Into<SharedString>,
    kind: ActionKind,
    chrome: Chrome,
) -> Button {
    let button = match kind {
        ActionKind::Primary => Button::new(id).primary(),
        ActionKind::Ghost => Button::new(id).ghost(),
    };
    button
        .small()
        .h(chrome.geo(ACTION_BUTTON_HEIGHT))
        .px(chrome.geo(ACTION_BUTTON_PADDING))
        .rounded(chrome.geo(RADIUS_BUTTON))
        .label(label)
}

pub fn ghost_icon_button(id: impl Into<ElementId>, chrome: Chrome) -> Button {
    Button::new(id)
        .ghost()
        .small()
        .w(chrome.geo(GHOST_ICON_BUTTON))
        .h(chrome.geo(GHOST_ICON_BUTTON))
}

pub fn search_field(input: Input, chrome: Chrome) -> Input {
    Styled::h(input.small(), chrome.geo(SEARCH_FIELD_HEIGHT))
        .text_size(chrome.text(TYPE_BODY))
        .line_height(relative(1.3))
}
