use gpui_kit::{
    component::{
        button::*,
        menu::{DropdownMenu, PopupMenuItem},
        *,
    },
    prelude::*,
    *,
};
use pero_chat_ui::{ChatAction, ChatPanel, assets::UiAssets, theme::Palettes};
use pero_contracts::HostEvent;
use serde_json::json;
use std::{borrow::Cow, cell::RefCell, rc::Rc, sync::Arc};
use wasm_bindgen::prelude::*;

thread_local! {
    static APPLICATION: RefCell<Option<ApplicationHandle>> = const { RefCell::new(None) };
    static CHAT: RefCell<Option<WeakEntity<ChatWindow>>> = const { RefCell::new(None) };
}

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = window, js_name = peroSessionCommand, catch)]
    fn command(json: &str) -> Result<(), JsValue>;
}

struct ChatWindow {
    panel: Entity<ChatPanel>,
    palettes: Palettes,
    preferences: pero_contracts::workbench::WorkbenchPreferences,
    system_dark: bool,
    _subscriptions: Vec<Subscription>,
}

impl ChatWindow {
    fn new(
        palettes: Palettes,
        dark: bool,
        locale: String,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let panel = cx.new(|cx| ChatPanel::new(locale, window, cx));
        let subscriptions = vec![
            cx.subscribe(&panel, |this, _, action, cx| {
                let value = match action {
                    ChatAction::Command(value) => {
                        serde_json::to_value(value).expect("typed Host command")
                    }
                    ChatAction::PreviewContext{reference,thread_id}=>json!({"action":"app_context_preview","reference":reference,"thread_id":thread_id}),
                    ChatAction::Selected{thread_id}=>json!({"action":"app_use_selection","thread_id":thread_id}),
                    ChatAction::Content(intent) => serde_json::to_value(intent).expect("content intent"),
                    ChatAction::ChooseWorkspace => json!({"action":"choose_workspace"}),
                    ChatAction::ChooseContext { kind, request_id } => {
                        json!({"action":"choose_context","kind":kind,"request_id":request_id})
                    }
                    ChatAction::Activated | ChatAction::ReturnToReview => {
                        cx.notify();
                        return;
                    }
                };
                if command(&value.to_string()).is_err() {
                    this.panel.update(cx, |panel, cx| {
                        panel.error = Some("error.connection".into());
                        cx.notify();
                    });
                }
            }),
            cx.observe(&panel, |_, _, cx| cx.notify()),
        ];
        Self {
            panel,
            palettes,
            preferences: Default::default(),
            system_dark: dark,
            _subscriptions: subscriptions,
        }
    }
}

impl Render for ChatWindow {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let panel = self.panel.read(cx);
        let palette = &pero_theme::UiAppearance::global(cx).palette.clone();
        let active = panel.active_chat;
        let label = active
            .and_then(|i| panel.chats.get(i))
            .map(|chat| chat.title.display().to_owned())
            .unwrap_or_else(|| panel.t("chat.new").into());
        let threads = panel
            .chats
            .iter()
            .enumerate()
            .filter(|(_, c)| c.scope == panel.scope)
            .map(|(i, c)| (i, c.title.display().to_owned()))
            .collect::<Vec<_>>();
        let choose = self.panel.downgrade();
        let new = self.panel.clone();
        div()
            .size_full()
            .flex()
            .flex_col()
            .bg(palette.surface)
            .text_color(palette.text)
            .text_size(pero_theme::UiAppearance::global(cx).text(pero_theme::TextRole::Body))
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(4.))
                    .px(px(12.))
                    .py(px(6.))
                    .border_b_1()
                    .border_color(palette.border)
                    .child(
                        Button::new("chat-session-picker")
                            .ghost()
                            .small()
                            .label(label)
                            .dropdown_caret(true)
                            .disabled(threads.is_empty())
                            .max_w(px(320.))
                            .dropdown_menu(move |menu, _, _| {
                                threads.iter().fold(menu, |menu, (index, title)| {
                                    let index = *index;
                                    let panel = choose.clone();
                                    menu.item(
                                        PopupMenuItem::new(title.clone())
                                            .checked(active == Some(index))
                                            .on_click(move |_, _, cx| {
                                                let _ = panel.update(cx, |panel, cx| {
                                                    panel.focus_chat(Some(index), cx)
                                                });
                                            }),
                                    )
                                })
                            }),
                    )
                    .child(div().flex_1())
                    .child(
                        Button::new("chat-new-session")
                            .ghost()
                            .small()
                            .icon(IconName::Plus)
                            .label(panel.t("chat.new"))
                            .on_click(move |_, _, cx| {
                                new.update(cx, |panel, cx| panel.new_chat(cx))
                            }),
                    ),
            )
            .child(self.panel.clone())
    }
}

