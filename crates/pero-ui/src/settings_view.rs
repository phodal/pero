//! Reusable Settings content. The shell owns windows, commands and persistence.
use crate::{
    app::Workbench,
    settings_controls::{FontSizeField, selection_button, setting_row},
    settings_menu::PreferenceSaveState,
};
pub(crate) use crate::settings_section::SettingsSection;
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
use pero_theme::{TextRole, UiAppearance, WorkbenchStyle as W};

gpui_kit::actions!(settings, [FocusSettingsSearch, FocusSettingsNavigation]);

#[derive(Clone)]
pub(crate) enum SettingsAction {
    Icons(crate::icon_themes::IconThemeAction),
    Save(WorkbenchPreferences),
    Locale(&'static str),
    Harness(pero_contracts::harness_settings::HarnessControl),
    Computer(pero_contracts::computer_runtime::ComputerControl),
    Mcp(serde_json::Value),
    Close,
}

pub(crate) struct SettingsPanel {
    pub preferences: WorkbenchPreferences,
    pub locale: String,
    pub preferences_status: PreferenceSaveState,
    pub error: Option<String>,
    pub computer: Option<pero_contracts::computer_runtime::ComputerUseState>,
    pub computer_pending: bool,
    pub(crate) mcp: crate::settings_mcp::McpEditor,
    pub(crate) section: SettingsSection,
    pub(crate) harness: Option<pero_contracts::harness_settings::HarnessState>,
    pub(crate) harness_inputs: [Entity<InputState>; 3],
    pub(crate) harness_sync: bool,
    pub(crate) harness_remove_confirm: bool,
    pub(crate) workbench: Option<WeakEntity<Workbench>>,
    navigation: Entity<TreeState>,
    navigation_focus: FocusHandle,
    navigation_query: Option<(String, String)>,
    search: Entity<InputState>,
    content_scroll: ScrollHandle,
    font_inputs: [Entity<InputState>; 3],
    needs_sync: bool,
    input_locale: String,
    focus_search: bool,
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
        let harness_inputs = std::array::from_fn(|index| cx.new(|cx| {
            InputState::new(window, cx).masked(index == 2).placeholder(pero_contracts::i18n::text(&locale, ["harness.endpoint", "harness.model", "harness.api_key"][index]))
        }));
        let navigation = cx.new(|cx| TreeState::new(cx));
        let navigation_focus = cx.focus_handle();
        let is_mac = cx.platform_info().is_mac();
        cx.bind_keys([
            KeyBinding::new(
                "escape",
                gpui_kit::base::actions::Cancel,
                Some("SettingsPanel"),
            ),
            KeyBinding::new(
                if is_mac { "cmd-f" } else { "ctrl-f" },
                FocusSettingsSearch,
                Some("SettingsPanel"),
            ),
            KeyBinding::new(
                if is_mac {
                    "cmd-shift-e"
                } else {
                    "ctrl-shift-e"
                },
                FocusSettingsNavigation,
                Some("SettingsPanel"),
            ),
        ]);
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
                let index = if query.is_empty() { if section.exclusive() { 0 } else { section as usize - 1 } } else {
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
        subscriptions.push(cx.on_focus_in(&navigation_focus, window, |_, _, cx| cx.notify()));
        subscriptions.push(cx.on_focus_out(&navigation_focus, window, |_, _, _, cx| cx.notify()));
        for (index, scope) in [FontScope::Interface, FontScope::Chat, FontScope::Code]
            .into_iter()
            .enumerate()
        {
            subscriptions.push(cx.subscribe(
                &font_inputs[index],
                move |this, input, event: &InputEvent, cx| {
                    cx.notify();
                    if matches!(event, InputEvent::Blur)
                        && this.preferences_status == PreferenceSaveState::Saving
                    {
                        return;
                    }
                    if matches!(event, InputEvent::PressEnter { .. } | InputEvent::Blur) {
                        match input.read(cx).value().parse::<FontSize>().ok() {
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
        let mcp = crate::settings_mcp::McpEditor::new(window, cx);
        Self {
            mcp,
            preferences,
            locale: locale.clone(),
            input_locale: locale,
            focus_search: true,
            bounds: Bounds::default(),
            preferences_status: Default::default(),
            error: None,
            harness: None, harness_inputs, harness_sync: true, harness_remove_confirm: false,
            computer: None,
            computer_pending: false,
            section: Default::default(),
            workbench: None,
            navigation,
            navigation_focus,
            navigation_query: None,
            search,
            content_scroll: ScrollHandle::new(),
            font_inputs,
            needs_sync: false,
            _subscriptions: subscriptions,
        }
    }
    pub(crate) fn show_mcp(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.section = SettingsSection::Mcp;
        self.navigation_query = None;
        self.clear_search(window, cx);
        cx.notify();
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
    pub(crate) fn t(&self, key: &str) -> &'static str {
        pero_contracts::i18n::text(&self.locale, key)
    }
    pub(crate) fn bind_host(&mut self, host: WeakEntity<Workbench>, cx: &mut Context<Self>) {
        let Some(host) = host.upgrade() else { return };
        self._subscriptions.push(cx.observe(&host, |_, _, cx| cx.notify()));
        self.workbench = Some(host.downgrade());
    }
    pub(crate) fn select(&mut self, section: SettingsSection, cx: &mut Context<Self>) {
        self.section = section;
        self.navigation_query = None;
        cx.notify();
    }
    pub(crate) fn clear_search(&mut self, window: &mut Window, cx: &mut Context<Self>) -> bool {
        if self.search.read(cx).value().is_empty() {
            return false;
        }
        self.search
            .update(cx, |input, cx| input.set_value("", window, cx));
        cx.notify();
        true
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
            "preferences":self.preferences,"error":self.error,"computer":self.computer,"computerPending":self.computer_pending,"mcp":self.mcp.snapshot(cx),"bounds":bounds(self.bounds),"iconTheme":&*pero_chat_ui::icon_theme::snapshot(),
            "scroll":{"bounds":bounds(self.content_scroll.bounds()),"offsetY":f32::from(self.content_scroll.offset().y),
                "maxY":f32::from(self.content_scroll.max_offset().y),"anchors":(0..self.content_scroll.children_count()).filter_map(|index|self.content_scroll.bounds_for_item(index).map(bounds)).collect::<Vec<_>>()},
            "matches":self.matching_sections(cx).iter().map(|section|section.key()).collect::<Vec<_>>(),
            "harness":self.harness,"harnessInputs":self.harness_inputs.iter().enumerate().map(|(index,input)|{
                let mut result=bounds(input.read(cx).input_bounds());
                if index < 2 { result["value"]=serde_json::json!(input.read(cx).value().as_ref()); }
                result
            }).collect::<Vec<_>>(),
            "fontInputs":self.font_inputs.iter().map(|input| {
                let input=input.read(cx);let mut result=bounds(input.input_bounds());
                result["value"]=serde_json::json!(input.value().as_ref());result
            }).collect::<Vec<_>>()})
    }
}

impl SettingsPanel {
    fn font_settings(
        &self,
        section: SettingsSection,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let scope = section.scope().expect("font section");
        let inherited = self.preferences.typography.selected(scope).is_none();
        let saving = self.preferences_status == PreferenceSaveState::Saving;
        let index = match scope {
            FontScope::Interface => 0,
            FontScope::Chat => 1,
            FontScope::Code => 2,
        };
        let owner = cx.entity().downgrade();
        let control = FontSizeField::new(
            &self.font_inputs[index],
            self.preferences.typography.effective(scope),
            format!("{} {}", self.t(section.key()), self.t("settings.font_size")).into(),
            &self.locale,
            saving,
            move |delta, _, cx| {
                let _ = owner.update(cx, |this, cx| {
                    let mut next = this.preferences.clone();
                    if let Ok(size) = this.font_inputs[index].read(cx).value().parse::<FontSize>() {
                        next.typography.set_size(scope, size);
                    }
                    next.typography.adjust(scope, delta);
                    this.save_preferences(next, cx);
                });
            },
        );
        let accessory = (scope != FontScope::Interface).then(|| {
            Checkbox::new("font-inherit")
                .small()
                .label(self.t("settings.inherit_ui"))
                .checked(inherited)
                .disabled(saving)
                .on_click(cx.listener(move |this, checked: &bool, _, cx| {
                    let mut next = this.preferences.clone();
                    next.typography.inherit(scope, *checked);
                    this.save_preferences(next, cx);
                }))
                .into_any_element()
        });
        setting_row(
            self.t("settings.font_size"),
            self.t(match scope {
                FontScope::Interface => "settings.interface_font_hint",
                FontScope::Chat => "settings.chat_font_hint",
                FontScope::Code => "settings.code_font_hint",
            }),
            accessory,
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
                None,
                mode.into_any_element(),
                true,
                cx,
            ))
            .child(setting_row(
                self.t("settings.accent"),
                "",
                None,
                accent.into_any_element(),
                false,
                cx,
            ))
            .child(setting_row(self.t("icons.title"),"",None,crate::icon_themes::controls(&self.locale,cx),false,cx))
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
            None,
            control.into_any_element(),
            false,
            cx,
        )
        .into_any_element()
    }

    pub(crate) fn matching_sections(&self, cx: &App) -> Vec<SettingsSection> {
        let query = self.search.read(cx).value().trim().to_lowercase();
        SettingsSection::ALL
            .into_iter()
            .filter(|section| cfg!(target_family = "wasm") || !matches!(section, SettingsSection::Computer | SettingsSection::Harness))
            .filter(|section| {
                let mut text = self.t(section.key()).to_owned();
                let keys: &[&str] = match section {
                    SettingsSection::General => &["menu.language"],
                    SettingsSection::Mcp => &["mcp.agent", "mcp.add"],
                    SettingsSection::Harness => &["harness.api_key", "harness.endpoint", "harness.model"],
                    SettingsSection::Computer => &["computer.enable", "computer.permissions", "computer.stop"],
                    SettingsSection::Theme => &["settings.appearance", "settings.accent", "icons.title"],
                    SettingsSection::InterfaceFont => &[
                        "settings.font_size",
                        "settings.interface_font_hint",
                        "settings.appearance",
                    ],
                    SettingsSection::ChatFont => &[
                        "settings.font_size",
                        "settings.chat_font_hint",
                        "settings.inherit_ui",
                        "settings.appearance",
                    ],
                    SettingsSection::CodeFont => &[
                        "settings.font_size",
                        "settings.code_font_hint",
                        "settings.inherit_ui",
                        "settings.appearance",
                    ],
                    SettingsSection::Agents => &["agents.description", "agents.installed", "agents.missing", "chat.new", "settings.agents"],
                    SettingsSection::Workers => &["settings.resources", "worker.local.title", "worker.local.enable", "cloud.workers_hint", "cloud.no_workers", "remote.refresh"],
                    SettingsSection::Connections => &["settings.connections", "connector.description", "connector.url", "connector.token", "connector.login", "connector.connect"],
                };
                for key in keys {
                    text.push(' ');
                    text.push_str(self.t(key));
                }
                match section {
                    SettingsSection::General => text.push_str(" English 简体中文"),
                    SettingsSection::Theme => {
                        for mode in [Appearance::System, Appearance::Light, Appearance::Dark] {
                            text.push(' ');
                            text.push_str(self.t(mode.label_key()));
                        }
                        for accent in [AccentColor::Teal, AccentColor::Blue, AccentColor::Neutral] {
                            text.push(' ');
                            text.push_str(self.t(accent.label_key()));
                        }
                    }
                    _ => {}
                }
                let text = text.to_lowercase();
                query.split_whitespace().all(|term| text.contains(term))
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
            .filter(|section| !query.is_empty() || if self.section.exclusive() { *section == self.section } else { !section.exclusive() })
            .collect::<Vec<_>>();
        let mut content = div()
            .id("settings-content")
            .flex_1()
            .min_w_0()
            .min_h_0()
            .overflow_y_scroll()
            .track_scroll(&self.content_scroll)
            .px(px(16.))
            .pt(px(8.))
            .pb(px(12.));
        for section in visible.iter().copied() {
            let body = match section {
                SettingsSection::Theme => self.theme_settings(cx),
                SettingsSection::General => self.language_settings(cx),
                SettingsSection::Computer => self.computer_settings(cx),
                SettingsSection::Mcp => self.mcp_settings(cx),
                SettingsSection::Harness => self.harness_settings(cx),
                SettingsSection::Agents | SettingsSection::Workers | SettingsSection::Connections => self.category_page(section, cx),
                _ => self.font_settings(section, window, cx),
            };
            content = content.child(
                div()
                    .id(("settings-page", section as usize))
                    .mb(px(W::SECTION))
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
                    .child(pero_theme::settings_panel(body, pero_theme::Chrome::from_app(cx))),
            );
        }
        if visible.is_empty() {
            content = content.child(
                div().id("settings-empty").child(pero_theme::empty_state(
                    self.t("settings.no_results"),
                    None,
                    pero_theme::Chrome::from_app(cx),
                )),
            );
        }
        let navigation = self.navigation.clone();
        let row_height = pero_theme::ROW_NAV;
        let navigation_focused =
            self.navigation_focus.contains_focused(window, cx) && window.last_input_was_keyboard();
        div()
            .flex_1()
            .min_w_0()
            .min_h_0()
            .flex()
            .child(
                div()
                    .w(px(pero_theme::SIDEBAR_WIDTH))
                    .flex_shrink_0()
                    .flex()
                    .flex_col()
                    .bg(p.surface_muted)
                    .border_r_1()
                    .border_color(p.border)
                    .child(
                        div().p(px(pero_theme::SPACE_12)).child(
                            pero_theme::search_field(Input::new(&self.search), pero_theme::Chrome::from_app(cx))
                                .cleanable(true)
                                .aria_label(self.t("settings.search")),
                        ),
                    )
                    .child(
                        div()
                            .id("settings-navigation")
                            .track_focus(&self.navigation_focus)
                            .flex_1()
                            .min_h_0()
                            .px(px(8.))
                            .on_mouse_down(MouseButton::Left, move |_, window, cx| {
                                navigation.update(cx, |tree, cx| tree.focus(window, cx));
                            })
                            .child(
                                gpui_kit::base::Tree::new(&self.navigation)
                                    .size_full()
                                    .list_style(StyleRefinement::default().size_full())
                                    .item(move |_, entry, state, _, _| {
                                        div()
                                            .id("settings-nav-row")
                                            .h(px(row_height))
                                            .px(px(pero_theme::SPACE_8))
                                            .flex()
                                            .items_center()
                                            .gap(px(pero_theme::ICON_GAP))
                                            .rounded(px(pero_theme::RADIUS_SELECTION))
                                            .text_color(p.text)
                                            .when(state.is_selected(), |el| el.bg(p.accent_soft))
                                            .when(state.is_selected() && navigation_focused, |el| {
                                                el.border_1().border_color(p.focus)
                                            })
                                            .when(!state.is_selected(), |el| {
                                                el.hover(|el| el.bg(p.text.opacity(0.08)))
                                            })
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
                                                            div()
                                                                .w(px(0.5))
                                                                .h(px(row_height))
                                                                .bg(p.border),
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
                            .min_h(px(appearance.typography.row_height() + 8.))
                            .flex_shrink_0()
                            .px(px(16.))
                            .flex()
                            .items_center()
                            .gap(px(12.))
                            .child(div().font_weight(FontWeight::MEDIUM).child(self.t(if !query.is_empty() {
                                "settings.search_results"
                            } else if self.section.is_appearance() {
                                "settings.appearance"
                            } else { self.section.key() })))
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
                                .px(px(16.))
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
        self.sync_harness_inputs(window, cx);
        if self.focus_search {
            self.focus_search = false;
            self.search.update(cx, |input, cx| input.focus(window, cx));
        }
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
            let roots = crate::settings_pages::navigation_roots(self, cx);
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
            .key_context("SettingsPanel")
            .capture_action(
                cx.listener(|this, _: &gpui_kit::base::actions::Cancel, window, cx| {
                    if this.clear_search(window, cx) {
                        cx.stop_propagation();
                    } else {
                        cx.propagate();
                    }
                }),
            )
            .capture_action(cx.listener(|this, _: &FocusSettingsSearch, window, cx| {
                this.search.update(cx, |input, cx| {
                    input.focus(window, cx);
                    input.select_all(window, cx);
                });
                cx.stop_propagation();
            }))
            .capture_action(
                cx.listener(|this, _: &FocusSettingsNavigation, window, cx| {
                    this.navigation
                        .update(cx, |tree, cx| tree.focus(window, cx));
                    cx.stop_propagation();
                }),
            )
            .capture_key_down(cx.listener(|this, event: &KeyDownEvent, window, cx| {
                if !this.search.read(cx).focus_handle(cx).is_focused(window) {
                    return;
                }
                match event.keystroke.key.as_str() {
                    "down" => {
                        this.navigation.update(cx, |tree, cx| {
                            let first = (0..)
                                .map_while(|index| tree.entry(index).map(|entry| (index, entry)))
                                .find(|(_, entry)| !entry.is_folder())
                                .map(|(index, _)| index);
                            tree.set_selected_index(first, cx);
                            tree.focus(window, cx);
                        });
                        cx.stop_propagation();
                    }
                    _ => {}
                }
            }))
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
