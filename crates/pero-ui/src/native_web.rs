//! Native browser engine. Wry/Kit own the child view; pages receive no Host bridge.
use gpui_kit::{prelude::*, *};
use gpui_webview::WebView;
use pero_contracts::web_document::{WebAddress, WebDocument, WebLoad, WebLocation};
use std::time::Duration;

enum Update {
    Load(wry::PageLoadEvent, String),
    Title(String),
    Popup(String),
    Failed(String),
    Focus,
}
pub struct NativeWebChanged(pub WebDocument);
pub struct NativeWebPopup(pub String);
pub struct NativeWebFocused;
pub struct NativeWebPage {
    pub document: WebDocument,
    view: Option<Entity<WebView>>,
    sender: async_channel::Sender<Update>,
    generation: u64,
    active: bool,
    focused: bool,
    #[cfg(target_os = "macos")]
    browser_destination: std::rc::Rc<std::cell::RefCell<Option<String>>>,
    #[cfg(target_os = "macos")]
    pub(super) browser_grant: Option<crate::native_browser::WebGrant>,
    #[cfg(target_os = "macos")]
    pub(super) browser_popup: Option<crate::native_browser::WebPopupWatch>,
}
impl EventEmitter<NativeWebChanged> for NativeWebPage {}
impl EventEmitter<NativeWebPopup> for NativeWebPage {}
impl EventEmitter<NativeWebFocused> for NativeWebPage {}
impl NativeWebPage {
    pub fn new(document: WebDocument, _browser_origin: Option<String>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let (sender, receiver) = async_channel::unbounded();
        let mut this = Self {
            document,
            view: None,
            sender,
            generation: 0,
            active: true,
            focused: false,
            #[cfg(target_os = "macos")]
            browser_destination: std::rc::Rc::new(std::cell::RefCell::new(_browser_origin)),
            #[cfg(target_os = "macos")]
            browser_grant: None,
            #[cfg(target_os = "macos")]
            browser_popup: None,
        };
        this.mount(window, cx);
        if this.view.is_some() {
            this.start_load(cx);
        }
        cx.spawn(async move |this, cx| {
            while let Ok(update) = receiver.recv().await {
                if this
                    .update(cx, |this, cx| this.receive(update, cx))
                    .is_err()
                {
                    break;
                }
            }
        })
        .detach();
        this
    }
    fn mount(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let navigation = self.sender.clone();
        let loads = self.sender.clone();
        let titles = self.sender.clone();
        let popups = self.sender.clone();
        let focus = self.sender.clone();
        #[cfg(target_os = "macos")]
        let destination = self.browser_destination.clone();
        let inline = self.document.html.is_some();
        let builder = wry::WebViewBuilder::new();
        let builder = if let Some(html) = &self.document.html {
            builder.with_html(&html.html)
        } else {
            builder.with_url(self.document.observation.url.as_str())
        };
        let builder = builder
            .with_initialization_script_for_main_only("addEventListener('pointerdown',()=>window.ipc.postMessage('focus'),true);addEventListener('focus',()=>window.ipc.postMessage('focus'),true);",true)
            .with_ipc_handler(move |request| {if request.body()=="focus" {let _=focus.try_send(Update::Focus);}})
            .with_navigation_handler(move |uri| {
                #[cfg(target_os = "macos")]
                if let Some(origin) = destination.borrow().as_ref() {
                    if crate::native_browser::origin(&uri).as_ref() != Some(origin) {
                        let _ = navigation.try_send(Update::Failed("The destination redirected outside the authorized site.".into()));
                        return false;
                    }
                }
                if inline && uri == "about:blank" {
                    return true;
                }
                if let Err(error) = WebAddress::try_from(uri) {
                    let _ = navigation.try_send(Update::Failed(error));
                    false
                } else {
                    true
                }
            })
            .with_on_page_load_handler(move |event, uri| {
                let _ = loads.try_send(Update::Load(event, uri));
            })
            .with_document_title_changed_handler(move |title| {
                let _ = titles.try_send(Update::Title(title));
            })
            .with_new_window_req_handler(move |uri, _| {
                let _ = popups.try_send(Update::Popup(uri));
                wry::NewWindowResponse::Deny
            });
        match WebView::build(builder, window, cx) {
            Ok(mut view) => {
                view.hide();
                self.view = Some(cx.new(|_| view));
            }
            Err(error) => self.document.observation.load = WebLoad::Failed(error.to_string()),
        }
    }
    fn start_load(&mut self, cx: &mut Context<Self>) {
        self.document.observation.load = WebLoad::Loading;
        self.generation += 1;
        let generation = self.generation;
        // A failure before WebKit commits has no Started/Finished event in Wry.
        // Start the bounded deadline when the Host requests navigation as well.
        cx.spawn(async move |this, cx| {
            cx.background_executor()
                .timer(Duration::from_secs(30))
                .await;
            let _ = this.update(cx, |this, cx| {
                if this.generation == generation
                    && matches!(this.document.observation.load, WebLoad::Loading)
                {
                    this.document.observation.load = WebLoad::Failed(
                        "The page did not finish loading. Reload to try again.".into(),
                    );
                    #[cfg(target_os = "macos")]
                    this.browser_destination.borrow_mut().take();
                    this.changed(cx);
                }
            });
        })
        .detach();
    }
    fn changed(&mut self, cx: &mut Context<Self>) {
        if let Some(view) = &self.view {
            #[cfg(target_os = "macos")]
            {
                use wry::WebViewExtMacOS;
                // Wry creates this WKWebView on this same GPUI UI thread.
                let native = view.read(cx).raw().webview();
                unsafe {
                    self.document.observation.can_back = native.canGoBack();
                    self.document.observation.can_forward = native.canGoForward();
                }
            }
            #[cfg(target_os = "windows")]
            {
                use wry::WebViewExtWindows;
                let native = view.read(cx).raw().webview();
                let mut back = Default::default();
                let mut forward = Default::default();
                unsafe {
                    let _ = native.CanGoBack(&mut back);
                    let _ = native.CanGoForward(&mut forward);
                }
                self.document.observation.can_back = back.as_bool();
                self.document.observation.can_forward = forward.as_bool();
            }
            #[cfg(target_os = "linux")]
            {
                use webkit2gtk::prelude::WebViewExt;
                use wry::WebViewExtUnix;
                let native = view.read(cx).raw().webview();
                self.document.observation.can_back = native.can_go_back();
                self.document.observation.can_forward = native.can_go_forward();
            }
        }
        cx.emit(NativeWebChanged(self.document.clone()));
        cx.notify();
    }
    fn receive(&mut self, update: Update, cx: &mut Context<Self>) {
        match update {
            Update::Focus => cx.emit(NativeWebFocused),
            Update::Load(event, uri) => {
                let Ok(address) = WebLocation::try_from(uri) else {
                    return;
                };
                self.document.observation.url = address;
                #[cfg(target_os = "macos")]
                if self.browser_grant.as_ref().is_some_and(|grant| !grant.matches(self.document.observation.url.as_str())) {
                    self.browser_grant = None;
                }
                match event {
                    wry::PageLoadEvent::Started => self.start_load(cx),
                    // Finished describes rendering; it does not certify an HTTP 2xx response.
                    wry::PageLoadEvent::Finished => self.document.observation.load = WebLoad::Ready,
                }
            }
            Update::Title(title) => self.document.observation.title = title,
            Update::Popup(uri) => {
                #[cfg(target_os = "macos")]
                if self.browser_popup.is_some() {
                    cx.emit(NativeWebPopup(uri));
                    return;
                }
                match WebAddress::try_from(uri) {
                    Ok(address) => cx.emit(NativeWebPopup(address.as_str().into())),
                    Err(error) => self.document.observation.notice = Some(error),
                }
            }
            Update::Failed(error) => self.document.observation.load = WebLoad::Failed(error),
        }
        #[cfg(target_os = "macos")]
        if !matches!(self.document.observation.load, WebLoad::Loading) {
            self.browser_destination.borrow_mut().take();
        }
        self.changed(cx);
    }
    #[cfg(target_os = "macos")]
    pub(super) fn browser_navigate(&mut self, address: WebAddress, origin: String, cx: &mut Context<Self>) {
        self.browser_destination.replace(Some(origin));
        self.load_address(address, cx);
    }
    pub fn navigate(&mut self, address: WebAddress, cx: &mut Context<Self>) {
        #[cfg(target_os = "macos")]
        self.browser_destination.borrow_mut().take();
        self.load_address(address, cx);
    }
    fn load_address(&mut self, address: WebAddress, cx: &mut Context<Self>) {
        self.document.observation.url = address.into();
        #[cfg(target_os = "macos")]
        if self.browser_grant.as_ref().is_some_and(|grant| !grant.matches(self.document.observation.url.as_str())) {
            self.browser_grant = None;
        }
        if self.view.is_some() {
            self.start_load(cx);
        }
        if let Some(view) = &self.view {
            if let Err(error) = view
                .read(cx)
                .raw()
                .load_url(self.document.observation.url.as_str())
            {
                self.document.observation.load = WebLoad::Failed(error.to_string());
            }
        }
        #[cfg(target_os = "macos")]
        if !matches!(self.document.observation.load, WebLoad::Loading) {
            self.browser_destination.borrow_mut().take();
        }
        self.changed(cx);
    }
    pub fn control(&mut self, action: &str, window: &mut Window, cx: &mut Context<Self>) {
        if self.view.is_none() {
            self.mount(window, cx);
            if self.view.is_some() {
                self.start_load(cx);
            }
            self.changed(cx);
            return;
        }
        #[cfg(target_os = "macos")]
        self.browser_destination.borrow_mut().take();
        self.start_load(cx);
        if let Some(view) = &self.view {
            let result = view.update(cx, |view, _| match action {
                "web_back" => view.back(),
                "web_forward" => view.forward(),
                _ => view.raw().reload().map_err(anyhow::Error::from),
            });
            if let Err(error) = result {
                self.document.observation.load = WebLoad::Failed(error.to_string());
            }
        }
        self.changed(cx);
    }
    pub(crate) fn post_message(&self, message: &serde_json::Value, cx: &App) -> anyhow::Result<()> {
        self.view.as_ref().ok_or_else(|| anyhow::anyhow!("Native view is unavailable"))?
            .read(cx).raw().evaluate_script(&format!("window.postMessage({message}, location.origin)"))?;
        Ok(())
    }
    #[cfg(target_os = "macos")]
    pub(super) fn browser_engine<'a>(&self, cx: &'a App) -> anyhow::Result<(&'a wry::WebView, u64)> {
        let view = self.view.as_ref().ok_or_else(|| anyhow::anyhow!("Native Web tab is unavailable"))?.read(cx);
        Ok((view.raw(), self.generation))
    }

    #[cfg(target_os = "macos")]
    pub(super) fn browser_history(
        &mut self,
        action: crate::native_browser::WebHistory,
        destination: String,
        origin: String,
        cx: &mut Context<Self>,
    ) -> anyhow::Result<()> {
        self.browser_destination.replace(Some(origin));
        self.start_load(cx);
        let (raw, generation) = self.browser_engine(cx)?;
        if let Err(error) = action.start(raw) {
            self.receive(Update::Failed(error.to_string()), cx);
            return Err(error);
        }
        self.changed(cx);
        if action != crate::native_browser::WebHistory::Reload {
            // WebKit does not send a load event for same-document history entries.
            cx.spawn(async move |this, cx| {
                for _ in 0..150 {
                    cx.background_executor().timer(Duration::from_millis(100)).await;
                    let done = this.update(cx, |this, cx| {
                        if this.generation != generation || !matches!(this.document.observation.load, WebLoad::Loading) {
                            return true;
                        }
                        let Ok((raw, _)) = this.browser_engine(cx) else { return true };
                        if raw.url().ok().as_deref() == Some(&destination) && !crate::native_browser::web_loading(raw) {
                            this.receive(Update::Load(wry::PageLoadEvent::Finished, destination.clone()), cx);
                            return true;
                        }
                        false
                    });
                    if done.unwrap_or(true) { break; }
                }
            }).detach();
        }
        Ok(())
    }

    #[cfg(target_os = "macos")]
    pub(super) fn browser_view<'a>(&self, cx: &'a App) -> anyhow::Result<(&'a wry::WebView, u64)> {
        let view = self.view.as_ref().ok_or_else(|| anyhow::anyhow!("Native Web tab is unavailable"))?.read(cx);
        anyhow::ensure!(
            view.visible() && crate::native_browser::window_visible(view.raw())
                && matches!(self.document.observation.load, WebLoad::Ready),
            "Show the authorized Web tab and wait for the page to finish loading."
        );
        Ok((view.raw(), self.generation))
    }
    #[cfg(feature = "native-probe")]
    pub fn inspect(
        &self,
        script: &str,
        cx: &App,
        callback: impl Fn(String) + Send + 'static,
    ) -> anyhow::Result<()> {
        self.view
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("Native view is unavailable"))?
            .read(cx)
            .raw()
            .evaluate_script_with_callback(script, callback)?;
        Ok(())
    }
    #[cfg(feature = "native-probe")]
    pub fn show_for_probe(&self, cx: &mut App) {
        if let Some(view) = &self.view {
            view.update(cx, |view, _| view.show());
        }
    }
    #[cfg(any(target_os = "macos", feature = "native-probe"))]
    pub fn visible(&self, cx: &App) -> bool {
        self.view
            .as_ref()
            .is_some_and(|view| view.read(cx).visible())
    }
    pub fn perform_edit(&self, command: &str, cx: &App) -> bool {
        #[cfg(target_os = "macos")]
        {
            let Some(view) = &self.view else {
                return false;
            };
            if !self.active {
                return false;
            }
            return edit_macos(view.read(cx).raw(), command);
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = (command, cx);
            false
        }
    }
    pub fn set_active(&mut self, active: bool) {
        self.active = active;
    }
    pub fn hide(&mut self, cx: &mut App) {
        self.focused = false;
        if let Some(view) = &self.view {
            if view.read(cx).visible() {
                view.update(cx, |view, _| view.hide());
            }
        }
    }
}
/// The native page is a rectangle above the rounded content surface. Clip only
/// its top-left when that corner is the content corner, so the chrome cutout
/// stays visible after the page appears.
pub(crate) fn clip_leading_corner(view: &wry::WebView, at_corner: bool) {
    #[cfg(target_os = "macos")]
    clip_leading_corner_macos(view, at_corner);
    #[cfg(not(target_os = "macos"))]
    let _ = (view, at_corner);
}

