//! Destinations shared by the right resource column and its launcher.
use crate::assets::UiIcon;
use gpui_kit::{
    base::Selectable,
    component::{
        Icon, Sizable,
        button::*,
        menu::{DropdownMenu, PopupMenuItem},
    },
    prelude::*,
    *,
};

/// Side resources column measured for the workbench titleband.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ResourceColumn {
    pub width: f32,
    pub primary: ResourcePrimary,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ResourcePrimary {
    Launcher,
    Files,
    Artifacts,
    Changes,
    Desktop,
}

impl ResourcePrimary {
    pub const fn label(self) -> &'static str {
        match self {
            Self::Launcher => "resources.new_tab",
            Self::Files => "files.title",
            Self::Artifacts => "artifacts.title",
            Self::Changes => "changes.title",
            Self::Desktop => "linux_desktop.tab",
        }
    }

    const fn icon(self) -> &'static str {
        match self {
            Self::Launcher => "plus",
            Self::Files => "folder",
            Self::Artifacts => "box",
            Self::Changes => "git-branch",
            Self::Desktop => "devices",
        }
    }
}

#[derive(Default)]
pub struct PanelTabs(Vec<ResourcePrimary>);

impl PanelTabs {
    pub fn opened(&mut self, pane: ResourcePrimary) {
        if pane != ResourcePrimary::Launcher && !self.0.contains(&pane) {
            self.0.push(pane);
        }
    }

