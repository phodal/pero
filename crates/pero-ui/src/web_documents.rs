//! Workspace-owned Web identity, navigation controls and the measured engine slot.
use crate::{app::Workbench, workspace::WorkspaceItem};
use gpui_kit::{
    component::{button::*, input::Input, *},
    prelude::*,
    *,
};
use pero_contracts::{
    HostEvent,
    web_document::{WebDocument, WebLoad},
};
use serde_json::json;
gpui_kit::actions!(web_document, [OpenWeb]);

#[cfg(not(target_family = "wasm"))]
pub(crate) struct WorkspaceNativeWeb {
    pub view: Entity<crate::native_web::NativeWebPage>,
    _subscription: Subscription,
}
#[cfg(not(target_family = "wasm"))]
#[derive(serde::Deserialize)]
#[serde(tag = "action", deny_unknown_fields)]
enum NativeWebIntent {
    #[serde(rename = "web_open")]
    Open {
        url: pero_contracts::web_document::WebAddress,
    },
    #[serde(rename = "web_navigate")]
    Navigate {
        id: String,
        url: pero_contracts::web_document::WebAddress,
    },
    #[serde(rename = "web_close")]
    Close { id: String },
    #[serde(rename = "web_back")]
    Back { id: String },
    #[serde(rename = "web_forward")]
    Forward { id: String },
    #[serde(rename = "web_reload")]
    Reload { id: String },
}