#[cfg(target_os = "macos")]
fn clip_leading_corner_macos(view: &wry::WebView, at_corner: bool) {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;
    use wry::WebViewExtMacOS as _;

    let radius: f64 = if at_corner {
        f64::from(pero_theme::RADIUS_PANEL)
    } else {
        0.
    };
    let webview = view.webview();
    unsafe {
        let page = &*(&*webview as *const _ as *const AnyObject);
        let host: *mut AnyObject = msg_send![page, superview];
        if host.is_null() {
            round_top_left(page, radius);
            return;
        }
        let host = &*host;
        let host_frame: ObjcRect = msg_send![host, frame];
        let view_frame: ObjcRect = msg_send![page, frame];
        let wraps = host_frame.size.width > 1.
            && host_frame.size.width <= view_frame.size.width + 1.
            && host_frame.size.height <= view_frame.size.height + 1.;
        // The clip belongs on the composition container. A larger superview is the
        // window, so the page layer is clipped instead.
        round_top_left(page, if wraps { 0. } else { radius });
        if wraps {
            round_top_left(host, radius);
        }
    }
}

#[cfg(target_os = "macos")]
fn round_top_left(view: &objc2::runtime::AnyObject, radius: f64) {
    use objc2::msg_send;
    use objc2::runtime::{AnyObject, Bool};

    // The composition container is an unflipped layer. Apple names this mask
    // the top-left corner.
    const TOP_LEFT: u64 = 1 << 2;
    unsafe {
        let _: () = msg_send![view, setWantsLayer: Bool::YES];
        let layer: *mut AnyObject = msg_send![view, layer];
        if layer.is_null() {
            return;
        }
        let layer = &*layer;
        let _: () = msg_send![layer, setMasksToBounds: Bool::YES];
        let _: () = msg_send![layer, setCornerRadius: radius];
        let _: () = msg_send![layer, setMaskedCorners: TOP_LEFT];
    }
}

