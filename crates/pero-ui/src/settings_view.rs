//! Reusable Settings content. The shell owns windows, commands and persistence.
use crate::{settings_menu::PreferenceSaveState, workspace::WorkbenchPage};
use gpui_kit::{
    component::{
        button::*,
        checkbox::Checkbox,
        input::{Input, InputEvent, InputState},
        menu::{DropdownMenu, PopupMenuItem},
        tree::{TreeItem, TreeState},
        *,
    },
    prelude::*,
    *,
};
use pero_contracts::{
    appearance::{AccentColor, FontScope, FontSize},
    workbench::{Appearance, WorkbenchPreferences},
};
use pero_theme::{TextRole, UiAppearance};

#[derive(Clone, Copy, Default, PartialEq, Eq)]
pub(crate) enum SettingsSection {
    General,
    #[default]
    Theme,
    InterfaceFont,
    ChatFont,
    CodeFont,
}
impl SettingsSection {
    const ALL: [Self; 5] = [
        Self::General,
        Self::Theme,
        Self::InterfaceFont,
        Self::ChatFont,
        Self::CodeFont,
    ];
    fn key(self) -> &'static str {
        match self {
            Self::General => "settings.general",
            Self::Theme => "settings.theme",
            Self::InterfaceFont => "settings.interface_font",
            Self::ChatFont => "settings.chat_font",
            Self::CodeFont => "settings.code_font",
        }
    }
    fn scope(self) -> Option<FontScope> {
        match self {
            Self::InterfaceFont => Some(FontScope::Interface),
            Self::ChatFont => Some(FontScope::Chat),
            Self::CodeFont => Some(FontScope::Code),
            _ => None,
        }
    }
}

