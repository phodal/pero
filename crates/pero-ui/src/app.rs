use crate::conversation::{AgentChoice, Conversation};
use crate::theme::Palettes;
use gpui_kit::{
    component::input::{EditorState, InputEvent, InputState},
    *,
};
use pero_contracts::{EchoRequest, HostEvent, MAX_TEXT_CHARS};
use std::{borrow::Cow, cell::RefCell, rc::Rc, sync::Arc};
use wasm_bindgen::prelude::*;

thread_local! {
    static APPLICATION: RefCell<Option<ApplicationHandle>> = const { RefCell::new(None) };
    static WORKBENCH: RefCell<Option<WeakEntity<Workbench>>> = const { RefCell::new(None) };
}

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = window, js_name = peroSendProbe, catch)]
    fn send_probe(json: &str) -> Result<(), JsValue>;
    #[wasm_bindgen(js_namespace = window, js_name = peroSetLocale, catch)]
    fn request_locale(locale: &str) -> Result<(), JsValue>;
    #[wasm_bindgen(js_namespace = window, js_name = peroSessionCommand, catch)]
    pub(crate) fn session_command(json: &str) -> Result<(), JsValue>;
}

pub(crate) struct Workbench {
    pub input: Entity<InputState>,
    pub locale: String,
    pub input_locale: String,
    pub palettes: Palettes,
    pub dark: bool,
    pub navigation: usize,
    pub remote: crate::remote::RemoteState,
    pub tab: usize,
    pub connected: bool,
    pub pending: Option<String>,
    pub next_request: u64,
    pub received: usize,
    pub last_echo: String,
    pub error: Option<String>,
    pub events: Vec<HostEvent>,
    pub composer: Entity<EditorState>,
    pub search: Entity<InputState>,
    pub chats: Vec<Conversation>,
    pub active_chat: Option<usize>,
    pub agents: Vec<AgentChoice>,
    pub agent_index: usize,
    pub agent_menu: bool,
    pub model_menu: bool,
    pub workspace: String,
    pub show_details: bool,
    pub chat_scroll: ScrollHandle,
    pub attachments: Vec<serde_json::Value>,
    pub expanded_tools: std::collections::HashSet<String>,
    _subscriptions: Vec<Subscription>,
}

impl Workbench {
    fn new(
        palettes: Palettes,
        dark: bool,
        locale: String,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let input = cx.new(|cx| {
            InputState::new(window, cx)
                .placeholder(pero_contracts::i18n::text(&locale, "input.placeholder"))
        });
        let subscriptions = vec![cx.subscribe_in(&input, window, |this, _, event, _, cx| {
            if matches!(event, InputEvent::PressEnter { .. }) {
                this.send(cx);
            }
            cx.notify();
        })];
        let composer = cx.new(|cx| {
            EditorState::new(window, cx)
                .line_number(false)
                .soft_wrap(true)
                .placeholder(pero_contracts::i18n::text(&locale, "chat.placeholder"))
        });
        let search = cx.new(|cx| {
            InputState::new(window, cx)
                .placeholder(pero_contracts::i18n::text(&locale, "sessions.search"))
        });
        let mut subscriptions = subscriptions;
        subscriptions.push(
            cx.subscribe_in(&composer, window, |this, _, event, window, cx| {
                if matches!(event, InputEvent::PressEnter { shift: false, .. }) {
                    this.send_chat(window, cx);
                }
                cx.notify();
            }),
        );
        subscriptions.push(cx.subscribe(&search, |_, _, _: &InputEvent, cx| cx.notify()));
        let remote = crate::remote::RemoteState::new(window, cx);
        Self {
            remote,
            input,
            input_locale: locale.clone(),
            locale,
            palettes,
            dark,
            navigation: 3,
            tab: 4,
            connected: false,
            pending: None,
            next_request: 0,
            received: 0,
            last_echo: String::new(),
            error: None,
            events: Vec::new(),
            composer,
            search,
            chats: vec![],
            active_chat: None,
            agents: vec![],
            agent_index: 0,
            agent_menu: false,
            model_menu: false,
            workspace: String::new(),
            show_details: false,
            chat_scroll: ScrollHandle::new(),
            attachments: vec![],
            expanded_tools: Default::default(),
            _subscriptions: subscriptions,
        }
    }

