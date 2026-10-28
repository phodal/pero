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

#[derive(Default)]
pub(crate) struct AppWorkspace {
    pub catalog: Vec<InstalledApp>,
    pub active: Option<AppSelection>,
    pub loading: bool,
    pub error: Option<String>,
    pub removing: Option<String>,
}

impl AppWorkspace {
    /// A refreshed installation may no longer offer the currently selected panel.
    pub fn replace_catalog(&mut self, catalog: Vec<InstalledApp>) {
        self.catalog = catalog;
        if let Some(active) = &self.active {
            if !self.catalog.iter().any(|app| {
                app.name == active.name && app.enabled
                    && app.panels.iter().any(|panel| panel.id == active.panel)
            }) {
                self.active = None;
            }
        }
        self.loading = false;
        self.error = None;
        self.removing = None;
    }

    pub fn select(&mut self, name: &str, panel: &str) -> bool {
        if self.catalog.iter().any(|app| app.name == name && app.enabled
            && app.panels.iter().any(|entry| entry.id == panel)) {
            self.active = Some(AppSelection { name: name.into(), panel: panel.into() });
            self.error = None;
            true
        } else { false }
    }
}

#[cfg(any(target_family = "wasm", feature = "native"))]
mod surface {
    use super::*;
    use crate::app::Workbench;
    use gpui_kit::{component::{button::*, *}, prelude::*, *};
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
            } else { cx.notify(); }
        }

        pub(crate) fn receive_apps(&mut self, event: &HostEvent, cx: &mut Context<Self>) -> bool {
            match event.kind.as_str() {
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
                    if let Ok(selection) = serde_json::from_value::<AppSelection>(event.data.clone()) {
                        // Completion acknowledges this surface only. A slow backend
                        // must not reopen an App after the user left it.
                        if self.navigation == 7 && self.apps.active.as_ref().is_some_and(|active|
                            active.name == selection.name && active.panel == selection.panel) {
                            self.apps.error = None;
                        }
                    }
                }
                _ => return false,
            }
            cx.notify();
            true
        }

        /// GPUI owns the viewport; the web shell places the App frame in this slot.
        pub(crate) fn sync_app_surface(&mut self, left: f32, width: f32, height: f32) {
            #[cfg(target_family = "wasm")]
            {
                let payload = if let Some(active) = self.apps.active.as_ref().filter(|_| self.navigation == 7) {
                    json!({"visible":true,"name":active.name,"panel":active.panel,
                        "left":left,"top":48,"width":(width-left).max(0.),"height":(height-48.).max(0.),
                        "dark":self.dark,"locale":self.locale})
                } else {
                    json!({"visible":false,"dark":self.dark,"locale":self.locale})
                }.to_string();
                if self.app_surface != payload {
                    self.app_surface = payload;
                    let _ = app_surface(&self.app_surface);
                }
            }
            #[cfg(not(target_family = "wasm"))]
            let _ = (left, width, height);
        }

        pub(crate) fn apps_view(&self, cx: &mut Context<Self>) -> AnyElement {
            let p = self.palettes.get(self.dark);
            let busy = self.apps.loading;
            if let Some(active) = &self.apps.active {
                let title = self.apps.catalog.iter().find(|app| app.name == active.name)
                    .map(|app| app.display_name.clone()).unwrap_or_else(|| active.name.clone());
                return div().flex_1().min_w_0().h_full().flex().flex_col()
                    .child(div().h(px(48.)).flex_shrink_0().px(px(12.)).flex().items_center().gap(px(10.))
                        .border_b_1().border_color(p.color("border"))
                        .child(Button::new("apps-back").ghost().small().label(self.t("apps.back"))
                            .on_click(cx.listener(|this, _, _, cx| { this.apps.active = None; cx.notify(); })))
                        .child(div().font_weight(FontWeight::SEMIBOLD).child(title)))
                    .child(div().flex_1().p(px(20.)).text_color(p.color("text-muted"))
                        .child(self.t(if cfg!(target_family = "wasm") { "apps.loading_panel" } else { "apps.native_unavailable" }))).into_any_element();
            }
            div().id("apps-library").flex_1().min_w_0().h_full().overflow_y_scroll().p(px(20.))
                .child(div().flex().items_center().gap(px(10.)).mb(px(16.))
                    .child(div().text_size(px(22.)).font_weight(FontWeight::SEMIBOLD).child(self.t("nav.apps")))
                    .child(div().flex_1())
                    .child(Button::new("apps-refresh").outline().small().label(self.t("apps.refresh")).disabled(busy || !cfg!(target_family = "wasm"))
                        .on_click(cx.listener(|this, _, _, cx| this.refresh_apps(cx))))
                    .child(Button::new("apps-install").primary().small().label(self.t("apps.install"))
                        .disabled(busy || !cfg!(target_family = "wasm"))
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.apps.error = None;
                            this.command(json!({"action":"apps_install"}), cx);
                        }))))
                .when(!cfg!(target_family = "wasm"), |el| el.child(div().mb(px(12.)).text_color(p.color("text-muted"))
                    .child(self.t("apps.native_unavailable"))))
                .when_some(self.apps.error.as_ref(), |el, error| el.child(div().mb(px(12.)).p(px(10.))
                    .bg(p.color("error-bg")).text_color(p.color("error")).child(error.clone())))
                .when(busy, |el| el.child(div().py(px(12.)).text_color(p.color("text-muted")).child(self.t("apps.loading"))))
                .when(cfg!(target_family = "wasm") && !busy && self.apps.catalog.is_empty(), |el| el.child(div().py(px(32.)).flex().flex_col().gap(px(8.))
                    .child(div().font_weight(FontWeight::SEMIBOLD).child(self.t("apps.empty")))
                    .child(div().text_color(p.color("text-muted")).child(self.t("apps.empty_hint")))))
                .children(self.apps.catalog.iter().enumerate().map(|(index, app)| {
                    let name = app.name.clone();
                    let toggle_name = name.clone();
                    let remove_name = name.clone();
                    let confirming = self.apps.removing.as_deref() == Some(name.as_str());
                    let enabled = app.enabled;
                    div().py(px(14.)).border_b_1().border_color(p.color("border"))
                        .child(div().flex().items_center().gap(px(10.))
                            .child(div().flex_1().min_w_0().flex().flex_col().gap(px(5.))
                                .child(div().flex().items_center().gap(px(8.))
                                    .child(div().font_weight(FontWeight::SEMIBOLD).child(app.display_name.clone()))
                                    .child(div().text_size(px(12.)).text_color(p.color("text-muted")).child(app.version.clone())))
                                .child(div().text_color(p.color("text-muted")).whitespace_normal().child(app.description.clone())))
                            .child(div().text_size(px(12.)).text_color(p.color("text-muted"))
                                .child(self.t(if enabled { "apps.enabled" } else { "apps.disabled" })))
                            .children(app.panels.iter().enumerate().map(|(panel_index, panel)| {
                                let app_name = name.clone();
                                let panel_name = panel.id.clone();
                                let label = if app.panels.len() == 1 { self.t("apps.open").to_string() } else { panel.title.clone() };
                                Button::new(("app-open", index * 100 + panel_index)).outline().small().label(label)
                                    .disabled(busy || !enabled || !cfg!(target_family = "wasm"))
                                    .on_click(cx.listener(move |this, _, _, cx| {
                                        if this.apps.select(&app_name, &panel_name) {
                                            this.command(json!({"action":"apps_open","name":app_name,"panel":panel_name}), cx);
                                        }
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
                                .child(div().flex_1().text_color(p.color("warning")).child(self.t("apps.remove_hint")))
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
    fn selected_panel_follows_installation_availability() {
        for (enabled, panel_exists, expected) in [(true, true, true), (false, true, false), (true, false, false)] {
            let app = |enabled, exists| InstalledApp {
                name: "cell".into(), version: "1".into(), display_name: "Cell".into(),
                description: String::new(), enabled,
                panels: if exists { vec![AppPanel { id: "main".into(), title: "Cell".into(), entry: "dist/index.html".into() }] } else { vec![] },
            };
            let mut workspace = AppWorkspace::default();
            workspace.replace_catalog(vec![app(true, true)]);
            assert!(workspace.select("cell", "main"));
            workspace.replace_catalog(vec![app(enabled, panel_exists)]);
            assert_eq!(workspace.active.is_some(), expected);
            assert_eq!(workspace.select("cell", "main"), expected);
            workspace.replace_catalog(vec![]);
            assert!(workspace.active.is_none());
        }
    }
}
