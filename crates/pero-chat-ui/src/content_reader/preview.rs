//! Large immutable JSON previews parse outside the GPUI/Wasm thread.
use super::*;
#[cfg(target_family = "wasm")]
use wasm_bindgen::JsCast as _;

impl ContentReader {
    pub(super) fn refresh_projection(
        &mut self,
        debounce: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.preview_task = None;
        self.preview_loading = false;
        if let Some(range) = self
            .path
            .last()
            .filter(|range| **range != (0..self.preview_document.bytes))
            .cloned()
        {
            self.preview = self.preview_document.shared_project(range);
            self.sync_table(window, cx);
            return;
        }
        #[cfg(target_family = "wasm")]
        if self.preview_document.bytes > 64 * 1024
            && matches!(
                self.preview_document.format,
                ContentFormat::Json | ContentFormat::JsonLines
            )
        {
            if let Some(preview) = self.preview_document.cached_preview() {
                self.preview = preview;
                self.sync_table(window, cx);
                return;
            }
            self.preview_loading = true;
            self.preview = Err(String::new());
            let document = self.preview_document.clone();
            self.preview_task = Some(cx.spawn_in(window, async move |reader, cx| {
                if debounce {
                    cx.background_executor().timer(std::time::Duration::from_millis(200)).await;
                }
                #[wasm_bindgen::prelude::wasm_bindgen]
                extern "C" {
                    #[wasm_bindgen::prelude::wasm_bindgen(js_namespace=window,js_name=peroAnalyzePreview,catch)]
                    fn analyze_preview(text: &str, json_lines: bool, revision: u64) -> Result<js_sys::Promise, wasm_bindgen::JsValue>;
                }
                let result = match analyze_preview(
                    document.source(),
                    document.format == ContentFormat::JsonLines,
                    document.revision,
                ) {
                    Ok(promise) => wasm_bindgen_futures::JsFuture::from(promise).await,
                    Err(error) => Err(error),
                };
                let preview = result.map_err(|error| {
                    error.as_string().or_else(|| error.dyn_ref::<js_sys::Error>().map(|error| String::from(error.message())))
                        .unwrap_or_else(|| "Preview analysis failed".to_owned())
                }).and_then(|value| StructuredPreview::from_tape(&js_sys::Uint32Array::new(&value).to_vec()));
                let _ = reader.update_in(cx, |reader, window, cx| {
                    if !reader.preview_document.shares_source(&document)
                        || reader.preview_document.revision != document.revision
                        || reader.preview_document.format != document.format
                    {
                        return;
                    }
                    reader.preview = document.share_preview(preview);
                    reader.preview_loading = false;
                    reader.sync_table(window, cx);
                    cx.notify();
                });
            }));
            return;
        }
        #[cfg(not(target_family = "wasm"))]
        let _ = debounce;
        self.preview = self.preview_document.shared_preview();
        self.sync_table(window, cx);
    }
}
