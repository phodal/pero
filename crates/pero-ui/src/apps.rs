//! Installed App catalog and the Workbench's selected surface.
use serde::{Deserialize, Serialize};

#[derive(Clone, Deserialize, Serialize)]
pub(crate) struct AppPanel {
    pub id: String,
    pub title: String,
    pub entry: String,
}

#[derive(Clone, Deserialize, Serialize)]
pub(crate) struct InstalledApp {
    pub name: String,
    pub version: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    #[serde(default)]
    pub description: String,
    pub enabled: bool,
    #[serde(default)]
    pub tenure: String,
    pub panels: Vec<AppPanel>,
}

#[derive(Clone, Deserialize, Serialize)]
pub(crate) struct AppSelection {
    pub name: String,
    pub panel: String,
}

/// Host-measured placement of the shared conversation in one managed App.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub(crate) struct AppChatSlot {
    pub scope: pero_contracts::AppChatScope,
    pub rect: AppChatSlotRect,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub(crate) struct AppChatSlotRect {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

#[derive(Clone, Deserialize)]
pub(crate) struct AppPreparationView {
    pub name: String,
    pub phase: String,
    pub message: String,
    #[serde(skip)]
    pub log: Vec<String>,
}

#[derive(Default)]
pub(crate) struct AppCatalog {
    pub entries: Vec<InstalledApp>,
    pub loading: bool,
    pub error: Option<String>,
    pub removing: Option<String>,
    pub preparation: Option<AppPreparationView>,
}

impl AppCatalog {
    pub fn replace_catalog(&mut self, entries: Vec<InstalledApp>) {
        self.entries = entries;
        self.loading = false;
        self.error = None;
        self.removing = None;
    }

    /// A failed observation cannot establish that a previously saved source was removed.
    pub fn retains_panel(&self, name: &str, panel: &str) -> bool {
        self.error.is_some() || self.contains_panel(name, panel)
    }

    pub fn contains_panel(&self, name: &str, panel: &str) -> bool {
        self.entries.iter().any(|app| {
            app.name == name && app.enabled && app.panels.iter().any(|entry| entry.id == panel)
        })
    }
}

#[cfg(any(target_family = "wasm", feature = "native"))]
mod surface {
    use super::*;
    use crate::{app::Workbench, workspace::WorkspaceItem};
    use gpui_kit::{
        component::{button::*, menu::{DropdownMenu, PopupMenuItem}, *},
        prelude::*,
        *,
    };
    use pero_contracts::HostEvent;
    use serde_json::json;

    #[cfg(target_family = "wasm")]
    #[wasm_bindgen::prelude::wasm_bindgen]
    extern "C" {
        #[wasm_bindgen::prelude::wasm_bindgen(js_namespace = window, js_name = peroAppSurface, catch)]
        fn app_surface(json: &str) -> Result<(), wasm_bindgen::JsValue>;
    }

    impl Workbench {
        pub(crate) fn app_preparation_content(&self, cx: &mut Context<Self>) -> AnyElement {
            let Some(value) = &self.apps.preparation else { return div().into_any_element(); };
            let name = value.name.clone();
            let phase = match value.phase.as_str() {
                "checking" => self.t("apps.env_checking"),
                "creating" => self.t("apps.env_creating"),
                "installing" => self.t("apps.env_installing"),
                "ready" => self.t("apps.env_ready"),
                _ => self.t("apps.env_failed"),
            };
            div().flex().flex_col().gap(px(12.)).p(px(12.))
                .child(format!("{}: {}", value.name, phase))
                .children(value.log.iter().map(|line| div().text_sm().child(line.clone())))
                .when(value.phase == "failed", |el| el.child(Button::new("app-env-retry")
                    .label(self.t("apps.env_retry"))
                    .on_click(cx.listener(move |this, _, _, cx| {
                        if let Some(WorkspaceItem::App { name: active, panel }) = this.navigation.current() {
                            if active == &name { this.pending_app = Some((active.clone(), panel.clone())); }
                        }
                        this.command(json!({"action":"apps_enable","name":name}), cx);
                    }))))
                .into_any_element()
        }

        pub(crate) fn installed_app_title(&self, name: &str, display_name: &str) -> String {
            if name == "connectors" {
                self.t("nav.connectors").to_string()
            } else {
                display_name.to_string()
            }
        }

        pub(crate) fn refresh_apps(&mut self, cx: &mut Context<Self>) {
            self.apps.error = None;
            self.apps.loading = true;
            self.command(json!({"action":"apps_list"}), cx);
        }

        pub(crate) fn receive_apps(&mut self, event: &HostEvent, cx: &mut Context<Self>) -> bool {
            match event.kind.as_str() {
                "app_chat_slot" => {
                    let slot = serde_json::from_value::<Option<AppChatSlot>>(event.data.clone()).ok().flatten();
                    let slot = slot.filter(|slot| {
                        self.navigation.current() == Some(&WorkspaceItem::App { name: slot.scope.app.clone(), panel: slot.scope.panel.clone() })
                            && self.navigation.pane_layout().is_none_or(|layout| layout.leaves().len() <= 1)
                    });
                    if self.app_chat_slot != slot {
                        self.app_chat_slot = slot;
                        self.sync_follow(cx);
                    }
                }
                "app_scope" => {
                    if let Ok(scope) =
                        serde_json::from_value::<pero_contracts::AppChatScope>(event.data.clone())
                    {
                        if self.apps.contains_panel(&scope.app, &scope.panel) {
                            self.navigation.open(WorkspaceItem::App {
                                name: scope.app.clone(),
                                panel: scope.panel.clone(),
                            });
                            if !self.active_app_chat_slot().is_some_and(|slot| slot.scope == scope) {
                                self.set_chat_dock(true, cx);
                            }
                            self.chat
                                .update(cx, |chat, cx| chat.set_scope(Some(scope), cx));
                            self.sync_follow(cx);
                        }
                    }
                }
                "apps_catalog" => match serde_json::from_value(event.data.clone()) {
                    Ok(catalog) => {
                        self.apps.replace_catalog(catalog);
                        if let Some((name, panel)) = self.pending_app.clone() {
                            self.pending_app = None;
                            self.open_app(name, panel, cx);
                        }
                    }
                    Err(_) => {
                        self.apps.loading = false;
                        self.apps.error = Some(self.t("apps.invalid_catalog").into());
                    }
                },
                "apps_preparation" => {
                    if let Ok(mut value) = serde_json::from_value::<AppPreparationView>(event.data.clone()) {
                        if value.phase != "checking" {
                            if let Some(previous) = self.apps.preparation.take().filter(|p| p.name == value.name) { value.log = previous.log; }
                        }
                        value.log.push(value.message.clone());
                        if value.log.len() > 8 { value.log.remove(0); }
                        self.apps.preparation = Some(value);
                    }
                }
                "apps_error" => {
                    self.apps.loading = false;
                    self.apps.error = Some(event.text.clone());
                }
                "apps_opened" => {
                    // Re-publish current ownership after a potentially slow open.
                    // A tab closed meanwhile must release the late iframe too.
                    self.app_surface.clear();
                    if let Ok(selection) =
                        serde_json::from_value::<AppSelection>(event.data.clone())
                    {
                        // Completion acknowledges this surface only. A slow backend
                        // must not reopen an App after the user left it.
                        if self.navigation.current()
                            == Some(&WorkspaceItem::App {
                                name: selection.name,
                                panel: selection.panel,
                            })
                        {
                            self.apps.error = None;
                        }
                    }
                }
                _ => return false,
            }
            cx.notify();
            true
        }

        /// The Web surface uses the content slot's actual GPUI layout bounds.
        pub(crate) fn publish_app_surfaces(&mut self, mut payload: serde_json::Value, cx: &App) {
            #[cfg(target_family="wasm")]
            {
                payload["open"] = json!(self.navigation.items().iter().filter_map(|item|match item {WorkspaceItem::App{name,panel}=>Some(json!({"name":name,"panel":panel})),_=>None}).collect::<Vec<_>>());
                let payload=payload.to_string();
                if self.app_surface!=payload {self.app_surface=payload;let _=app_surface(&self.app_surface);}
            }
            let _=(&mut payload,cx);
        }
        pub(crate) fn sync_app_surface(&mut self, bounds: Option<Bounds<Pixels>>, cx: &mut Context<Self>) {
            #[cfg(not(target_family="wasm"))]
            self.sync_native_apps(cx);
            if self.navigation.pane_layout_visible() {self.sync_pane_surfaces(cx);return;}
            #[cfg(target_family = "wasm")]
            {
                let bounds = bounds.filter(|_| self.layout.embedded_surface_visible);
                let payload = match (self.navigation.current(), bounds) {
                    (Some(WorkspaceItem::App { name, panel }), Some(bounds)) => {
                        json!({"visible":true,"name":name,"panel":panel,
                        "left":f32::from(bounds.origin.x),"top":f32::from(bounds.origin.y),
                        "width":f32::from(bounds.size.width),"height":f32::from(bounds.size.height),
                        "dark":pero_theme::UiAppearance::global(cx).dark,"appearance":pero_theme::UiAppearance::global(cx),"locale":self.locale})
                    }
                    _ => json!({"visible":false,"dark":pero_theme::UiAppearance::global(cx).dark,"appearance":pero_theme::UiAppearance::global(cx),"locale":self.locale}),
                };
                self.publish_app_surfaces(payload,cx);
            }
            #[cfg(not(target_family = "wasm"))]
            let _ = (bounds, cx);
        }

        pub(crate) fn apps_view(&self, cx: &mut Context<Self>) -> AnyElement {
            let p = &pero_theme::UiAppearance::global(cx).palette.clone();
            let busy = self.apps.loading;
            if let Some(WorkspaceItem::App { name, panel }) = self.navigation.current() {
                #[cfg(not(target_family="wasm"))]
                return self.native_app_content(name,panel,cx);
                #[cfg(target_family="wasm")]
                let _ = (name,panel);
                #[cfg(target_family="wasm")]
                {
                let owner = cx.entity().clone();
                return div()
                    .on_prepaint(move |bounds, _, cx| {
                        owner.update(cx, |this, cx| this.sync_app_surface(Some(bounds), cx))
                    })
                    .flex_1()
                    .min_w_0()
                    .h_full()
                    .p(px(pero_theme::WorkbenchStyle::PAGE))
                    .text_color(p.text_muted)
                    .child(if !self.layout.embedded_surface_visible {
                        ""
                    } else {
                        self.t("apps.loading_panel")
                    })
                    .into_any_element();
                }
            }
            #[cfg(not(target_family = "wasm"))]
            let preparation = self.apps.preparation.as_ref().filter(|value| value.phase != "ready").map(|_| self.app_preparation_content(cx));
            #[cfg(target_family = "wasm")]
            let preparation: Option<AnyElement> = None;
            let chrome = pero_theme::Chrome::from_app(cx);
            div().id("apps-library").flex_1().min_w_0().h_full().overflow_y_scroll().bg(chrome.list()).p(px(pero_theme::WorkbenchStyle::PAGE))
                .child(div().id("apps-library-header").flex().flex_shrink_0().items_center().justify_end()
                    .gap(px(pero_theme::ICON_GAP)).mb(px(pero_theme::WorkbenchStyle::PAGE))
                    .child(pero_theme::action_button("apps-refresh", self.t("apps.refresh"), pero_theme::ActionKind::Ghost, chrome, cx)
                        .icon(Icon::default().path(pero_chat_ui::assets::UiIcon::Refresh.path()))
                        .disabled(busy)
                        .on_click(cx.listener(|this, _, _, cx| this.refresh_apps(cx))))
                    .child(pero_theme::action_button("apps-install", self.t("apps.install"), pero_theme::ActionKind::Primary, chrome, cx)
                        .icon(Icon::default().path(pero_chat_ui::assets::UiIcon::Folder.path()))
                        .disabled(busy)
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.apps.error = None;
                            this.command(json!({"action":"apps_install"}), cx);
                        }))))
                .children(preparation)
                .when_some(self.apps.error.as_ref(), |el, error| el.child(div().mb(px(12.)).p(px(10.))
                    .bg(p.error_bg).text_color(p.error).child(error.clone())))
                .when(busy, |el| el.child(div().py(px(12.)).text_color(p.text_muted).child(self.t("apps.loading"))))
                .when(!busy && self.apps.entries.is_empty(), |el| el.child(
                    pero_theme::empty_state(self.t("apps.empty"), Some(self.t("apps.empty_hint").into()), chrome)))
                .when_some(self.apps.removing.as_ref(), |el, name| {
                    let name = name.clone();
                    el.child(div().mb(px(12.)).p(px(12.)).bg(p.warning_bg).flex().flex_col().gap(px(8.))
                        .child(format!("{}: {}", name, self.t("apps.remove_hint")))
                        .child(div().flex().gap(px(8.))
                            .child(Button::new("app-remove-cancel").small().label(self.t("apps.cancel"))
                                .on_click(cx.listener(|this, _, _, cx| { this.apps.removing = None; cx.notify(); })))
                            .child(Button::new("app-remove-confirm").danger().small().label(self.t("apps.confirm_remove"))
                                .on_click(cx.listener(move |this, _, _, cx| {
                                    this.apps.loading = true;
                                    this.command(json!({"action":"apps_uninstall","name":name}), cx);
                                })))))
                })
                .child(div().id("apps-launchpad").w_full().flex().flex_wrap().items_start().gap(px(16.))
                    .children(self.apps.entries.iter().enumerate().map(|(index, app)| {
                        let title = self.installed_app_title(&app.name, &app.display_name);
                        let name = app.name.clone();
                        let required = app.tenure == "required";
                        let panel = app.panels.first().map(|panel| panel.id.clone()).unwrap_or_default();
                        let open_name = name.clone();
                        let icon = pero_chat_ui::icon_theme::app_icon(&name, pero_theme::UiAppearance::global(cx).dark);
                        let owner = cx.entity().downgrade();
                        let toggle_name = name.clone();
                        let remove_name = name.clone();
                        let enabled = app.enabled;
                        let toggle_label = self.t(if enabled { "apps.disable" } else { "apps.enable" });
                        let remove_label = self.t("apps.remove");
                        let menu_caption = format!("{}  {}", title, app.version);
                        div().w(px(160.)).min_w_0().flex().flex_col().items_center().gap(px(4.)).pb(px(12.))
                            .child(Button::new(("app-open", index)).ghost().w_full().h(px(112.)).px(px(8.))
                                .accessibility_label(title.clone()).tooltip(format!("{} {}\n{}", title, app.version, app.description))
                                .disabled(busy || !enabled)
                                .relative().children((enabled && !busy).then(|| self.view_bounds.app_open.probe(name.clone())))
                                .child(div().flex().flex_col().items_center().gap(px(10.)).w_full()
                                    .child(div().size(px(56.)).rounded(px(12.)).bg(p.surface).flex().items_center().justify_center()
                                        .when(!enabled, |el| el.opacity(0.45))
                                        .child(svg().path(icon).size(px(30.)).text_color(p.text)))
                                    .child(div().w_full().text_ellipsis().text_center().font_weight(FontWeight::SEMIBOLD).child(title.clone())))
                                .on_click(cx.listener(move |this, _, _, cx| { this.open_app(open_name.clone(), panel.clone(), cx); cx.notify(); })))
                            .child(div().h(px(24.)).flex().items_center().justify_center().gap(px(8.))
                                .when(enabled, |el| el.child(div().text_size(px(12.)).text_color(p.text_muted).child(app.version.clone())))
                                .when(!enabled, |el| {
                                    let name = name.clone();
                                    el.child(Button::new(("app-enable", index)).ghost().small().label(self.t("apps.enable")).disabled(busy)
                                        .on_click(cx.listener(move |this, _, _, cx| {
                                            this.apps.loading = true;
                                            this.command(json!({"action":"apps_enable","name":name}), cx);
                                        })))
                                })
                                .when(!required, |el| el.child(pero_theme::ghost_icon_button(("app-menu", index), chrome, cx)
                                    .icon(Icon::default().path("icons/dots.svg")).accessibility_label(format!("{}: {}", title, self.t("apps.actions")))
                                    .tooltip(self.t("apps.actions")).disabled(busy).dropdown_caret(false)
                                    .dropdown_menu_with_anchor(Anchor::TopRight, move |menu, _, _| {
                                        let toggle = owner.clone(); let remove = owner.clone();
                                        let toggle_name = toggle_name.clone(); let remove_name = remove_name.clone();
                                        menu.min_w(px(180.)).item(PopupMenuItem::label(menu_caption.clone())).separator()
                                            .item(PopupMenuItem::new(toggle_label).on_click(move |_, _, cx| {
                                                let _ = toggle.update(cx, |this, cx| {
                                                    this.apps.loading = true;
                                                    this.command(json!({"action":if enabled {"apps_disable"} else {"apps_enable"},"name":toggle_name}), cx);
                                                    cx.notify();
                                                });
                                            }))
                                            .item(PopupMenuItem::new(remove_label).on_click(move |_, _, cx| {
                                                let _ = remove.update(cx, |this, cx| { this.apps.removing = Some(remove_name.clone()); cx.notify(); });
                                            }))
                                    }))))
                    }))).into_any_element()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn installed_panel_availability_follows_catalog() {
        for (enabled, panel_exists, failed, expected, retained) in [
            (true, true, false, true, true),
            (false, true, false, false, false),
            (true, false, false, false, false),
            (true, false, true, false, true),
        ] {
            let app = |enabled, exists| InstalledApp {
                name: "cell".into(),
                version: "1".into(),
                display_name: "Cell".into(),
                description: String::new(),
                tenure: String::new(),
                enabled,
                panels: if exists {
                    vec![AppPanel {
                        id: "main".into(),
                        title: "Cell".into(),
                        entry: "dist/index.html".into(),
                    }]
                } else {
                    vec![]
                },
            };
            let mut workspace = AppCatalog::default();
            workspace.replace_catalog(vec![app(true, true)]);
            assert!(workspace.contains_panel("cell", "main"));
            workspace.replace_catalog(vec![app(enabled, panel_exists)]);
            workspace.error = failed.then(|| "Catalog unavailable".into());
            assert_eq!(workspace.contains_panel("cell", "main"), expected);
            assert_eq!(workspace.retains_panel("cell", "main"), retained);
            workspace.replace_catalog(vec![]);
            assert!(!workspace.contains_panel("cell", "main"));
            assert!(!workspace.retains_panel("cell", "main"));
        }
    }
}
