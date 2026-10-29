//! Settings presentation belongs to the shell; the panel emits typed intents.
use crate::{
    app::{Workbench, request_locale},
    settings_view::{SettingsAction, SettingsPanel},
    workspace::WorkbenchPage,
};
#[cfg(target_family = "wasm")]
use gpui_kit::component::WindowExt;
use gpui_kit::{prelude::*, *};

impl Workbench {
    pub(crate) fn sync_settings_panel(&self, cx: &mut Context<Self>) {
        if let Some(panel) = &self.settings_panel {
            panel.update(cx, |panel, cx| {
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
                        SettingsAction::Locale(locale) => {
                            if request_locale(locale).is_err() {
                                this.error = Some("error.preferences".into());
                                this.sync_settings_panel(cx);
                            }
                        }
                        SettingsAction::Navigate(page) => {
                            this.close_settings(window, cx);
                            this.navigate(*page, cx);
                            if *page == WorkbenchPage::Connections {
                                this.open_remote_connection(window, cx);
                            }
                            this.sync_follow(cx);
                        }
                        SettingsAction::Close => this.close_settings(window, cx),
                    }
                    cx.notify();
                }),
            ];
        self.settings_panel = Some(panel);
        self.sync_settings_panel(cx);
        cx.notify();
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
        window.close_dialog(cx);
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
                    size(px(960.), px(720.)),
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
            dialog
                .w((viewport.width - px(48.)).min(px(960.)))
                .h((viewport.height - px(80.)).min(px(720.)))
                .p_0()
                .close_button(false)
                .overlay_closable(false)
                .on_ok(|_, _, _| false)
                .child(panel.clone())
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