impl Workbench {
    pub(crate) fn choose_web(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.web_entry_open = true;
        if let Some(WorkspaceItem::Web(id)) = self.navigation.current() {
            if let Some(page) = self.web_documents.iter().find(|page| &page.id == id) {
                let url = page.observation.url.as_str().to_owned();
                self.web_address
                    .update(cx, |input, cx| input.set_value(url, window, cx));
            }
        }
        self.web_address.update(cx, |input, cx| {
            input.focus(window, cx);
            input.select_all(window, cx);
        });
        cx.notify();
    }
    pub(crate) fn receive_web(
        &mut self,
        event: &HostEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        match event.kind.as_str() {
            "web_choose" => self.choose_web(window, cx),
            "web_opened" | "web_state" => {
                match serde_json::from_value::<WebDocument>(event.data.clone()) {
                    Ok(page) => self.observe_web(page, event.kind == "web_opened", window, cx),
                    Err(_) => self.error = Some(self.t("web.unavailable").into()),
                }
            }
            "web_closed" => {
                if let Some(id) = event.data["id"].as_str() {
                    self.close_web(id, window, cx);
                }
            }
            "web_error" => self.error = Some(event.text.clone()),
            _ => return false,
        }
        cx.notify();
        true
    }
    fn observe_web(
        &mut self,
        page: WebDocument,
        open: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let id = page.id.clone();
        if matches!(page.observation.load, WebLoad::Loading)
            && self.navigation.current() == Some(&WorkspaceItem::Web(id.clone()))
        {
            self.error = None;
        }
        if let Some(previous) = self
            .web_documents
            .iter_mut()
            .find(|previous| previous.id == id)
        {
            *previous = page;
        } else {
            self.web_documents.push(page);
        }
        if open {
            self.navigation.open(WorkspaceItem::Web(id));
            self.web_entry_open = false;
            self.error = None;
            self.sync_follow(cx);
        }
        self.sync_web_address(open, window, cx);
        cx.notify();
    }
    fn close_web(&mut self, id: &str, window: &mut Window, cx: &mut Context<Self>) {
        #[cfg(not(target_family = "wasm"))]
        self.native_web_pages.remove(id);
        self.web_documents.retain(|page| page.id != id);
        if let Some(route) = self.navigation.close(&WorkspaceItem::Web(id.into())) {
            self.activate_route(route, window, cx);
        }
        cx.notify();
    }
    pub(crate) fn web_command(
        &mut self,
        command: serde_json::Value,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        #[cfg(target_family = "wasm")]
        {
            let _ = window;
            self.command(command, cx);
        }
        #[cfg(not(target_family = "wasm"))]
        {
            use NativeWebIntent::*;
            let intent = match serde_json::from_value::<NativeWebIntent>(command) {
                Ok(intent) => intent,
                Err(error) => {
                    self.error = Some(error.to_string());
                    cx.notify();
                    return;
                }
            };
            match intent {
                Open { url } => {
                    let document = WebDocument::open(url);
                    let id = document.id.clone();
                    let document = if let Some(open) = self.native_web_pages.get(&id) {
                        open.view.read(cx).document.clone()
                    } else {
                        let view = cx
                            .new(|cx| crate::native_web::NativeWebPage::new(document, window, cx));
                        let document = view.read(cx).document.clone();
                        let subscription = cx.subscribe_in(
                            &view,
                            window,
                            |this, _, event: &crate::native_web::NativeWebChanged, window, cx| {
                                this.observe_web(event.0.clone(), false, window, cx)
                            },
                        );
                        self.native_web_pages.insert(
                            id,
                            WorkspaceNativeWeb {
                                view,
                                _subscription: subscription,
                            },
                        );
                        document
                    };
                    self.observe_web(document, true, window, cx);
                }
                Navigate { id, url } => {
                    if let Some(open) = self.native_web_pages.get(&id) {
                        open.view.update(cx, |view, cx| view.navigate(url, cx));
                    }
                }
                Close { id } => self.close_web(&id, window, cx),
                control => {
                    let (id, action) = match control {
                        Back { id } => (id, "web_back"),
                        Forward { id } => (id, "web_forward"),
                        Reload { id } => (id, "web_reload"),
                        _ => unreachable!(),
                    };
                    if let Some(open) = self.native_web_pages.get(&id) {
                        open.view
                            .update(cx, |view, cx| view.control(action, window, cx));
                    }
                }
            }
        }
    }
    pub(crate) fn sync_web_address(
        &self,
        force: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(WorkspaceItem::Web(id)) = self.navigation.current() else {
            return;
        };
        if !force
            && self
                .web_address
                .read(cx)
                .focus_handle(cx)
                .is_focused(window)
        {
            return;
        }
        if let Some(page) = self.web_documents.iter().find(|page| &page.id == id) {
            let url = page.observation.url.as_str();
            if self.web_address.read(cx).value().as_ref() != url {
                self.web_address
                    .update(cx, |input, cx| input.set_value(url.to_owned(), window, cx));
            }
        }
    }
    pub(crate) fn sync_web_surface(
        &mut self,
        bounds: Option<Bounds<Pixels>>,
        cx: &mut Context<Self>,
    ) {
        #[cfg(target_family = "wasm")]
        {
            let bounds = bounds.filter(|_| self.layout.embedded_surface_visible);
            let payload = match (self.navigation.current(), bounds) {
                (Some(WorkspaceItem::Web(id)), Some(bounds)) => {
                    json!({"action":"web_surface","id":id,"bounds":{"x":f32::from(bounds.origin.x),"y":f32::from(bounds.origin.y),"width":f32::from(bounds.size.width),"height":f32::from(bounds.size.height)}})
                }
                _ => json!({"action":"web_surface","id":null}),
            };
            let encoded = payload.to_string();
            if self.web_surface != encoded {
                self.web_surface = encoded;
                self.command(payload, cx);
            }
        }
        #[cfg(not(target_family = "wasm"))]
        {
            let _ = bounds; // Kit measures the selected native view during prepaint.
            let selected = self
                .navigation
                .current()
                .filter(|_| self.layout.embedded_surface_visible);
            for (id, open) in &self.native_web_pages {
                if selected != Some(&WorkspaceItem::Web(id.clone())) {
                    open.view.update(cx, |view, cx| view.hide(cx));
                }
            }
        }
    }
    pub(crate) fn web_toolbar(&self, cx: &mut Context<Self>) -> AnyElement {
        let current = self.navigation.current().and_then(|item| {
            if let WorkspaceItem::Web(id) = item {
                self.web_documents.iter().find(|page| &page.id == id)
            } else {
                None
            }
        });
        let mut toolbar = div()
            .flex()
            .items_center()
            .gap(px(4.))
            .p(px(4.))
            .border_b_1()
            .border_color(cx.theme().border);
        if let Some(page) = current {
            for (action, icon, label, disabled) in [
                (
                    "web_back",
                    "chevron-left",
                    "web.back",
                    !page.observation.can_back,
                ),
                (
                    "web_forward",
                    "chevron-right",
                    "web.forward",
                    !page.observation.can_forward,
                ),
                ("web_reload", "refresh", "web.reload", false),
            ] {
                let source = page.id.clone();
                toolbar = toolbar.child(
                    Button::new(action)
                        .ghost()
                        .small()
                        .icon(
                            Icon::default().path(pero_chat_ui::assets::UiIcon::named(icon).path()),
                        )
                        .tooltip(self.t(label))
                        .accessibility_label(self.t(label))
                        .disabled(disabled)
                        .on_click(cx.listener(move |this, _, window, cx| {
                            this.web_command(json!({"action":action,"id":source}), window, cx)
                        })),
                );
            }
        }
        toolbar = toolbar.child(
            Input::new(&self.web_address)
                .aria_label(self.t("web.address"))
                .small()
                .flex_1(),
        );
        if let Some(page) = current {
            match &page.observation.load {
                WebLoad::Loading => {
                    toolbar = toolbar.child(div().text_size(px(12.)).child(self.t("web.loading")))
                }
                WebLoad::Failed(message) => {
                    toolbar = toolbar.child(
                        div()
                            .max_w(px(280.))
                            .text_size(px(12.))
                            .child(message.clone()),
                    )
                }
                WebLoad::Ready => {}
            }
        } else {
            toolbar = toolbar.child(
                Button::new("web-address-close")
                    .ghost()
                    .small()
                    .icon(IconName::Close)
                    .tooltip(self.t("web.close_address"))
                    .on_click(cx.listener(|this, _, window, cx| {
                        this.web_entry_open = false;
                        this.workspace_focus.focus(window, cx);
                        cx.notify();
                    })),
            );
        }
        toolbar.into_any_element()
    }
    pub(crate) fn web_content(&self, cx: &mut Context<Self>) -> AnyElement {
        #[cfg(target_family = "wasm")]
        {
            let owner = cx.entity().clone();
            div()
                .id("web-content-slot")
                .flex_1()
                .min_h_0()
                .min_w_0()
                .on_prepaint(move |bounds, _, cx| {
                    owner.update(cx, |this, cx| this.sync_web_surface(Some(bounds), cx))
                })
                .into_any_element()
        }
        #[cfg(not(target_family = "wasm"))]
        {
            let _ = cx;
            let view = self
                .navigation
                .current()
                .and_then(|item| {
                    if let WorkspaceItem::Web(id) = item {
                        self.native_web_pages.get(id).map(|page| page.view.clone())
                    } else {
                        None
                    }
                })
                .filter(|_| self.layout.embedded_surface_visible);
            div()
                .flex_1()
                .min_h_0()
                .min_w_0()
                .children(view)
                .into_any_element()
        }
    }
}