    pub fn send(&mut self, cx: &mut Context<Self>) {
        let text = self.input.read(cx).value().to_string();
        if !self.connected || self.pending.is_some() {
            return;
        }
        if text.trim().is_empty() || text.chars().count() > MAX_TEXT_CHARS {
            self.error = Some("error.input_length".into());
            cx.notify();
            return;
        }
        self.next_request += 1;
        let id = format!("probe-{}", self.next_request);
        let request = EchoRequest {
            id: id.clone(),
            text,
        };
        self.error = None;
        self.pending = Some(id);
        if send_probe(&serde_json::to_string(&request).expect("serializable request")).is_err() {
            self.error = Some("error.send".into());
            self.pending = None;
        }
        cx.notify();
    }

    fn receive(&mut self, event: HostEvent, cx: &mut Context<Self>) {
        if self.receive_remote(&event, cx) {
            return;
        }
        if self.receive_chat(&event, cx) {
            return;
        }
        match event.kind.as_str() {
            "settings" => {
                self.locale = pero_contracts::i18n::normalize(&event.text).into();
                gpui_kit::component::set_locale(&self.locale);
            }
            "ready" => self.connected = true,
            "disconnected" => {
                self.connected = false;
                self.pending = None;
                for chat in &mut self.chats {
                    chat.pending_model = None;
                }
                self.error = Some(event.message_key.clone().unwrap_or_else(|| {
                    if event.text.is_empty() {
                        "error.connection".into()
                    } else {
                        event.text.clone()
                    }
                }));
            }
            "error" => {
                self.error = Some(event.message_key.clone().unwrap_or_else(|| {
                    if event.text.is_empty() {
                        "error.connection".into()
                    } else {
                        event.text.clone()
                    }
                }));
                if event.request_id == self.pending {
                    self.pending = None;
                }
            }
            "echo" if event.request_id == self.pending => {
                self.pending = None;
                self.received += 1;
                self.last_echo = event.text.clone();
            }
            _ => {}
        }
        self.events.push(event);
        if self.events.len() > 100 {
            self.events.remove(0);
        }
        cx.notify();
    }
    pub fn t(&self, key: &str) -> &'static str {
        pero_contracts::i18n::text(&self.locale, key)
    }
    pub fn event_text(&self, event: &HostEvent) -> String {
        event
            .message_key
            .as_deref()
            .map(|key| self.t(key).to_string())
            .unwrap_or_else(|| event.text.clone())
    }
    pub fn toggle_locale(&mut self, cx: &mut Context<Self>) {
        if request_locale(if self.locale == "en" { "zh-CN" } else { "en" }).is_err() {
            self.error = Some("error.settings".into());
            cx.notify();
        }
    }
}

