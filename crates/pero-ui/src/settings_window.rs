//! Settings presentation belongs to the shell; the panel emits typed intents.
use crate::{
    app::{Workbench, request_locale},
    settings_view::{SettingsAction, SettingsPanel, SettingsSection},
    workspace::WorkbenchPage,
};
#[cfg(target_family = "wasm")]
use gpui_kit::component::WindowExt;
use gpui_kit::{prelude::*, *};

impl Workbench {
    pub(crate) fn sync_settings_panel(&self, cx: &mut Context<Self>) {
        if let Some(panel) = &self.settings_panel {
            panel.update(cx, |panel, cx| {
                if panel.harness.is_none() { panel.harness = self.harness.clone(); panel.harness_sync = true; }
                panel.computer = self.computer.clone();
                panel.computer_pending = false;
                panel.receive(
                    &self.preferences,
                    &self.locale,
                    self.preferences_status,
                    self.error.as_deref(),
                    cx,
                )
            });
        }
    }

    fn attach_settings(
        &mut self,
        panel: Entity<SettingsPanel>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.settings_subscriptions =
            vec![
                cx.subscribe_in(&panel, window, |this, _, action, window, cx| {
                    match action {
                        SettingsAction::Save(preferences) => {
                            this.save_preferences(preferences.clone(), cx)
                        }
                        SettingsAction::Icons(action) => this.icon_theme_action(action.clone(),cx),
                        SettingsAction::Locale(locale) => {
                            if request_locale(locale).is_err() {
                                this.error = Some("error.preferences".into());
                                this.sync_settings_panel(cx);
                            }
                        }
                        SettingsAction::Close => this.close_settings(window, cx),
                        SettingsAction::Mcp(command) => this.command(command.clone(), cx),
                        SettingsAction::Harness(control) => {
                            this.command(serde_json::to_value(control).expect("harness control"), cx);
                        }
                        SettingsAction::Computer(control) => {
                            this.command(serde_json::to_value(control).expect("computer control"), cx);
                        }
                    }
                    cx.notify();
                }),
            ];
        let agents = self.chat.read(cx).agents.clone();
        panel.update(cx, |panel, cx| { panel.mcp.agents = agents; panel.mcp_select_first(cx); });
        let host = cx.entity().downgrade();
        panel.update(cx, |panel, cx| panel.bind_host(host, cx));
        self.settings_panel = Some(panel);
        self.apply_settings_section(cx);
        self.command(serde_json::json!({"action":"harness_get"}), cx);
        self.sync_settings_panel(cx);
        cx.notify();
    }

    fn apply_settings_section(&mut self, cx: &mut Context<Self>) {
        let Some(section) = self.settings_section.take() else { return };
        if let Some(panel) = self.settings_panel.clone() {
            panel.update(cx, |panel, cx| panel.select(section, cx));
        }
    }

    pub(crate) fn show_settings(&mut self, section: SettingsSection, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(panel) = self.settings_panel.clone() {
            self.settings_section = None;
            panel.update(cx, |panel, cx| {
                panel.clear_search(window, cx);
                panel.select(section, cx);
            });
            #[cfg(not(target_family = "wasm"))]
            if let Some(settings) = self.settings_window {
                let _ = settings.update(cx, |_, window, _| window.activate_window());
            }
            return;
        }
        self.settings_section = Some(section);
        self.open_settings(window, cx);
    }

    pub(crate) fn show_settings_page(&mut self, page: WorkbenchPage, window: &mut Window, cx: &mut Context<Self>) {
        let section = match page {
            WorkbenchPage::Connections => {
                self.prepare_remote_connection(window, cx);
                SettingsSection::Connections
            }
            WorkbenchPage::Workers => {
                self.command(serde_json::json!({"action":"remote_refresh"}), cx);
                SettingsSection::Workers
            }
            WorkbenchPage::Agents => SettingsSection::Agents,
            _ => return,
        };
        self.show_settings(section, window, cx);
    }

    pub(crate) fn leave_settings_route(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let page = self.navigation.page();
        if !matches!(page, WorkbenchPage::Agents | WorkbenchPage::Workers | WorkbenchPage::Connections) {
            return;
        }
        for _ in 0..8 {
            if !matches!(self.navigation.page(), WorkbenchPage::Agents | WorkbenchPage::Workers | WorkbenchPage::Connections) {
                break;
            }
            if self.navigation.can_back() {
                self.navigation.step_history(false);
            } else {
                self.navigation.show(WorkbenchPage::Projects);
            }
        }
        if matches!(self.navigation.page(), WorkbenchPage::Agents | WorkbenchPage::Workers | WorkbenchPage::Connections) {
            self.navigation.show(WorkbenchPage::Projects);
        }
        if matches!(self.navigation.page(), WorkbenchPage::Agents | WorkbenchPage::Workers | WorkbenchPage::Connections) {
            return;
        }
        let owner = cx.entity().downgrade();
        window.defer(cx, move |window, cx| {
            let _ = owner.update(cx, |this, cx| this.show_settings_page(page, window, cx));
        });
    }