#[derive(Clone)]
pub(crate) enum SettingsAction {
    Save(WorkbenchPreferences),
    Locale(&'static str),
    Navigate(WorkbenchPage),
    Close,
}

pub(crate) struct SettingsPanel {
    pub preferences: WorkbenchPreferences,
    pub locale: String,
    pub preferences_status: PreferenceSaveState,
    pub error: Option<String>,
    section: SettingsSection,
    navigation: Entity<TreeState>,
    navigation_query: Option<(String, String)>,
    search: Entity<InputState>,
    content_scroll: ScrollHandle,
    font_inputs: [Entity<InputState>; 3],
    needs_sync: bool,
    input_locale: String,
    bounds: Bounds<Pixels>,
    _subscriptions: Vec<Subscription>,
}
impl EventEmitter<SettingsAction> for SettingsPanel {}
impl SettingsPanel {
    pub(crate) fn new(
        preferences: WorkbenchPreferences,
        locale: String,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let search = cx.new(|cx| {
            InputState::new(window, cx)
                .placeholder(pero_contracts::i18n::text(&locale, "settings.search"))
        });
        let font_inputs = [FontScope::Interface, FontScope::Chat, FontScope::Code].map(|scope| {
            cx.new(|cx| {
                InputState::new(window, cx)
                    .default_value(u8::from(preferences.typography.effective(scope)).to_string())
                    .validate(|value, _| value.bytes().all(|byte| byte.is_ascii_digit()))
            })
        });
        let navigation = cx.new(|cx| TreeState::new(cx));
        let mut subscriptions = vec![
            cx.subscribe(&search, |_, _, _: &InputEvent, cx| cx.notify()),
            cx.observe(&navigation, |this, tree, cx| {
                let Some(selected) = tree.read(cx).selected_item() else {
                    return;
                };
                let section = SettingsSection::ALL
                    .into_iter()
                    .find(|section| section.key() == selected.id.as_ref())
                    .or_else(|| {
                        (selected.id.as_ref() == "settings.appearance")
                            .then_some(SettingsSection::Theme)
                    });
                if let Some(section) = section {
                    this.section = section;
                    let sections = this.matching_sections(cx);
                    let query = this.search.read(cx).value();
                    let index = if query.is_empty() {
                        if section == SettingsSection::General {
                            0
                        } else {
                            section as usize - 1
                        }
                    } else {
                        sections
                            .iter()
                            .position(|candidate| *candidate == section)
                            .unwrap_or(0)
                    };
                    this.content_scroll.scroll_to_top_of_item(index);
                    cx.notify();
                }
            }),
        ];
        for (index, scope) in [FontScope::Interface, FontScope::Chat, FontScope::Code]
            .into_iter()
            .enumerate()
        {
            subscriptions.push(cx.subscribe(
                &font_inputs[index],
                move |this, input, event: &InputEvent, cx| {
                    cx.notify();
                    if matches!(event, InputEvent::PressEnter { .. } | InputEvent::Blur) {
                        match input
                            .read(cx)
                            .value()
                            .parse::<u8>()
                            .ok()
                            .and_then(|value| FontSize::try_from(value).ok())
                        {
                            Some(size) => {
                                if this.error.as_deref() == Some("settings.font_size_range") {
                                    this.error = None;
                                    cx.notify();
                                }
                                if size == this.preferences.typography.effective(scope) {
                                    return;
                                }
                                let mut next = this.preferences.clone();
                                next.typography.set_size(scope, size);
                                this.save_preferences(next, cx);
                            }
                            None => {
                                this.error = Some("settings.font_size_range".into());
                                cx.notify();
                            }
                        }
                    }
                },
            ));
        }
        Self {
            preferences,
            locale: locale.clone(),
            input_locale: locale,
            bounds: Bounds::default(),
            preferences_status: Default::default(),
            error: None,
            section: Default::default(),
            navigation,
            navigation_query: None,
            search,
            content_scroll: ScrollHandle::new(),
            font_inputs,
            needs_sync: false,
            _subscriptions: subscriptions,
        }
    }
    pub(crate) fn receive(
        &mut self,
        preferences: &WorkbenchPreferences,
        locale: &str,
        status: PreferenceSaveState,
        error: Option<&str>,
        cx: &mut Context<Self>,
    ) {
        self.needs_sync |= self.preferences.typography != preferences.typography;
        self.preferences = preferences.clone();
        self.locale = locale.into();
        self.preferences_status = status;
        self.error = error.map(str::to_owned);
        cx.notify();
    }
    fn t(&self, key: &str) -> &'static str {
        pero_contracts::i18n::text(&self.locale, key)
    }
    fn save_preferences(&mut self, preferences: WorkbenchPreferences, cx: &mut Context<Self>) {
        if preferences == self.preferences {
            return;
        }
        self.error = None;
        self.preferences_status = PreferenceSaveState::Saving;
        cx.emit(SettingsAction::Save(preferences));
        cx.notify();
    }
    #[cfg(target_family = "wasm")]
    pub(crate) fn snapshot(&self, cx: &App) -> serde_json::Value {
        let bounds = |value: Bounds<Pixels>| {
            serde_json::json!({
            "x":f32::from(value.origin.x),"y":f32::from(value.origin.y),
            "width":f32::from(value.size.width),"height":f32::from(value.size.height)})
        };
        serde_json::json!({"query":self.search.read(cx).value().as_ref(),"section":self.section.key(),
            "preferences":self.preferences,"error":self.error,"bounds":bounds(self.bounds),
            "fontInputs":self.font_inputs.iter().map(|input| {
                let input=input.read(cx);let mut result=bounds(input.input_bounds());
                result["value"]=serde_json::json!(input.value().as_ref());result
            }).collect::<Vec<_>>()})
    }
}

