//! A retained view belongs to one original tool result. Rendering never executes it.
use crate::{conversation::Tool, panel::ChatPanel};
#[cfg(target_family = "wasm")]
use gpui_kit::base::ElementExt;
use gpui_kit::{
    component::{Sizable, button::*},
    prelude::*,
    *,
};
use pero_contracts::{
    HostEvent, mcp_runtime::McpRuntimeSession, mcp_session::McpSessionTarget,
    mcp_source::McpAppDescriptor,
};
use serde::Serialize;

#[derive(Clone, Serialize)]
pub struct McpInlineView {
    pub descriptor: McpAppDescriptor,
    pub url: Option<String>,
    pub scope: Option<(u64, u64)>,
    pub request_id: Option<String>,
    pub error: Option<String>,
    #[serde(skip)]
    pub native_view: Option<AnyView>,
}
impl McpInlineView {
    fn available(&self, snapshot: &McpRuntimeSession) -> bool {
        let Some((incarnation, revision)) = self.scope else {
            return false;
        };
        McpSessionTarget {
            thread_id: snapshot.thread_id.clone(),
            incarnation,
            revision,
            server: Some(self.descriptor.server.clone()),
            generation: Some(self.descriptor.generation),
        }
        .admit(snapshot, true)
        .is_ok()
    }
    pub fn new(descriptor: McpAppDescriptor) -> Self {
        Self {
            descriptor,
            url: None,
            scope: None,
            request_id: None,
            error: None,
            native_view: None,
        }
    }
}
#[cfg(target_family = "wasm")]
#[wasm_bindgen::prelude::wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace=window,js_name=peroMcpAppSurface,catch)]
    fn publish_surface(json: &str) -> Result<(), wasm_bindgen::JsValue>;
}
impl ChatPanel {
    pub(crate) fn hide_mcp_surfaces(&self) {
        #[cfg(target_family = "wasm")]
        let _ = publish_surface("{\"reset\":true}");
    }
    pub(crate) fn receive_mcp_app(&mut self, event: &HostEvent, cx: &mut Context<Self>) -> bool {
        if matches!(
            event.kind.as_str(),
            "session_closed" | "session_deleted" | "disconnected"
        ) {
            for chat in &mut self.chats {
                if event.kind == "disconnected" || Some(&chat.id) == event.thread_id.as_ref() {
                    for tool in &mut chat.tools {
                        if let Some(view) = &mut tool.mcp_app {
                            view.native_view = None;
                            view.url = None;
                        }
                    }
                }
            }
            self.hide_mcp_surfaces();
            return false;
        }
        if event.kind == "mcp_error"
            && event
                .request_id
                .as_deref()
                .is_some_and(|id| id.starts_with("mcp-inline-"))
        {
            for chat in &mut self.chats {
                for tool in &mut chat.tools {
                    if let Some(view) = &mut tool.mcp_app {
                        if view.request_id.as_ref() == event.request_id.as_ref() {
                            view.error = Some(event.text.clone());
                        }
                    }
                }
            }
            cx.notify();
            return true;
        }
        if event.kind != "mcp_app_view" {
            return false;
        }
        let Some(call) = event.data["tool_call"].as_str() else {
            return true;
        };
        if let Some(view) = self
            .chats
            .iter_mut()
            .find(|chat| Some(&chat.id) == event.thread_id.as_ref())
            .and_then(|chat| chat.tools.iter_mut().find(|tool| tool.id == call))
            .and_then(|tool| tool.mcp_app.as_mut())
        {
            view.url = event.data["url"].as_str().map(str::to_owned);
            view.error = None;
        }
        cx.notify();
        true
    }
    pub(crate) fn sync_mcp_app_requests(&mut self, cx: &mut Context<Self>) {
        if !self.visible {
            return;
        }
        let Some(chat) = self.active_chat.and_then(|index| self.chats.get_mut(index)) else {
            return;
        };
        if chat.state == crate::session_state::SessionState::Closed {
            return;
        }
        let Some(snapshot) = chat
            .mcp
            .as_ref()
            .filter(|snapshot| !snapshot.closed && snapshot.observable)
        else {
            return;
        };
        let mut commands = vec![];
        for tool in &mut chat.tools {
            let Some(view) = tool
                .mcp_app
                .as_mut()
                .filter(|_| tool.status == "completed" && !tool.cancelled)
            else {
                continue;
            };
            if view.scope.is_some() {
                continue;
            }
            view.scope = Some((snapshot.incarnation, snapshot.revision));
            self.expanded_tools
                .insert(format!("{}/{}", chat.id, tool.id));
            self.next_request += 1;
            view.request_id = Some(format!("mcp-inline-{}", self.next_request));
            commands.push(pero_contracts::mcp_source::McpSourceRequest {
                method: pero_contracts::mcp_source::McpMethod::Mcp,
                action: pero_contracts::mcp_source::McpAction::Adopt,
                mode: pero_contracts::mcp_source::McpSourceMode::Session,
                request_id: format!("mcp-inline-{}", self.next_request),
                thread_id: Some(chat.id.clone()),
                server: Some(view.descriptor.server.clone()),
                generation: Some(view.descriptor.generation),
                tool_call: Some(view.descriptor.tool_call.clone()),
            });
        }
        for command in commands {
            cx.emit(crate::panel::ChatAction::Mcp(command));
        }
    }
    pub fn mcp_inline_visible(&self, thread: &str, call: &str) -> bool {
        self.visible
            && !self.artifact_surface_covered()
            && self
                .active_chat
                .and_then(|index| self.chats.get(index))
                .is_some_and(|chat| {
                    chat.id == thread
                        && chat.tools.iter().enumerate().any(|(index, tool)| {
                            tool.id == call
                                && tool.mcp_app.is_some()
                                && self.expanded_tools.contains(&format!("{thread}/{call}"))
                                && crate::chat::process_member_visible(
                                    chat,
                                    crate::process::ProcessEntry::Tool(index),
                                    &self.expanded_tools,
                                )
                        })
                })
    }
    pub fn mcp_inline_active(&self, thread: &str, call: &str) -> bool {
        self.mcp_inline_visible(thread, call)
            && self
                .chats
                .iter()
                .find(|chat| {
                    chat.id == thread && chat.state != crate::session_state::SessionState::Closed
                })
                .is_some_and(|chat| {
                    chat.mcp.as_ref().is_some_and(|snapshot| {
                        chat.tools
                            .iter()
                            .find(|tool| tool.id == call)
                            .and_then(|tool| tool.mcp_app.as_ref())
                            .is_some_and(|view| view.available(snapshot))
                    })
                })
    }
    pub fn set_mcp_native_view(
        &mut self,
        thread: &str,
        call: &str,
        view: AnyView,
        cx: &mut Context<Self>,
    ) {
        if let Some(surface) = self
            .chats
            .iter_mut()
            .find(|chat| chat.id == thread)
            .and_then(|chat| chat.tools.iter_mut().find(|tool| tool.id == call))
            .and_then(|tool| tool.mcp_app.as_mut())
        {
            surface.native_view = Some(view);
            cx.notify();
        }
    }
    pub(crate) fn mcp_app_surface(
        &self,
        thread: &str,
        tool: &Tool,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let Some(view) = &tool.mcp_app else {
            return div().into_any_element();
        };
        if !self.mcp_inline_visible(thread, &tool.id) {
            return div().into_any_element();
        }
        if !self.mcp_inline_active(thread, &tool.id) {
            return div()
                .text_size(px(12.))
                .child(self.t("mcp.runtime.closed"))
                .into_any_element();
        }
        #[cfg(not(target_family = "wasm"))]
        if let Some(native) = &view.native_view {
            return div()
                .w_full()
                .h(px(380.))
                .child(native.clone())
                .into_any_element();
        }
        if let Some(error) = &view.error {
            let thread = thread.to_owned();
            let call = tool.id.clone();
            return div()
                .flex()
                .flex_col()
                .gap(px(6.))
                .p(px(8.))
                .child(
                    div()
                        .text_color(pero_theme::UiAppearance::global(cx).palette.error)
                        .child(error.clone()),
                )
                .child(
                    Button::new(SharedString::from(format!("mcp-retry-{call}")))
                        .ghost()
                        .small()
                        .label(self.t("mcp.refresh"))
                        .on_click(cx.listener(move |this, _, _, cx| {
                            if let Some(view) = this
                                .chats
                                .iter_mut()
                                .find(|chat| chat.id == thread)
                                .and_then(|chat| chat.tools.iter_mut().find(|tool| tool.id == call))
                                .and_then(|tool| tool.mcp_app.as_mut())
                            {
                                view.scope = None;
                                view.error = None;
                                view.request_id = None;
                            }
                            cx.notify();
                        })),
                )
                .into_any_element();
        }
        let Some(url) = view.url.clone() else {
            return div()
                .h(px(80.))
                .child(self.t("artifacts.loading"))
                .into_any_element();
        };
        #[cfg(target_family = "wasm")]
        {
            let thread = thread.to_owned();
            let call = tool.id.clone();
            let appearance = pero_theme::UiAppearance::global(cx).clone();
            let locale = self.locale.clone();
            return div().w_full().h(px(380.)).on_prepaint(move|bounds,window,_|{
                let mask=bounds.intersect(&window.content_mask().bounds);
                let clip=[f32::from(mask.top()-bounds.top()),f32::from(bounds.right()-mask.right()),f32::from(bounds.bottom()-mask.bottom()),f32::from(mask.left()-bounds.left())].map(|value|value.max(0.));
                let payload=serde_json::json!({"thread_id":thread,"tool_call":call,"url":url,"visible":mask.size.width>px(0.)&&mask.size.height>px(0.),"left":f32::from(bounds.origin.x),"top":f32::from(bounds.origin.y),"width":f32::from(bounds.size.width),"height":f32::from(bounds.size.height),"clip":clip,"dark":appearance.dark,"locale":locale});
                let _=publish_surface(&payload.to_string());
            }).into_any_element();
        }
        #[cfg(not(target_family = "wasm"))]
        {
            let _ = (url, cx);
            div()
                .h(px(80.))
                .child(self.t("artifacts.loading"))
                .into_any_element()
        }
    }
}
