//! Browser edit buffers share the mirror protocol without sharing DOM layout.
use wasm_bindgen::prelude::*;

#[wasm_bindgen(module = "/src/input_conduit.js")]
extern "C" {
    #[wasm_bindgen(extends = web_sys::HtmlElement, extends = web_sys::Element, extends = web_sys::Node, extends = web_sys::EventTarget)]
    pub(crate) type InputConduit;
    #[wasm_bindgen(constructor, catch)]
    pub(crate) fn new(document: &web_sys::Document, touch: bool) -> Result<InputConduit, JsValue>;
    #[wasm_bindgen(method, getter)]
    pub(crate) fn value(this: &InputConduit) -> String;
    #[wasm_bindgen(method, setter, js_name = value)]
    pub(crate) fn set_value(this: &InputConduit, text: &str);
    #[wasm_bindgen(method, getter, catch, js_name = selectionStart)]
    pub(crate) fn selection_start(this: &InputConduit) -> Result<Option<u32>, JsValue>;
    #[wasm_bindgen(method, getter, catch, js_name = selectionEnd)]
    pub(crate) fn selection_end(this: &InputConduit) -> Result<Option<u32>, JsValue>;
    #[wasm_bindgen(method, setter, js_name = readOnly)]
    pub(crate) fn set_read_only(this: &InputConduit, read_only: bool);
    #[wasm_bindgen(method, setter, js_name = wrap)]
    pub(crate) fn set_wrap(this: &InputConduit, wrap: &str);
    #[wasm_bindgen(method, catch, js_name = setSelectionRange)]
    pub(crate) fn set_selection_range(
        this: &InputConduit,
        start: u32,
        end: u32,
    ) -> Result<(), JsValue>;
    #[wasm_bindgen(method, js_name = updateControlBounds)]
    pub(crate) fn update_control_bounds(
        this: &InputConduit,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
    );
    #[wasm_bindgen(method, js_name = updateCharacterBounds)]
    pub(crate) fn update_character_bounds(this: &InputConduit, start: u32, bounds: &js_sys::Array);
    #[wasm_bindgen(method)]
    pub(crate) fn dispose(this: &InputConduit);
}