#[wasm_bindgen]
pub fn run(theme_json: &str, dark: bool, locale: &str) -> Result<(), JsValue> {
    console_error_panic_hook::set_once();
    let palettes: Palettes =
        serde_json::from_str(theme_json).map_err(|e| JsValue::from_str(&e.to_string()))?;
    let locale = pero_contracts::i18n::normalize(locale).to_string();
    gpui_kit::platform::web_init();
    use gpui_kit::web::{CanvasFontFallback, WebBackendPreference, WebPlatform};
    let platform = Rc::new(WebPlatform::new_with_backend_and_font_fallback(
        false,
        WebBackendPreference::Auto,
        CanvasFontFallback::EmojiAndCjk,
    ));
    let http = Arc::new(platform.fetch_http_client());
    let handle = Application::with_platform(platform)
        .with_assets(UiAssets)
        .with_http_client(http)
        .run_embedded(move |cx| {
            cx.text_system()
                .add_fonts(vec![
                    Cow::Borrowed(
                        include_bytes!("../../../web/public/fonts/Inter-Regular.ttf").as_slice(),
                    ),
                    Cow::Borrowed(
                        include_bytes!("../../../web/public/fonts/Workbench-regular.ttf")
                            .as_slice(),
                    ),
                    Cow::Borrowed(
                        include_bytes!("../../../web/public/fonts/Workbench-bold.ttf").as_slice(),
                    ),
                    Cow::Borrowed(
                        include_bytes!("../../../web/public/fonts/IBMPlexSans-Regular.ttf")
                            .as_slice(),
                    ),
                    Cow::Borrowed(
                        include_bytes!("../../../web/public/fonts/JetBrainsMono-Regular.ttf")
                            .as_slice(),
                    ),
                ])
                .expect("bundled fonts");
            gpui_kit::init(cx);
            if cx.platform_info().is_mac() {
                use gpui_kit::component::input::{
                    Copy, Cut, DeleteToBeginningOfLine, DeleteToEndOfLine, MoveEnd, MoveHome,
                    Paste, Redo, SelectAll, Undo,
                };
                cx.bind_keys([
                    KeyBinding::new("cmd-a", SelectAll, Some("Input")),
                    KeyBinding::new("cmd-c", Copy, Some("Input")),
                    KeyBinding::new("cmd-x", Cut, Some("Input")),
                    KeyBinding::new("cmd-v", Paste, Some("Input")),
                    KeyBinding::new("cmd-z", Undo, Some("Input")),
                    KeyBinding::new("cmd-shift-z", Redo, Some("Input")),
                    KeyBinding::new("cmd-left", MoveHome, Some("Input")),
                    KeyBinding::new("cmd-right", MoveEnd, Some("Input")),
                    KeyBinding::new("cmd-backspace", DeleteToBeginningOfLine, Some("Input")),
                    KeyBinding::new("cmd-delete", DeleteToEndOfLine, Some("Input")),
                ]);
            }
            gpui_kit::component::set_locale(&locale);
            pero_theme::ResolvedAppearance::resolve(&Default::default(), dark, &palettes).install(cx);
            gpui_kit::open_window(WindowOptions::default(), cx, |window, cx| {
                let view = cx.new(|cx| ChatWindow::new(palettes, dark, locale, window, cx));
                CHAT.with(|slot| *slot.borrow_mut() = Some(view.downgrade()));
                view
            })
            .expect("chat window");
        });
    APPLICATION.with(|slot| *slot.borrow_mut() = Some(handle));
    Ok(())
}

fn update(f: impl FnOnce(&mut ChatWindow, &mut Context<ChatWindow>)) {
    APPLICATION.with(|app| {
        if let Some(app) = app.borrow().as_ref() {
            app.update(|cx| {
                CHAT.with(|view| {
                    if let Some(view) = view.borrow().as_ref() {
                        let _ = view.update(cx, f);
                    }
                });
            });
        }
    });
}

#[wasm_bindgen]
pub fn receive_host_event(json: &str) -> Result<(), JsValue> {
    let event: HostEvent =
        serde_json::from_str(json).map_err(|e| JsValue::from_str(&e.to_string()))?;
    if event.version != pero_contracts::PROTOCOL_VERSION {
        return Err(JsValue::from_str("Unsupported event version"));
    }
    update(|ui, cx| {
        if event.kind == "workbench_settings" {
            if let Ok(preferences) = serde_json::from_value(event.data.clone()) {
                ui.preferences = preferences;
                pero_theme::ResolvedAppearance::resolve(&ui.preferences, ui.system_dark, &ui.palettes).install(cx);
            }
        }
        ui.panel.update(cx, |panel, cx| {
            panel.receive(&event, cx);
        })
    });
    Ok(())
}

#[wasm_bindgen]
pub fn snapshot() -> String {
    let mut value = json!({"ready":false});
    update(|ui, cx| {
        value = ui.panel.read(cx).snapshot(cx);
        value["ready"] = true.into();
        value["appearance"] = serde_json::to_value(pero_theme::UiAppearance::global(cx)).expect("serializable appearance");
    });
    value.to_string()
}

#[wasm_bindgen]
pub fn paste_image(data: &str, mime_type: &str) {
    update(|ui, cx| {
        ui.panel.update(cx, |panel, cx| {
            panel.queue_composer_image(data.into(), mime_type.into(), cx)
        })
    });
}

#[wasm_bindgen]
pub fn set_system_theme(dark: bool) {
    update(|ui, cx| {
        ui.system_dark = dark;
        pero_theme::ResolvedAppearance::resolve(&ui.preferences, dark, &ui.palettes).install(cx);
        ui.panel.update(cx, |panel, cx| {
            let locale = panel.locale.clone();
            panel.set_locale(&locale, cx);
        })
    });
}

#[wasm_bindgen]
pub fn compose(text: &str) {
    update(|ui, cx| {
        ui.panel.update(cx, |panel, cx| {
            panel.compose(text.into(), cx);
        })
    });
}

#[wasm_bindgen]
pub fn set_appearance(json: &str) -> Result<(), JsValue> {
    let appearance: pero_theme::ResolvedAppearance = serde_json::from_str(json)
        .map_err(|error|JsValue::from_str(&error.to_string()))?;
    update(|_,cx| appearance.install(cx));
    Ok(())
}