fn selection_button(id: &'static str, label: &'static str, name: &'static str, cx: &App) -> Button {
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

fn setting_row(
    label: &str,
    description: &str,
    control: AnyElement,
    divider: bool,
    cx: &App,
) -> Div {
    let appearance = UiAppearance::global(cx);
    div()
        .min_w_0()
        .py(px(12.))
        .flex()
        .items_center()
        .gap(px(20.))
        .when(divider, |el| {
            el.border_b(px(0.5)).border_color(appearance.palette.border)
        })
        .child(
            div()
                .flex_1()
                .min_w_0()
                .flex()
                .flex_col()
                .gap(px(3.))
                .child(label.to_owned())
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

impl SettingsPanel {
    fn font_settings(
        &self,
        section: SettingsSection,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let scope = section.scope().expect("font section");
        let inherited = self.preferences.typography.selected(scope).is_none();
        let saving = self.preferences_status == PreferenceSaveState::Saving;
        let appearance = UiAppearance::global(cx).clone();
        let index = match scope {
            FontScope::Interface => 0,
            FontScope::Chat => 1,
            FontScope::Code => 2,
        };
        let control = div()
            .flex()
            .items_center()
            .gap(px(12.))
            .when(scope != FontScope::Interface, |el| {
                el.child(
                    Checkbox::new("font-inherit")
                        .small()
                        .label(self.t("settings.inherit_ui"))
                        .checked(inherited)
                        .disabled(saving)
                        .on_click(cx.listener(move |this, checked: &bool, _, cx| {
                            let mut next = this.preferences.clone();
                            next.typography.inherit(scope, *checked);
                            this.save_preferences(next, cx);
                        })),
                )
            })
            .child(
                div()
                    .id("font-size-field")
                    .flex()
                    .items_center()
                    .w(px(124.))
                    .rounded(px(3.))
                    .bg(UiAppearance::global(cx).palette.surface_muted)
                    .border_1()
                    .border_color(
                        if self.font_inputs[index]
                            .read(cx)
                            .focus_handle(cx)
                            .is_focused(window)
                        {
                            appearance.palette.focus
                        } else {
                            appearance.palette.border
                        },
                    )
                    .h(px(appearance.typography.control_height()))
                    .child(
                        Button::new("decrease-font")
                            .ghost()
                            .small()
                            .w(px(26.))
                            .h_full()
                            .icon(IconName::Minus)
                            .disabled(saving)
                            .accessibility_label(self.t("settings.decrease_font"))
                            .on_click(cx.listener(move |this, _, _, cx| {
                                let mut next = this.preferences.clone();
                                next.typography.adjust(scope, -1);
                                this.save_preferences(next, cx);
                            })),
                    )
                    .child(
                        Input::new(&self.font_inputs[index])
                            .appearance(false)
                            .small()
                            .w(px(70.))
                            .text_align(TextAlign::Center)
                            .disabled(saving)
                            .aria_label(format!(
                                "{} {}",
                                self.t(section.key()),
                                self.t("settings.font_size")
                            )),
                    )
                    .child(
                        Button::new("increase-font")
                            .ghost()
                            .small()
                            .w(px(26.))
                            .h_full()
                            .icon(IconName::Plus)
                            .disabled(saving)
                            .accessibility_label(self.t("settings.increase_font"))
                            .on_click(cx.listener(move |this, _, _, cx| {
                                let mut next = this.preferences.clone();
                                next.typography.adjust(scope, 1);
                                this.save_preferences(next, cx);
                            })),
                    ),
            );
        setting_row(
            self.t("settings.font_size"),
            self.t(match scope {
                FontScope::Interface => "settings.interface_font_hint",
                FontScope::Chat => "settings.chat_font_hint",
                FontScope::Code => "settings.code_font_hint",
            }),
            control.into_any_element(),
            false,
            cx,
        )
        .into_any_element()
    }

    fn theme_settings(&self, cx: &mut Context<Self>) -> AnyElement {
        let target = cx.entity().downgrade();
        let selected = self.preferences.appearance;
        let choices = [Appearance::System, Appearance::Light, Appearance::Dark]
            .map(|mode| (mode, self.t(mode.label_key()).to_owned()));
        let mode = selection_button(
            "appearance-mode",
            self.t(selected.label_key()),
            self.t("settings.appearance"),
            cx,
        )
        .dropdown_menu(move |menu, _, _| {
            choices.iter().fold(menu, |menu, (choice, label)| {
                let target = target.clone();
                let choice = *choice;
                menu.item(
                    PopupMenuItem::new(label.clone())
                        .checked(selected == choice)
                        .on_click(move |_, _, cx| {
                            let _ = target.update(cx, |this, cx| {
                                let mut next = this.preferences.clone();
                                next.appearance = choice;
                                this.save_preferences(next, cx);
                            });
                        }),
                )
            })
        });
        let target = cx.entity().downgrade();
        let selected = self.preferences.accent;
        let choices = [AccentColor::Teal, AccentColor::Blue, AccentColor::Neutral]
            .map(|accent| (accent, self.t(accent.label_key()).to_owned()));
        let accent = selection_button(
            "appearance-accent",
            self.t(selected.label_key()),
            self.t("settings.accent"),
            cx,
        )
        .dropdown_menu(move |menu, _, _| {
            choices.iter().fold(menu, |menu, (choice, label)| {
                let target = target.clone();
                let choice = *choice;
                menu.item(
                    PopupMenuItem::new(label.clone())
                        .checked(selected == choice)
                        .on_click(move |_, _, cx| {
                            let _ = target.update(cx, |this, cx| {
                                let mut next = this.preferences.clone();
                                next.accent = choice;
                                this.save_preferences(next, cx);
                            });
                        }),
                )
            })
        });
        div()
            .flex()
            .flex_col()
            .child(setting_row(
                self.t("settings.appearance"),
                "",
                mode.into_any_element(),
                true,
                cx,
            ))
            .child(setting_row(
                self.t("settings.accent"),
                "",
                accent.into_any_element(),
                false,
                cx,
            ))
            .into_any_element()
    }

    fn language_settings(&self, cx: &mut Context<Self>) -> AnyElement {
        let selected = self.locale.clone();
        let target = cx.entity().downgrade();
        let control = selection_button(
            "settings-language",
            if selected == "en" {
                "English"
            } else {
                "简体中文"
            },
            self.t("menu.language"),
            cx,
        )
        .dropdown_menu(move |menu, _, _| {
            [("zh-CN", "简体中文"), ("en", "English")].into_iter().fold(
                menu,
                |menu, (value, label)| {
                    let target = target.clone();
                    menu.item(
                        PopupMenuItem::new(label)
                            .checked(selected == value)
                            .on_click(move |_, _, cx| {
                                let _ = target
                                    .update(cx, |_, cx| cx.emit(SettingsAction::Locale(value)));
                            }),
                    )
                },
            )
        });
        setting_row(
            self.t("menu.language"),
            "",
            control.into_any_element(),
            false,
            cx,
        )
        .into_any_element()
    }

    fn matching_sections(&self, cx: &App) -> Vec<SettingsSection> {
        let query = self.search.read(cx).value().to_lowercase();
        SettingsSection::ALL
            .into_iter()
            .filter(|section| {
                query.is_empty()
                    || format!(
                        "{} {}",
                        self.t(section.key()),
                        match section {
                            SettingsSection::Theme => format!(
                                "{} {}",
                                self.t("settings.appearance"),
                                self.t("settings.accent")
                            ),
                            SettingsSection::General => self.t("menu.language").to_owned(),
                            _ => format!(
                                "{} {}",
                                self.t("settings.font_size"),
                                self.t("settings.font_family")
                            ),
                        }
                    )
                    .to_lowercase()
                    .contains(&query)
            })
            .collect()
    }

    fn content(&self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let appearance = UiAppearance::global(cx).clone();
        let p = appearance.palette.clone();
        let query = self.search.read(cx).value().to_lowercase();
        let sections = self.matching_sections(cx);
        let visible = sections
            .iter()
            .copied()
            .filter(|section| {
                !query.is_empty()
                    || (*section == SettingsSection::General)
                        == (self.section == SettingsSection::General)
            })
            .collect::<Vec<_>>();
        let mut content = div()
            .id("settings-content")
            .flex_1()
            .min_w_0()
            .min_h_0()
            .overflow_y_scroll()
            .track_scroll(&self.content_scroll)
            .px(px(24.))
            .pt(px(12.))
            .pb(px(24.));
        for section in visible.iter().copied() {
            let body = match section {
                SettingsSection::Theme => self.theme_settings(cx),
                SettingsSection::General => self.language_settings(cx),
                _ => self.font_settings(section, window, cx),
            };
            content = content.child(
                div()
                    .id(("settings-page", section as usize))
                    .mb(px(20.))
                    .child(
                        div()
                            .id("section-heading")
                            .role(Role::Heading)
                            .aria_level(2)
                            .aria_label(self.t(section.key()))
                            .pb(px(6.))
                            .border_b(px(0.5))
                            .border_color(p.border)
                            .text_size(appearance.text(TextRole::Caption))
                            .text_color(p.text_muted)
                            .child(self.t(section.key())),
                    )
                    .child(body),
            );
        }
        if visible.is_empty()
            && !crate::settings_menu::SettingsDestination::ALL
                .into_iter()
                .any(|destination| {
                    self.t(destination.label_key)
                        .to_lowercase()
                        .contains(&query)
                })
        {
            content = content.child(
                div()
                    .id("settings-empty")
                    .text_color(p.text_muted)
                    .child(self.t("settings.no_results")),
            );
        }
        let navigation = self.navigation.clone();
        let owner = cx.entity().downgrade();
        let row_height = 28. * appearance.typography.ui / 14.;
        div()
            .flex_1()
            .min_w_0()
            .min_h_0()
            .flex()
            .child(
                div()
                    .w(px(220.))
                    .flex_shrink_0()
                    .flex()
                    .flex_col()
                    .bg(p.bg)
                    .border_r(px(0.5))
                    .border_color(p.border)
                    .child(
                        div().p(px(12.)).child(
                            Input::new(&self.search)
                                .small()
                                .aria_label(self.t("settings.search")),
                        ),
                    )
                    .child(
                        div()
                            .id("settings-navigation")
                            .flex_1()
                            .min_h_0()
                            .px(px(8.))
                            .capture_action(cx.listener(
                                |this, _: &gpui_kit::base::actions::Confirm, _, cx| {
                                    let destination = this
                                        .navigation
                                        .read(cx)
                                        .selected_item()
                                        .and_then(|selected| {
                                            crate::settings_menu::SettingsDestination::ALL
                                                .into_iter()
                                                .find(|destination| {
                                                    destination.label_key == selected.id.as_ref()
                                                })
                                        });
                                    if let Some(destination) = destination {
                                        cx.emit(SettingsAction::Navigate(destination.page));
                                    } else {
                                        cx.propagate();
                                    }
                                },
                            ))
                            .on_mouse_down(MouseButton::Left, move |_, window, cx| {
                                navigation.update(cx, |tree, cx| tree.focus(window, cx));
                            })
                            .child(
                                gpui_kit::base::Tree::new(&self.navigation)
                                    .size_full()
                                    .list_style(StyleRefinement::default().size_full())
                                    .item(move |_, entry, state, _, _| {
                                        let destination =
                                            crate::settings_menu::SettingsDestination::ALL
                                                .into_iter()
                                                .find(|destination| {
                                                    destination.label_key
                                                        == entry.item().id.as_ref()
                                                });
                                        let owner = owner.clone();
                                        div()
                                            .id("settings-nav-row")
                                            .when_some(destination, |el, destination| {
                                                el.on_click(move |_, _, cx| {
                                                    let _ = owner.update(cx, |_, cx| {
                                                        cx.emit(SettingsAction::Navigate(
                                                            destination.page,
                                                        ))
                                                    });
                                                })
                                            })
                                            .h(px(row_height))
                                            .px(px(6.))
                                            .flex()
                                            .items_center()
                                            .gap(px(6.))
                                            .rounded(px(3.))
                                            .text_color(if state.is_selected() {
                                                p.text
                                            } else {
                                                p.text_muted
                                            })
                                            .when(state.is_selected(), |el| el.bg(p.surface_muted))
                                            .hover(|el| el.bg(p.surface_muted))
                                            .child(
                                                div()
                                                    .w(px(if entry.depth() > 0 {
                                                        22.
                                                    } else {
                                                        14.
                                                    }))
                                                    .h_full()
                                                    .flex_shrink_0()
                                                    .flex()
                                                    .items_center()
                                                    .justify_center()
                                                    .when(entry.depth() > 0, |el| {
                                                        el.child(
                                                            div().w(px(0.5)).h_full().bg(p.border),
                                                        )
                                                    })
                                                    .when(entry.is_folder(), |el| {
                                                        el.child(
                                                            Icon::new(if entry.is_expanded() {
                                                                IconName::ChevronDown
                                                            } else {
                                                                IconName::ChevronRight
                                                            })
                                                            .size(px(12.)),
                                                        )
                                                    }),
                                            )
                                            .child(
                                                div()
                                                    .flex_1()
                                                    .min_w_0()
                                                    .text_ellipsis()
                                                    .child(entry.item().label.clone()),
                                            )
                                            .into_any_element()
                                    }),
                            ),
                    ),
            )
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .min_h_0()
                    .flex()
                    .flex_col()
                    .child(
                        div()
                            .min_h(px(40.))
                            .flex_shrink_0()
                            .px(px(24.))
                            .flex()
                            .items_center()
                            .gap(px(12.))
                            .child(div().font_weight(FontWeight::MEDIUM).child(self.t(
                                if self.section == SettingsSection::General {
                                    "settings.general"
                                } else {
                                    "settings.appearance"
                                },
                            )))
                            .child(div().flex_1())
                            .when(self.preferences_status != PreferenceSaveState::Idle, |el| {
                                el.child(
                                    div()
                                        .text_size(appearance.text(TextRole::Caption))
                                        .text_color(p.text_muted)
                                        .child(self.t(
                                            if self.preferences_status
                                                == PreferenceSaveState::Saving
                                            {
                                                "settings.saving"
                                            } else {
                                                "settings.saved"
                                            },
                                        )),
                                )
                            })
                            .when(cfg!(target_family = "wasm"), |el| {
                                el.child(
                                    Button::new("settings-close")
                                        .ghost()
                                        .small()
                                        .icon(Icon::default().path("icons/x.svg"))
                                        .accessibility_label(self.t("settings.close"))
                                        .on_click(cx.listener(|_, _, _, cx| {
                                            cx.emit(SettingsAction::Close)
                                        })),
                                )
                            }),
                    )
                    .when_some(self.error.clone(), |el, error| {
                        el.child(
                            div()
                                .id("settings-error")
                                .role(Role::Alert)
                                .px(px(24.))
                                .py(px(8.))
                                .bg(p.error_bg)
                                .text_color(p.error)
                                .child(
                                    if error.starts_with("settings.") || error.starts_with("error.")
                                    {
                                        self.t(&error).to_owned()
                                    } else {
                                        error
                                    },
                                ),
                        )
                    })
                    .child(content),
            )
    }
}

impl Render for SettingsPanel {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if self.input_locale != self.locale {
            let placeholder = self.t("settings.search");
            self.search.update(cx, |input, cx| {
                input.set_placeholder(placeholder, window, cx)
            });
            #[cfg(not(target_family = "wasm"))]
            window.set_window_title(self.t("settings.title"));
            self.input_locale = self.locale.clone();
        }
        let query = self.search.read(cx).value().to_lowercase();
        let navigation_query = (query.clone(), self.locale.clone());
        if self.navigation_query.as_ref() != Some(&navigation_query) {
            self.navigation_query = Some(navigation_query);
            let sections = self.matching_sections(cx);
            let mut roots = Vec::new();
            if sections.contains(&SettingsSection::General) {
                roots.push(TreeItem::new(
                    SettingsSection::General.key(),
                    self.t(SettingsSection::General.key()),
                ));
            }
            let children = sections
                .iter()
                .copied()
                .filter(|section| *section != SettingsSection::General)
                .map(|section| TreeItem::new(section.key(), self.t(section.key())))
                .collect::<Vec<_>>();
            if !children.is_empty() {
                roots.push(
                    TreeItem::new("settings.appearance", self.t("settings.appearance"))
                        .children(children)
                        .expanded(true),
                );
            }
            roots.extend(
                crate::settings_menu::SettingsDestination::ALL
                    .into_iter()
                    .filter(|destination| {
                        query.is_empty()
                            || self
                                .t(destination.label_key)
                                .to_lowercase()
                                .contains(&query)
                    })
                    .map(|destination| {
                        TreeItem::new(
                            destination.label_key,
                            self.t(destination.label_key).trim_end_matches('…'),
                        )
                    }),
            );
            let selected = TreeItem::new(self.section.key(), "");
            self.navigation.update(cx, |tree, cx| {
                tree.set_items(roots, cx);
                tree.set_selected_item(Some(&selected), cx);
            });
        }
        if self.needs_sync {
            self.needs_sync = false;
            for (index, scope) in [FontScope::Interface, FontScope::Chat, FontScope::Code]
                .into_iter()
                .enumerate()
            {
                let value = u8::from(self.preferences.typography.effective(scope)).to_string();
                self.font_inputs[index].update(cx, |input, cx| input.set_value(value, window, cx));
            }
        }
        let appearance = UiAppearance::global(cx).clone();
        div()
            .id("settings-panel")
            .on_prepaint(cx.processor(|this, bounds, _, _| this.bounds = bounds))
            .size_full()
            .flex()
            .flex_col()
            .bg(appearance.palette.surface)
            .text_color(appearance.palette.text)
            .text_size(appearance.text(TextRole::Body))
            .font_weight(FontWeight::NORMAL)
            .line_height(relative(1.4))
            .child(self.content(window, cx))
    }
}
