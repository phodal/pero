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

#[derive(Default)]
pub(crate) struct AppCatalog {
    pub entries: Vec<InstalledApp>,
    pub loading: bool,
    pub error: Option<String>,
    pub removing: Option<String>,
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
        component::{button::*, *},
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
        pub(crate) fn refresh_apps(&mut self, cx: &mut Context<Self>) {
            self.apps.error = None;
            self.apps.loading = cfg!(target_family = "wasm");
            if cfg!(target_family = "wasm") {
                self.command(json!({"action":"apps_list"}), cx);
            } else {
                cx.notify();
            }
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
                    Ok(catalog) => self.apps.replace_catalog(catalog),
                    Err(_) => {
                        self.apps.loading = false;
                        self.apps.error = Some(self.t("apps.invalid_catalog").into());
                    }
                },
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
            if matches!(self.navigation.current(), Some(WorkspaceItem::App { .. })) {
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
                        self.t(if cfg!(target_family = "wasm") {
                            "apps.loading_panel"
                        } else {
                            "apps.native_unavailable"
                        })
                    })
                    .into_any_element();
            }
            let chrome = pero_theme::Chrome::from_app(cx);
            div().id("apps-library").flex_1().min_w_0().h_full().overflow_y_scroll().bg(chrome.list()).p(px(pero_theme::WorkbenchStyle::PAGE))
                .child(pero_theme::library_header(
                    "apps-library-header",
                    self.t("nav.apps"),
                    None,
                    Some(div().flex().items_center().gap(px(pero_theme::ICON_GAP))
                        .child(pero_theme::action_button("apps-refresh", self.t("apps.refresh"), pero_theme::ActionKind::Ghost, chrome)
                            .disabled(busy || !cfg!(target_family = "wasm"))
                            .on_click(cx.listener(|this, _, _, cx| this.refresh_apps(cx))))
                        .child(pero_theme::action_button("apps-install", self.t("apps.install"), pero_theme::ActionKind::Primary, chrome)
                            .disabled(busy || !cfg!(target_family = "wasm"))
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.apps.error = None;
                                this.command(json!({"action":"apps_install"}), cx);
                            })))
                        .into_any_element()),
                    chrome,
                ))
                .when(!cfg!(target_family = "wasm"), |el| el.child(div().mb(px(12.)).text_color(p.text_muted)
                    .child(self.t("apps.native_unavailable"))))
                .when_some(self.apps.error.as_ref(), |el, error| el.child(div().mb(px(12.)).p(px(10.))
                    .bg(p.error_bg).text_color(p.error).child(error.clone())))
                .when(busy, |el| el.child(div().py(px(12.)).text_color(p.text_muted).child(self.t("apps.loading"))))
                .when(cfg!(target_family = "wasm") && !busy && self.apps.entries.is_empty(), |el| el.child(
                    pero_theme::empty_state(self.t("apps.empty"), Some(self.t("apps.empty_hint").into()), chrome)))
                .children(self.apps.entries.iter().enumerate().map(|(index, app)| {
                    let name = app.name.clone();
                    let toggle_name = name.clone();
                    let remove_name = name.clone();
                    let confirming = self.apps.removing.as_deref() == Some(name.as_str());
                    let enabled = app.enabled;
                    div().py(px(8.)).border_b_1().border_color(p.border)
                        .child(div().flex().items_center().gap(px(10.))
                            .child(div().flex_1().min_w_0().flex().flex_col().gap(px(5.))
                                .child(div().flex().items_center().gap(px(8.))
                                    .child(div().font_weight(FontWeight::SEMIBOLD).child(app.display_name.clone()))
                                    .child(div().text_size(pero_theme::UiAppearance::global(cx).text(pero_theme::TextRole::Caption)).text_color(p.text_muted).child(app.version.clone())))
                                .child(div().text_color(p.text_muted).whitespace_normal().child(app.description.clone())))
                            .child(div().text_size(pero_theme::UiAppearance::global(cx).text(pero_theme::TextRole::Caption)).text_color(p.text_muted)
                                .child(self.t(if enabled { "apps.enabled" } else { "apps.disabled" })))
                            .children(app.panels.iter().enumerate().map(|(panel_index, panel)| {
                                let app_name = name.clone();
                                let panel_name = panel.id.clone();
                                let label = if app.panels.len() == 1 { self.t("apps.open").to_string() } else { panel.title.clone() };
                                Button::new(("app-open", index * 100 + panel_index)).outline().small().label(label)
                                    .disabled(busy || !enabled || !cfg!(target_family = "wasm"))
                                    .on_click(cx.listener(move |this, _, _, cx| {
                                        this.open_app(app_name.clone(), panel_name.clone(), cx);
                                        cx.notify();
                                    }))
                            }))
                            .child(Button::new(("app-toggle", index)).outline().small()
                                .label(self.t(if enabled { "apps.disable" } else { "apps.enable" })).disabled(busy || !cfg!(target_family = "wasm"))
                                .on_click(cx.listener(move |this, _, _, cx| {
                                    this.apps.loading = true;
                                    this.command(json!({"action":if enabled {"apps_disable"} else {"apps_enable"},"name":toggle_name}), cx);
                                })))
                            .child(Button::new(("app-remove", index)).ghost().small().label(self.t("apps.remove")).disabled(busy || !cfg!(target_family = "wasm"))
                                .on_click(cx.listener(move |this, _, _, cx| {
                                    this.apps.removing = Some(remove_name.clone()); cx.notify();
                                }))))
                        .when(confirming, |el| {
                            let name = name.clone();
                            el.child(div().mt(px(10.)).flex().items_center().gap(px(10.))
                                .child(div().flex_1().text_color(p.warning).child(self.t("apps.remove_hint")))
                                .child(Button::new(("app-remove-cancel", index)).outline().small().label(self.t("apps.cancel"))
                                    .on_click(cx.listener(|this, _, _, cx| { this.apps.removing = None; cx.notify(); })))
                                .child(Button::new(("app-remove-confirm", index)).outline().small().label(self.t("apps.confirm_remove"))
                                    .on_click(cx.listener(move |this, _, _, cx| {
                                        this.apps.loading = true;
                                        this.command(json!({"action":"apps_uninstall","name":name}), cx);
                                    }))))
                        })
                })).into_any_element()
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
