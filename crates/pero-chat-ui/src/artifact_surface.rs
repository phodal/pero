//! Scientific Viewer owns rich rendering; Chat owns selection and the original composer.
use crate::{
    conversation::{Conversation, StreamItem},
    panel::{ChatAction, ChatPanel},
    session_artifacts::ArtifactCollection,
};
#[cfg(target_family = "wasm")]
use gpui_kit::base::ElementExt;
use gpui_kit::{prelude::*, *};
use pero_contracts::session_artifact::{ArtifactBrowserState, ArtifactPreviewTarget};

#[cfg(target_family = "wasm")]
#[wasm_bindgen::prelude::wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = window, js_name = peroArtifactSurface, catch)]
    fn publish_surface(json: &str) -> Result<(), wasm_bindgen::JsValue>;
}

impl ChatPanel {
    pub fn set_artifact_surface_covered(&mut self, covered: bool, cx: &mut Context<Self>) {
        if self.artifacts.surface_covered != covered {
            self.artifacts.surface_covered = covered;
            cx.notify();
        }
    }
    pub fn artifact_surface_covered(&self) -> bool {
        self.artifacts.surface_covered
    }
    pub fn artifact_preview_target(&self) -> Option<ArtifactPreviewTarget> {
        if self.files.selection.tab == pero_contracts::workbench::ResourceTab::Files {
            return None;
        }
        let chat = self.chats.get(self.active_chat?)?;
        let thread = &chat.id;
        let state = self.artifacts.conversations.get(thread)?;
        if (!state.open && !state.inline_open) || state.show_changes {
            return None;
        }
        let (id, version) = state.selected.as_ref()?;
        Some(ArtifactPreviewTarget {
            thread_id: thread.clone(),
            artifact_id: id.clone(),
            version: *version,
        })
    }

    #[cfg(not(target_family = "wasm"))]
    pub fn set_artifact_preview_view(
        &mut self,
        view: Option<(String, AnyView)>,
        cx: &mut Context<Self>,
    ) {
        self.artifacts.native_preview = view;
        cx.notify();
    }

    pub fn artifact_target_available(&self, target: &ArtifactPreviewTarget) -> bool {
        self.active_chat
            .and_then(|index| self.chats.get(index))
            .is_some_and(|chat| chat.id == target.thread_id)
            && self
                .artifacts
                .conversations
                .get(&target.thread_id)
                .is_some_and(|state| {
                    (state.open || state.inline_open)
                        && state.items.iter().any(|item| {
                            item.id == target.artifact_id
                                && item
                                    .versions
                                    .iter()
                                    .any(|version| version.version == target.version)
                        })
                })
    }

    pub fn artifact_browser_state(&self) -> Option<ArtifactBrowserState> {
        let chat = self.chats.get(self.active_chat?)?;
        let thread = &chat.id;
        let state = self.artifacts.conversations.get(thread)?;
        if self.files.selection.tab == pero_contracts::workbench::ResourceTab::Files
            || (!state.open && !state.inline_open)
            || (!state.inline_open && state.chart.is_some() && !state.chart_source_open)
        {
            return None;
        }
        let selected = self.artifact_preview_target();
        let source_message = selected.as_ref().and_then(|target| {
            let source = self.artifact_source_key(thread, &target.artifact_id, target.version)?;
            artifact_source_message(chat, &source)
        });
        Some(ArtifactBrowserState {
            thread_id: thread.clone(),
            artifacts: state.items.clone(),
            selected,
            view: self.artifacts.view,
            preview_request: state.preview_request,
            inline: state.inline_open && !state.open,
            source_message,
            shell_document_bar: !state.inline_open && self.artifacts.view
                == pero_contracts::workbench::ArtifactView::Gallery,
        })
    }

    pub(crate) fn sync_artifact_preview_target(&mut self, cx: &mut Context<Self>) {
        let browser = self.artifact_browser_state();
        if self.artifacts.preview_requested != browser {
            self.artifacts.preview_requested = browser.clone();
            cx.emit(ChatAction::ArtifactPreview(browser.clone()));
        }
        #[cfg(target_family = "wasm")]
        if browser.is_none() {
            let _ = publish_surface("{\"visible\":false}");
        }
    }

    pub(crate) fn artifact_preview_surface(
        &self,
        _thread: &str,
        _state: &ArtifactCollection,
        _cx: &mut Context<Self>,
    ) -> AnyElement {
        #[cfg(target_family = "wasm")]
        let Some(browser) = self.artifact_browser_state() else {
            return div().into_any_element();
        };
        #[cfg(not(target_family = "wasm"))]
        {
            if let Some((current, view)) = &self.artifacts.native_preview {
                if current == _thread {
                    return div()
                        .flex_1()
                        .min_h_0()
                        .min_w_0()
                        .child(view.clone())
                        .into_any_element();
                }
            }
            div()
                .flex_1()
                .p(px(12.))
                .child(self.t("artifacts.loading"))
                .into_any_element()
        }
        #[cfg(target_family = "wasm")]
        {
            if self.artifacts.surface_covered {
                let _ = publish_surface("{\"visible\":false}");
                return div().into_any_element();
            }
            let appearance = pero_theme::UiAppearance::global(_cx).clone();
            let locale = self.locale.clone();
            div().flex_1().min_h_0().min_w_0().on_prepaint(move |bounds, window, _| {
                let mask = bounds.intersect(&window.content_mask().bounds);
                let clip = [
                    f32::from(mask.top() - bounds.top()), f32::from(bounds.right() - mask.right()),
                    f32::from(bounds.bottom() - mask.bottom()), f32::from(mask.left() - bounds.left()),
                ].map(|inset| inset.max(0.));
                let payload = serde_json::json!({"visible":mask.size.width > px(0.) && mask.size.height > px(0.),"browser":browser,"left":f32::from(bounds.origin.x),"top":f32::from(bounds.origin.y),"width":f32::from(bounds.size.width),"height":f32::from(bounds.size.height),"clip":clip,"dark":appearance.dark,"appearance":appearance,"locale":locale});
                let _ = publish_surface(&payload.to_string());
            }).into_any_element()
        }
    }
}

fn artifact_source_message(chat: &Conversation, source: &str) -> Option<String> {
    let message = if let Some(index) = source.strip_prefix("message:") {
        chat.messages.get(index.parse::<usize>().ok()?)?
    } else {
        let id = source.strip_prefix("tool:")?;
        let start = chat.timeline.iter().position(|entry| {
            matches!(entry, StreamItem::Tool(index) if chat.tools[*index].id == id)
        })?;
        chat.timeline[start + 1..]
            .iter()
            .filter_map(|entry| match *entry {
                StreamItem::Message(index) => chat.messages.get(index),
                _ => None,
            })
            .take_while(|message| message.role != "user")
            .find(|message| message.role == "assistant")?
    };
    let text = message.text.trim();
    if text.is_empty() {
        return None;
    }
    Some(text.char_indices().nth(8000).map_or_else(
        || text.to_owned(),
        |(end, _)| format!("{}…", &text[..end]),
    ))
}