#[cfg(target_os = "macos")]
#[repr(C)]
#[derive(Clone, Copy)]
pub(crate) struct ObjcPoint {
    pub(crate) x: f64,
    pub(crate) y: f64,
}

#[cfg(target_os = "macos")]
#[repr(C)]
#[derive(Clone, Copy)]
pub(crate) struct ObjcSize {
    pub(crate) width: f64,
    pub(crate) height: f64,
}

#[cfg(target_os = "macos")]
#[repr(C)]
#[derive(Clone, Copy)]
pub(crate) struct ObjcRect {
    pub(crate) origin: ObjcPoint,
    pub(crate) size: ObjcSize,
}

#[cfg(target_os = "macos")]
unsafe impl objc2::encode::Encode for ObjcPoint {
    const ENCODING: objc2::encode::Encoding = objc2::encode::Encoding::Struct(
        "_NSPoint",
        &[
            <f64 as objc2::encode::Encode>::ENCODING,
            <f64 as objc2::encode::Encode>::ENCODING,
        ],
    );
}

#[cfg(target_os = "macos")]
unsafe impl objc2::encode::Encode for ObjcSize {
    const ENCODING: objc2::encode::Encoding = objc2::encode::Encoding::Struct(
        "_NSSize",
        &[
            <f64 as objc2::encode::Encode>::ENCODING,
            <f64 as objc2::encode::Encode>::ENCODING,
        ],
    );
}