#[wasm_bindgen]
pub fn run(theme_json: &str, dark: bool, locale: &str) -> Result<(), JsValue> {
    let locale = pero_contracts::i18n::normalize(locale).to_string();
    console_error_panic_hook::set_once();
    let palettes: Palettes =
        serde_json::from_str(theme_json).map_err(|e| JsValue::from_str(&e.to_string()))?;
    gpui_kit::platform::web_init();
    use gpui_kit::web::{CanvasFontFallback, WebBackendPreference, WebPlatform};
    let platform = Rc::new(WebPlatform::new_with_backend_and_font_fallback(
        false,
        WebBackendPreference::Auto,
        CanvasFontFallback::EmojiAndCjk,
    ));
    let http = Arc::new(platform.fetch_http_client());
    let handle = Application::with_platform(platform)
        .with_assets(crate::assets::UiAssets)
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
                        include_bytes!("../../../web/public/fonts/NotoSansSC-Bold.ttf").as_slice(),
                    ),
                    Cow::Borrowed(
                        include_bytes!("../../../web/public/fonts/IBMPlexSans-Regular.ttf")
                            .as_slice(),
                    ),
                    Cow::Borrowed(
                        include_bytes!("../../../web/public/fonts/NotoSansSC-Regular.ttf")
                            .as_slice(),
                    ),
                    Cow::Borrowed(
                        include_bytes!("../../../web/public/fonts/JetBrainsMono-Regular.ttf")
                            .as_slice(),
                    ),
                ])
                .expect("bundled fonts");
            gpui_kit::init(cx);
            gpui_kit::component::set_locale(&locale);
            palettes.apply(dark, cx);
            gpui_kit::open_window(WindowOptions::default(), cx, |window, cx| {
                let view = cx.new(|cx| Workbench::new(palettes, dark, locale, window, cx));
                WORKBENCH.with(|slot| *slot.borrow_mut() = Some(view.downgrade()));
                view
            })
            .expect("workbench window");
        });
    APPLICATION.with(|slot| *slot.borrow_mut() = Some(handle));
    Ok(())
}

#[wasm_bindgen]
pub fn receive_host_event(json: &str) -> Result<(), JsValue> {
    let event: HostEvent =
        serde_json::from_str(json).map_err(|e| JsValue::from_str(&e.to_string()))?;
    if event.version != pero_contracts::PROTOCOL_VERSION {
        return Err(JsValue::from_str("Unsupported event version"));
    }
    update(|ui, cx| ui.receive(event, cx));
    Ok(())
}

fn update(f: impl FnOnce(&mut Workbench, &mut Context<Workbench>)) {
    APPLICATION.with(|app| {
        if let Some(app) = app.borrow().as_ref() {
            app.update(|cx| {
                WORKBENCH.with(|view| {
                    if let Some(view) = view.borrow().as_ref() {
                        let _ = view.update(cx, f);
                    }
                })
            });
        }
    });
}

/// Read-only diagnostic state. Tests still enter text through Chromium input.
#[wasm_bindgen]
pub fn snapshot() -> String {
    let mut value = serde_json::json!({"ready": false});
    update(|ui, cx| {
        value = serde_json::json!({
            "ready": true, "remote": ui.remote.snapshot(cx), "connected": ui.connected, "input": ui.input.read(cx).value().as_ref(),
            "received": ui.received, "lastEcho": ui.last_echo, "pending": ui.pending,
            "error": ui.error, "dark": ui.dark, "navigation": ui.navigation,
            "locale": ui.locale, "labels": { "tasks": ui.t("nav.tasks"), "send": ui.t("probe.send") },
            "tab": ui.tab, "events": ui.events,
            "chats": ui.chats, "activeChat": ui.active_chat, "agents": ui.agents,
            "composer": ui.composer.read(cx).value().as_ref(),"workspace":ui.workspace,
            "attachments": ui.attachments.iter().filter_map(|file|file["name"].as_str()).collect::<Vec<_>>(),
            "expandedTools":ui.expanded_tools,
            "modelMenu":ui.model_menu,
            "toolViews":ui.chats.iter().map(|chat|chat.tools.iter().filter(|tool|tool.view.is_some()).count()).collect::<Vec<_>>(),
            "scroll": {"y":f32::from(ui.chat_scroll.offset().y),"max":f32::from(ui.chat_scroll.max_offset().y)},
            "renderStats":ui.chats.iter().map(|c|c.messages.iter().map(|m|m.view.read(cx).stats()).collect::<Vec<_>>()).collect::<Vec<_>>(),
            "renderedBytes":ui.chats.iter().map(|c|c.messages.iter().map(|m|m.view.read(cx).rendered_bytes(cx)).collect::<Vec<_>>()).collect::<Vec<_>>(),
        })
    });
    value.to_string()
}
