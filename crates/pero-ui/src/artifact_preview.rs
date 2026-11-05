use crate::app::Workbench;
use gpui_kit::*;
#[wasm_bindgen::prelude::wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = window, js_name = peroArtifactSurface, catch)]
    fn artifact_surface(json:&str)->Result<(),wasm_bindgen::JsValue>;
}
impl Workbench {
    pub(crate) fn sync_artifact_preview(&mut self, _cx:&mut Context<Self>) {
        if !self.chat_visible() {let _=artifact_surface("{\"visible\":false}");}
    }
}
