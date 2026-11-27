//! Destinations shared by the right resource column and its launcher.
use crate::assets::UiIcon;
use gpui_kit::{
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
    Files,
    Artifacts,
    Changes,
    Desktop,
}

impl ResourcePrimary {
    pub const fn label(self) -> &'static str {
        match self {
            Self::Files => "files.title",
            Self::Artifacts => "artifacts.title",
            Self::Changes => "changes.title",
            Self::Desktop => "linux_desktop.tab",
        }
    }

    const fn icon(self) -> &'static str {
        match self {
            Self::Files => "folder",
            Self::Artifacts => "box",
            Self::Changes => "git-branch",
            Self::Desktop => "monitor",
        }
    }
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