#[cfg(target_os = "macos")]
unsafe impl objc2::encode::Encode for ObjcRect {
    const ENCODING: objc2::encode::Encoding =
        objc2::encode::Encoding::Struct("_NSRect", &[ObjcPoint::ENCODING, ObjcSize::ENCODING]);
}
#[cfg(target_os = "macos")]
unsafe impl objc2::encode::RefEncode for ObjcRect {
    const ENCODING_REF: objc2::encode::Encoding =
        objc2::encode::Encoding::Pointer(&<Self as objc2::encode::Encode>::ENCODING);
}


#[cfg(target_os = "macos")]
pub(crate) fn edit_macos(view: &wry::WebView, command: &str) -> bool {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;
    use wry::WebViewExtMacOS as _;
    let webview = view.webview();
    let sender: *mut AnyObject = std::ptr::null_mut();
    unsafe {
        let window: *mut AnyObject = msg_send![&*webview, window];
        if !window.is_null() {
            let _: bool = msg_send![window, makeFirstResponder: &*webview];
        }
        match command {
            "copy" => {
                let _: () = msg_send![&*webview, copy: sender];
            }
            "cut" => {
                let _: () = msg_send![&*webview, cut: sender];
            }
            "paste" => {
                let _: () = msg_send![&*webview, paste: sender];
            }
            "selectAll" => {
                let _: () = msg_send![&*webview, selectAll: sender];
            }
            _ => return false,
        }
    }
    true
}
impl Render for NativeWebPage {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if let Some(view) = &self.view {
            view.update(cx, |view, _| {
                if !view.visible() {
                    view.show();
                }
                if self.active && !self.focused && window.is_window_active() {
                    let _ = view.raw().focus();
                }
            });
            self.focused = self.active;
        }
        div()
            .flex_1()
            .min_h_0()
            .h_full()
            .children(self.view.clone())
    }
}
