//! One Scientific Viewer browser retained for the current conversation.
use crate::{
    app::Workbench,
    native_app_surface::{NativeAppMessage, NativeAppPage},
};
use gpui_kit::*;
use pero_contracts::{
    HostEvent,
    session_artifact::{ArtifactBrowserState, ArtifactPreviewTarget},
};
use serde_json::json;

pub(crate) struct RetainedArtifactPreview {
    thread_id: String,
    page: Entity<NativeAppPage>,
    _subscription: Subscription,
    _observation: Subscription,
}

impl Workbench {
    pub(crate) fn open_artifact_preview(
        &mut self,
        state: Option<ArtifactBrowserState>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(state) = state else {
            self.chat
                .update(cx, |chat, cx| chat.set_artifact_preview_view(None, cx));
            self.sync_artifact_preview(cx);
            return;
        };
        if let Some(preview) = &self.artifact_preview {
            if preview.thread_id == state.thread_id {
                let page = preview.page.clone();
                self.chat.update(cx, |chat, cx| {
                    chat.set_artifact_preview_view(Some((state.thread_id, page.into())), cx)
                });
                self.sync_artifact_preview(cx);
                return;
            }
        }
        if let Some(previous) = self.artifact_preview.take() {
            previous
                .page
                .update(cx, |page, cx| page.sync(json!({"active":false}), cx));
        }
        let thread_id = state.thread_id;
        let entry = format!(
            "dist/artifact.html?thread_id={}",
            percent_encoding::utf8_percent_encode(&thread_id, percent_encoding::NON_ALPHANUMERIC)
        );
        let page = cx.new(|cx| {
            NativeAppPage::new(
                "scientific-viewer".into(),
                entry,
                vec!["about:srcdoc".into()],
                window,
                cx,
            )
        });
        let bound_thread = thread_id.clone();
        let subscription = cx.subscribe_in(&page, window, move |this, view, event: &NativeAppMessage, _, cx| {
            let message = &event.0;
            match message["type"].as_str() {
                Some("pero:app:chat" | "pero:artifact:compose") => {
                    let (target, text) = if message["type"] == "pero:artifact:compose" {
                        (serde_json::from_value::<ArtifactPreviewTarget>(message["target"].clone()).ok(),
                         message["text"].as_str().unwrap_or_default())
                    } else {
                        (this.chat.read(cx).artifact_browser_state().and_then(|state| state.selected),
                         message["options"]["message"].as_str().unwrap_or_default())
                    };
                    if let Some(target) = target.filter(|target| target.thread_id == bound_thread) {
                        let mut insertion = HostEvent::new("artifact_compose",
                            message["id"].as_str().map(str::to_owned), text.to_owned());
                        insertion.data = serde_json::to_value(target).expect("artifact target");
                        this.chat.update(cx, |chat, cx| chat.receive(&insertion, cx));
                    } else {
                        view.read(cx).send(json!({"type":"pero:app:chat-result","id":message["id"],"ok":false,"error":"Choose an artifact in this conversation"}), cx);
                    }
                }
                Some("pero:artifact:select") => {
                    if let Ok(target) = serde_json::from_value::<ArtifactPreviewTarget>(message["target"].clone()) {
                        if target.thread_id == bound_thread {
                            let mut selection = HostEvent::new("artifact_select", None, String::new());
                            selection.data = serde_json::to_value(target).expect("artifact target");
                            this.chat.update(cx, |chat, cx| chat.receive(&selection, cx));
                        }
                    }
                }
                Some("link") => {
                    if let Some(url) = message["url"].as_str().filter(|url| url.starts_with("https://") || url.starts_with("http://")) {
                        cx.open_url(url);
                    }
                }
                _ => {}
            }
        });
        let observation = cx.observe(&page, |_, _, cx| cx.notify());
        self.chat.update(cx, |chat, cx| {
            chat.set_artifact_preview_view(Some((thread_id.clone(), page.clone().into())), cx)
        });
        self.artifact_preview = Some(RetainedArtifactPreview {
            thread_id,
            page,
            _subscription: subscription,
            _observation: observation,
        });
        self.sync_artifact_preview(cx);
    }

    pub(crate) fn sync_artifact_preview(&mut self, cx: &mut Context<Self>) {
        let visible = self.chat_visible() && !self.chat.read(cx).artifact_surface_covered();
        let state = self.chat.read(cx).artifact_browser_state();
        if let Some(preview) = &self.artifact_preview {
            let state = state.filter(|state| state.thread_id == preview.thread_id);
            preview.page.update(cx, |page, cx| {
                page.sync(
                    json!({
                        "active":visible && state.is_some(), "artifactBrowser":state,
                        "dark":pero_theme::UiAppearance::global(cx).dark,
                        "appearance":pero_theme::UiAppearance::global(cx), "locale":self.locale,
                    }),
                    cx,
                )
            });
        }
    }

    pub(crate) fn reply_artifact_compose(&self, id: &str, error: Option<&str>, cx: &App) {
        if let Some(preview) = &self.artifact_preview {
            preview.page.read(cx).send(json!({"type":"pero:app:chat-result","id":id,"ok":error.is_none(),"value":{"threadId":preview.thread_id},"error":error.unwrap_or_default()}), cx);
        }
    }
}
