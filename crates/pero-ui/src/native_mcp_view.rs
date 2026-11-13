//! Native engine child surfaces share the same admitted tool-result URL as Electron.
use crate::{
    app::Workbench,
    native_web::{NativeWebChanged, NativeWebPage},
};
use gpui_kit::{prelude::*, *};
use pero_contracts::{
    HostEvent,
    web_document::{WebAddress, WebDocument, WebLoad},
};

pub(crate) struct NativeMcpView {
    page: Entity<NativeWebPage>,
    context: Option<(bool, String)>,
    _load: Subscription,
}
impl Workbench {
    pub(crate) fn receive_inline_mcp(
        &mut self,
        event: &HostEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if matches!(
            event.kind.as_str(),
            "session_closed" | "session_deleted" | "disconnected"
        ) {
            self.native_mcp_views.retain(|(thread, _), view| {
                let keep = event.kind != "disconnected" && Some(thread) != event.thread_id.as_ref();
                if !keep {
                    view.page.update(cx, |page, cx| page.hide(cx));
                }
                keep
            });
            return;
        }
        if event.kind != "mcp_app_view" {
            return;
        }
        let (Some(thread), Some(call), Some(url)) = (
            event.thread_id.as_deref(),
            event.data["tool_call"].as_str(),
            event.data["url"].as_str(),
        ) else {
            return;
        };
        let known = self
            .chat
            .read(cx)
            .chats
            .iter()
            .find(|chat| chat.id == thread)
            .is_some_and(|chat| {
                chat.tools
                    .iter()
                    .any(|tool| tool.id == call && tool.mcp_app.is_some())
            });
        if !known {
            return;
        }
        let key = (thread.to_owned(), call.to_owned());
        let page = if let Some(view) = self.native_mcp_views.get(&key) {
            view.page.clone()
        } else {
            let entry = format!(
                "{url}&theme={}&locale={}",
                if pero_theme::UiAppearance::global(cx).dark {
                    "dark"
                } else {
                    "light"
                },
                self.locale
            );
            let Ok(address) = WebAddress::try_from(entry) else {
                return;
            };
            let page = cx.new(|cx| NativeWebPage::new(WebDocument::open(address), window, cx));
            page.update(cx, |page, _| page.set_active(false));
            let load_key = key.clone();
            let load = cx.subscribe(&page, move |this, _, event: &NativeWebChanged, cx| {
                if !matches!(event.0.observation.load, WebLoad::Ready) {
                    if let Some(view) = this.native_mcp_views.get_mut(&load_key) {
                        view.context = None;
                    }
                }
                this.sync_inline_mcp(cx);
                cx.notify();
            });
            self.native_mcp_views.insert(
                key,
                NativeMcpView {
                    page: page.clone(),
                    context: None,
                    _load: load,
                },
            );
            page
        };
        self.chat.update(cx, |chat, cx| {
            chat.set_mcp_native_view(thread, call, page.into(), cx)
        });
    }
    pub(crate) fn sync_inline_mcp(&mut self, cx: &mut Context<Self>) {
        let visible = self.chat_visible();
        let context = (
            pero_theme::UiAppearance::global(cx).dark,
            self.locale.clone(),
        );
        for ((thread, call), view) in &mut self.native_mcp_views {
            if !visible || !self.chat.read(cx).mcp_inline_active(thread, call) {
                view.page.update(cx, |page, cx| page.hide(cx));
            }
            if view.context.as_ref() != Some(&context)
                && matches!(view.page.read(cx).document.observation.load, WebLoad::Ready)
            {
                let message = serde_json::json!({"type":"pero:mcp:context", "context":{
                    "theme":if context.0 {"dark"} else {"light"}, "locale":context.1}});
                if view.page.read(cx).post_message(&message, cx).is_ok() {
                    view.context = Some(context.clone());
                }
            }
        }
    }
}
