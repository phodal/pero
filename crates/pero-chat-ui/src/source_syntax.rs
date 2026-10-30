//! Application-owned JSON syntax adapter. Native and Worker analysis use one pure core.
use gpui_kit::{
    component::input::{
        EditorState, FoldRange, HighlightStyleResolver, InputEdit, InputHighlighter,
        InputHighlighterFactory, Rope,
    },
    *,
};
use pero_contracts::{
    content_document::{ContentDocument, ContentFormat},
    content_syntax::ContentSyntax,
};
use std::{cell::RefCell, ops::Range, rc::Rc, sync::Arc};

pub fn configure_source_syntax(
    editor: &mut EditorState,
    document: &ContentDocument,
    _window: &mut Window,
    cx: &mut Context<EditorState>,
) {
    if !matches!(
        document.format,
        ContentFormat::Json | ContentFormat::JsonLines
    ) {
        return;
    }
    let document = document.clone();
    let factory: InputHighlighterFactory = Rc::new(move |language| {
        (language == "json").then(|| {
            Box::new(JsonSyntax {
                document: document.clone(),
                syntax: Rc::default(),
                folding: false,
                task: None,
            }) as Box<dyn InputHighlighter>
        })
    });
    editor.set_highlighter_factory(factory, cx);
}
struct JsonSyntax {
    document: ContentDocument,
    syntax: Rc<RefCell<Arc<ContentSyntax>>>,
    folding: bool,
    task: Option<Task<()>>,
}
impl InputHighlighter for JsonSyntax {
    fn language(&self) -> SharedString {
        "json".into()
    }
    fn update(
        &mut self,
        _edit: Option<InputEdit>,
        text: &Rope,
        folding: bool,
        window: &mut Window,
        cx: &mut Context<EditorState>,
    ) {
        self.task = None;
        self.folding = folding;
        let text = text.to_string();
        let original = text == self.document.source();
        if let Some(syntax) = original.then(|| self.document.cached_syntax()).flatten() {
            *self.syntax.borrow_mut() = syntax;
            return;
        }
        #[cfg(not(target_family = "wasm"))]
        {
            let syntax = ContentSyntax::json(&text);
            *self.syntax.borrow_mut() = if original {
                self.document.share_syntax(syntax)
            } else {
                Arc::new(syntax)
            };
        }
        #[cfg(target_family = "wasm")]
        {
            // Small documents are cheaper than a Worker round trip. Large analysis
            // does not borrow the GPUI thread or its current editor state.
            if text.len() <= 64 * 1024 {
                let syntax = ContentSyntax::json(&text);
                *self.syntax.borrow_mut() = if original {
                    self.document.share_syntax(syntax)
                } else {
                    Arc::new(syntax)
                };
                return;
            }
            let document = self.document.clone();
            let output = self.syntax.clone();
            self.task=Some(cx.spawn_in(window,async move |editor,cx| {
                #[wasm_bindgen::prelude::wasm_bindgen]
                extern "C" {
                    #[wasm_bindgen::prelude::wasm_bindgen(js_namespace=window,js_name=peroAnalyzeJson,catch)]
                    fn analyze_json(text:&str)->Result<js_sys::Promise,wasm_bindgen::JsValue>;
                }
                let result=match analyze_json(&text) {
                    Ok(promise)=>wasm_bindgen_futures::JsFuture::from(promise).await,
                    Err(error)=>Err(error),
                };
                let syntax=result.ok().and_then(|value| {
                    let tape=js_sys::Uint32Array::new(&value).to_vec();
                    ContentSyntax::from_tape(&tape).ok()
                }).unwrap_or_else(||ContentSyntax::json(&text));
                let syntax=if original {document.share_syntax(syntax)}else{Arc::new(syntax)};
                let folds=if folding {syntax.folds.iter().map(|&(start,end)|FoldRange::new(start,end)).collect()}else{Vec::new()};
                *output.borrow_mut()=syntax;
                let _=editor.update(cx,|editor,cx|editor.apply_highlighter_fold_candidates(folds,cx));
            }));
        }
        #[cfg(not(target_family = "wasm"))]
        let _ = (window, cx);
    }
    fn styles(
        &self,
        range: &Range<usize>,
        resolver: &dyn HighlightStyleResolver,
    ) -> Vec<(Range<usize>, HighlightStyle)> {
        let syntax = self.syntax.borrow();
        let mut cursor = range.start;
        let mut styles = Vec::new();
        let first = syntax
            .tokens
            .partition_point(|token| token.bytes.end <= range.start);
        for token in &syntax.tokens[first..] {
            if token.bytes.start >= range.end {
                break;
            }
            let start = token.bytes.start.max(range.start);
            let end = token.bytes.end.min(range.end);
            if cursor < start {
                styles.push((cursor..start, HighlightStyle::default()));
            }
            styles.push((
                start..end,
                resolver.style(token.kind.name()).unwrap_or_default(),
            ));
            cursor = end;
        }
        if cursor < range.end {
            styles.push((cursor..range.end, HighlightStyle::default()));
        }
        styles
    }
    fn fold_ranges(&self, _: &Rope) -> Vec<FoldRange> {
        if self.folding {
            self.syntax
                .borrow()
                .folds
                .iter()
                .map(|&(start, end)| FoldRange::new(start, end))
                .collect()
        } else {
            Vec::new()
        }
    }
}