    pub(crate) fn close_settings(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.settings_panel = None;
        self.settings_subscriptions.clear();
        #[cfg(not(target_family = "wasm"))]
        if let Some(settings) = self.settings_window.take() {
            cx.defer(move |cx| {
                let _ = settings.update(cx, |_, window, _| window.remove_window());
            });
        }
        #[cfg(target_family = "wasm")]
        {
            window.close_dialog(cx);
            // Settings may have opened from a dropdown whose focus handle is gone.
            if let Some(view) = self.navigation.current().and_then(|item| self.active_document_view(item)) {
                view.update(cx, |view, cx| view.focus(window, cx));
            } else {
                self.workspace_focus.focus(window, cx);
            }
        }
        let _ = window;
        cx.notify();
    }

    #[cfg(not(target_family = "wasm"))]
    pub(crate) fn open_settings(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(settings) = self.settings_window {
            if settings
                .update(cx, |_, window, _| window.activate_window())
                .is_ok()
            {
                return;
            }
        }
        let owner = cx.entity().downgrade();
        let main = window.window_handle();
        // Opening a second root while Workbench is borrowed would re-enter it.
        cx.defer(move |cx| {
            let Ok((preferences, locale)) = owner.read_with(cx, |this, _| {
                (this.preferences.clone(), this.locale.clone())
            }) else {
                return;
            };
            let options = WindowOptions {
                kind: WindowKind::Normal,
                window_bounds: Some(WindowBounds::Windowed(Bounds::centered(
                    None,
                    size(px(900.), px(640.)),
                    cx,
                ))),
                window_min_size: Some(size(px(700.), px(480.))),
                ..Default::default()
            };
            match gpui_kit::open_window(options, cx, |window, cx| {
                window.set_window_title(pero_contracts::i18n::text(&locale, "settings.title"));
                cx.new(|cx| SettingsPanel::new(preferences, locale, window, cx))
            }) {
                Ok((settings, panel)) => {
                    let _ = main.update(cx, |_, window, cx| {
                        owner.update(cx, |this, cx| {
                            this.attach_settings(panel, window, cx);
                            this.settings_window = Some(settings);
                            let owner = cx.entity().downgrade();
                            this.settings_subscriptions
                                .push(cx.on_window_closed(move |cx, id| {
                                    if id == settings.window_id() {
                                        let owner = owner.clone();
                                        cx.defer(move |cx| {
                                            let _ = owner.update(cx, |this, cx| {
                                                this.settings_window = None;
                                                this.settings_panel = None;
                                                this.settings_subscriptions.clear();
                                                cx.notify();
                                            });
                                        });
                                    }
                                }));
                        })
                    });
                }
                Err(error) => {
                    let _ = owner.update(cx, |this, cx| {
                        this.error = Some(error.to_string());
                        cx.notify();
                    });
                }
            }
        });
    }

    #[cfg(target_family = "wasm")]
    pub(crate) fn open_settings(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.settings_panel.is_some() {
            return;
        }
        let preferences = self.preferences.clone();
        let locale = self.locale.clone();
        let panel = cx.new(|cx| SettingsPanel::new(preferences, locale, window, cx));
        self.attach_settings(panel.clone(), window, cx);
        let owner = cx.entity().downgrade();
        window.open_dialog(cx, move |dialog, window, _| {
            let viewport = window.viewport_size();
            let owner = owner.clone();
            let cancel_owner = owner.clone();
            let cancel_panel = panel.clone();
            dialog
                .w((viewport.width - px(48.)).min(px(900.)))
                .h((viewport.height - px(80.)).min(px(640.)))
                .p_0()
                .close_button(false)
                .overlay_closable(false)
                .on_ok(|_, _, _| false)
                .on_cancel(move |_, window, cx| {
                    if !cancel_panel.update(cx, |panel, cx| panel.clear_search(window, cx)) {
                        let owner = cancel_owner.clone();
                        window.defer(cx, move |window, cx| {
                            let _ = owner.update(cx, |this, cx| this.close_settings(window, cx));
                        });
                    }
                    false
                })
                .content({
                    let panel = panel.clone();
                    move |content, _, _| {
                        content
                            .size_full()
                            .min_h_0()
                            .overflow_hidden()
                            .child(panel.clone())
                    }
                })
                .on_close(move |_, _, cx| {
                    let owner = owner.clone();
                    cx.defer(move |cx| {
                        let _ = owner.update(cx, |this, cx| {
                            this.settings_panel = None;
                            this.settings_subscriptions.clear();
                            cx.notify();
                        });
                    });
                })
        });
    }
}