    pub fn closed(&mut self, pane: ResourcePrimary, active: ResourcePrimary) -> ResourcePrimary {
        let index = self.0.iter().position(|entry| *entry == pane);
        if let Some(index) = index {
            self.0.remove(index);
        }
        if active == pane {
            index
                .and_then(|index| self.0.get(index))
                .or_else(|| self.0.last())
                .copied()
                .unwrap_or(ResourcePrimary::Launcher)
        } else {
            active
        }
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

#[derive(Clone, Copy)]
pub enum PanelTabAction {
    Select(ResourcePrimary),
    Close(ResourcePrimary),
}

pub fn panel_tab_strip(
    tabs: &PanelTabs,
    active: ResourcePrimary,
    locale: &str,
    change: impl Fn(PanelTabAction, &mut App) + 'static,
    cx: &App,
) -> AnyElement {
    let palette = &pero_theme::UiAppearance::global(cx).palette;
    let change = std::rc::Rc::new(change);
    let text = |key| pero_contracts::i18n::text(locale, key);
    let add = change.clone();
    div()
        .id("panel-tab-strip")
        .size_full()
        .min_w_0()
        .flex()
        .items_center()
        .gap(px(pero_theme::SPACE_4))
        .px(px(pero_theme::SPACE_8))
        .border_b_1()
        .border_color(palette.border)
        .child(
            div()
                .id("right-panel-tabs")
                .role(Role::TabList)
                .aria_label(text("resources.open_panel"))
                .min_w_0()
                .flex()
                .items_center()
                .gap(px(pero_theme::SPACE_4))
                .overflow_x_scroll()
                .children(
                    tabs.0
                        .iter()
                        .copied()
                        .chain(
                            (active == ResourcePrimary::Launcher)
                                .then_some(ResourcePrimary::Launcher),
                        )
                        .map(|pane| {
                            let id = pane.label();
                            let selected = active == pane;
                            let select = change.clone();
                            let close = change.clone();
                            let close_label =
                                format!("{} {}", text("resources.close_tab"), text(id));
                            div()
                                .flex()
                                .flex_shrink_0()
                                .items_center()
                                .rounded(px(pero_theme::RADIUS_SELECTION))
                                .when(selected, |el| el.bg(palette.surface_pressed))
                                .hover(|el| el.bg(palette.surface_hover))
                                .child(
                                    Button::new(SharedString::from(format!("right-tab-{id}")))
                                        .role(Role::Tab)
                                        .ghost()
                                        .small()
                                        .icon(
                                            Icon::default().path(UiIcon::named(pane.icon()).path()),
                                        )
                                        .label(text(id))
                                        .selected(selected)
                                        .toggled(selected)
                                        .on_click(move |_, _, cx| {
                                            select(PanelTabAction::Select(pane), cx)
                                        }),
                                )
                                .child(
                                    Button::new(SharedString::from(format!(
                                        "close-right-tab-{id}"
                                    )))
                                    .ghost()
                                    .small()
                                    .icon(Icon::default().path(UiIcon::named("x").path()))
                                    .tooltip(close_label.clone())
                                    .accessibility_label(close_label)
                                    .on_click(
                                        move |_, _, cx| close(PanelTabAction::Close(pane), cx),
                                    ),
                                )
                        }),
                ),
        )
        .when(active != ResourcePrimary::Launcher, |el| {
            el.child(
                Button::new("right-panel-new-tab")
                    .ghost()
                    .small()
                    .icon(Icon::default().path(UiIcon::named("plus").path()))
                    .tooltip(text("resources.new_tab"))
                    .accessibility_label(text("resources.new_tab"))
                    .on_click(move |_, _, cx| {
                        add(PanelTabAction::Select(ResourcePrimary::Launcher), cx)
                    }),
            )
        })
        .into_any_element()
}

pub fn panel_launcher(
    available: &[ResourcePrimary],
    locale: &str,
    choose: impl Fn(ResourcePrimary, &mut App) + 'static,
    cx: &App,
) -> AnyElement {
    let appearance = pero_theme::UiAppearance::global(cx);
    let palette = &appearance.palette;
    let choose = std::rc::Rc::new(choose);
    let menu_choice = choose.clone();
    let text = |key| pero_contracts::i18n::text(locale, key);
    div()
        .id("right-panel-launcher")
        .flex_1()
        .min_h_0()
        .overflow_y_scroll()
        .flex()
        .flex_col()
        .items_center()
        .justify_center()
        .px(px(pero_theme::SPACE_24))
        .py(px(pero_theme::SPACE_16))
        .child(
            div()
                .w_full()
                .max_w(px(432.))
                .flex()
                .flex_col()
                .gap(px(pero_theme::SPACE_12))
                .child(
                    div()
                        .flex()
                        .items_center()
                        .justify_between()
                        .child(
                            div()
                                .font_weight(FontWeight::SEMIBOLD)
                                .text_color(palette.text_muted)
                                .child(text("resources.open_views")),
                        )
                        .child(resource_menu(
                            available.iter().copied(),
                            ResourcePrimary::Launcher,
                            locale,
                            false,
                            move |pane, cx| menu_choice(pane, cx),
                        )),
                )
                .children(available.chunks(2).map(|row| {
                    div()
                        .flex()
                        .items_center()
                        .gap(px(pero_theme::SPACE_8))
                        .children(row.iter().copied().map(|pane| {
                            let choose = choose.clone();
                            let id = pane.label();
                            div().flex_1().min_w_0().child(
                                Button::new(SharedString::from(format!("launch-right-pane-{id}")))
                                    .ghost()
                                    .w_full()
                                    .h(px(70.))
                                    .px(px(pero_theme::SPACE_12))
                                    .rounded(px(pero_theme::RADIUS_PANEL))
                                    .bg(palette.surface_muted)
                                    .accessibility_label(text(id))
                                    .child(
                                        div()
                                            .w_full()
                                            .flex()
                                            .flex_col()
                                            .items_start()
                                            .gap(px(pero_theme::SPACE_8))
                                            .child(
                                                svg()
                                                    .path(UiIcon::named(pane.icon()).path())
                                                    .size(px(18.))
                                                    .text_color(palette.text),
                                            )
                                            .child(
                                                div()
                                                    .max_w_full()
                                                    .truncate()
                                                    .text_sm()
                                                    .child(text(id)),
                                            ),
                                    )
                                    .on_click(move |_, _, cx| choose(pane, cx)),
                            )
                        }))
                        .when(row.len() == 1, |el| el.child(div().flex_1()))
                })),
        )
        .into_any_element()
}

pub fn resource_menu(
    available: impl IntoIterator<Item = ResourcePrimary>,
    selected: ResourcePrimary,
    locale: &str,
    show_current: bool,
    choose: impl Fn(ResourcePrimary, &mut App) + 'static,
) -> AnyElement {
    let text = |key| pero_contracts::i18n::text(locale, key);
    let entries = available
        .into_iter()
        .map(|view| (view, text(view.label())))
        .collect::<Vec<_>>();
    let choose = std::rc::Rc::new(choose);
    let button = Button::new("resource-panel-menu").ghost().small();
    let button = if show_current {
        button.label(text(selected.label())).dropdown_caret(true)
    } else {
        let label = text("resources.choose_panel");
        button
            .icon(Icon::default().path(UiIcon::Dots.path()))
            .tooltip(label)
            .accessibility_label(label)
            .dropdown_caret(false)
    };
    button
        .dropdown_menu_with_anchor(Anchor::BottomRight, move |mut menu, _, _| {
            for (view, label) in entries.iter().copied() {
                let choose = choose.clone();
                menu = menu.item(
                    PopupMenuItem::new(label)
                        .icon(Icon::default().path(UiIcon::named(view.icon()).path()))
                        .checked(selected == view)
                        .on_click(move |_, _, cx| choose(view, cx)),
                );
            }
            menu
        })
        .into_any_element()
}
