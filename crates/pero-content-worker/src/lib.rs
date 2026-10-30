//! Pure content analysis entry point, loaded inside a browser Worker.
#[cfg(target_family = "wasm")]
#[wasm_bindgen::prelude::wasm_bindgen]
pub fn analyze_json(source: &str) -> Vec<u32> {
    pero_contracts::content_syntax::ContentSyntax::json(source).into_tape()
}
