use gpui_kit::{prelude::*, *};
use pero_chat_ui::{
    assets::UiAssets,
    content_reader::{ContentReader, ReaderAction},
};
use pero_contracts::{content_document::DocumentHeader, content_origin::ContentOrigin};
use pero_theme::{Palettes, ResolvedAppearance, UiAppearance};
use serde::Deserialize;
use serde_json::json;
use std::{cell::RefCell, rc::Rc, sync::Arc};
use wasm_bindgen::prelude::*;

thread_local! {
    static APPLICATION: RefCell<Option<ApplicationHandle>> = const { RefCell::new(None) };
    static READER: RefCell<Option<WeakEntity<ReaderWindow>>> = const { RefCell::new(None) };
}

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = window, js_name = peroReaderOpenLink)]
    fn open_link(value: &str);
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Reading {
    header: DocumentHeader,
    text: String,
    #[serde(default)]
    location: Option<pero_contracts::content_location::ReaderLocation>,
}

struct ReaderWindow {
    reader: Option<Entity<ContentReader>>,
    chart: Option<crate::chart::Chart>,
    subscriptions: Vec<Subscription>,
    locale: String,
    palettes: Palettes,
    window: AnyWindowHandle,
}
impl Render for ReaderWindow {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let appearance = UiAppearance::global(cx);
        div()
            .size_full()
            .flex()
            .flex_col()
            .overflow_hidden()
            .bg(appearance.palette.surface)
            .text_color(appearance.palette.text)
            .text_size(appearance.text(pero_theme::TextRole::Body))
            .when_some(self.chart.as_ref(), |this, chart| {
                this.child(div().size_full().p_3().child(chart.render(cx)))
            })
            .children(self.reader.clone())
    }
}

#[wasm_bindgen]
pub fn run(theme_json: &str, dark: bool, locale: &str) -> Result<(), JsValue> {
    console_error_panic_hook::set_once();
    if APPLICATION.with(|slot| slot.borrow().is_some()) {
        return Err(JsValue::from_str("Reader is already running"));
    }
    let palettes: Palettes =
        serde_json::from_str(theme_json).map_err(|error| JsValue::from_str(&error.to_string()))?;
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
            pero_chat_ui::web_platform::initialize(cx);
            gpui_kit::component::set_locale(&locale);
            ResolvedAppearance::resolve(&Default::default(), dark, &palettes).install(cx);
            gpui_kit::open_window(WindowOptions::default(), cx, |window, cx| {
                let view = cx.new(|_| ReaderWindow {
                    reader: None,
                    chart: None,
                    subscriptions: vec![],
                    locale,
                    palettes,
                    window: window.window_handle(),
                });
                READER.with(|slot| *slot.borrow_mut() = Some(view.downgrade()));
                view
            })
            .expect("reader window");
        });
    APPLICATION.with(|slot| *slot.borrow_mut() = Some(handle));
    Ok(())
}

fn update(f: impl FnOnce(&mut ReaderWindow, &mut Context<ReaderWindow>)) {
    APPLICATION.with(|app| {
        if let Some(app) = app.borrow().as_ref() {
            app.update(|cx| {
                READER.with(|view| {
                    if let Some(view) = view.borrow().as_ref() {
                        let _ = view.update(cx, f);
                    }
                })
            });
        }
    });
}

#[wasm_bindgen]
pub fn receive_document(value: &str) -> Result<(), JsValue> {
    let reading: Reading =
        serde_json::from_str(value).map_err(|error| JsValue::from_str(&error.to_string()))?;
    if !matches!(reading.header.source.origin, ContentOrigin::App { .. }) {
        return Err(JsValue::from_str(
            "The embedded reader accepts App documents only",
        ));
    }
    let document = reading.header.into_document(reading.text);
    let location = reading.location;
    update(|ui, cx| {
        let view = cx.entity().downgrade();
        let locale = ui.locale.clone();
        let window = ui.window;
        cx.defer(move |cx| {
            let _ = window.update(cx, |_, window, cx| {
                let reader = cx.new(|cx| {
                    let mut reader =
                        ContentReader::new(document, locale, window, cx).workspace(window, cx);
                    if let Some(location) = location {
                        reader.reveal_record(location.record as usize, window, cx);
                    }
                    reader
                });
                let _ = view.update(cx, |ui, cx| {
                    ui.subscriptions = vec![
                        cx.observe(&reader, |_, _, cx| cx.notify()),
                        cx.subscribe(&reader, |_, _, action, _| {
                            if let ReaderAction::Link(value) = action {
                                open_link(value);
                            }
                        }),
                    ];
                    ui.chart = None;
                    ui.reader = Some(reader);
                    cx.notify();
                });
            });
        });
    });
    Ok(())
}

#[wasm_bindgen]
pub fn receive_chart(value: &str) -> Result<(), JsValue> {
    let chart = crate::chart::Chart::parse(value).map_err(|error| JsValue::from_str(&error))?;
    update(|ui, cx| {
        ui.reader = None;
        ui.chart = Some(chart);
        cx.notify();
    });
    Ok(())
}

#[wasm_bindgen]
pub fn set_context(dark: bool, locale: &str, value: &str) -> Result<(), JsValue> {
    let appearance: Option<ResolvedAppearance> = if value.is_empty() {
        None
    } else {
        Some(serde_json::from_str(value).map_err(|error| JsValue::from_str(&error.to_string()))?)
    };
    update(|ui, cx| {
        ui.locale = pero_contracts::i18n::normalize(locale).to_string();
        gpui_kit::component::set_locale(&ui.locale);
        appearance
            .unwrap_or_else(|| ResolvedAppearance::resolve(&Default::default(), dark, &ui.palettes))
            .install(cx);
        if let Some(reader) = &ui.reader {
            reader.update(cx, |reader, cx| {
                reader.locale = ui.locale.clone();
                cx.notify();
            });
        }
        cx.notify();
    });
    Ok(())
}

#[wasm_bindgen]
pub fn snapshot() -> String {
    let mut value = json!({"ready":false});
    update(|ui, cx| {
        value = json!({"ready":true,"reader":ui.reader.as_ref().map(|reader|reader.read(cx).snapshot(cx)),
            "appearance":UiAppearance::global(cx)});
    });
    value.to_string()
}

#[wasm_bindgen]
pub fn set_icon_theme(value: &str) -> Result<(), JsValue> {
    use pero_contracts::icon_theme::{IconTheme, IconThemeInfo, IconThemeState};
    // A bare App is its own parent. Admit its vectors here before they enter
    // GPUI assets, using exactly the same importer as installed Desktop themes.
    let state = if value == "null" {
        IconThemeState::default()
    } else {
        let theme = IconTheme::parse(value).map_err(|error| JsValue::from_str(&error))?;
        IconThemeState {
            selected: Some(theme.id.clone()),
            installed: vec![IconThemeInfo {
                id: theme.id.clone(),
                name: theme.name.clone(),
            }],
            theme: Some(theme),
        }
    };
    pero_chat_ui::icon_theme::install(state);
    update(|_, cx| cx.notify());
    Ok(())
}
