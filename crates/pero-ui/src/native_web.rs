//! Native browser engine. Wry/Kit own the child view; pages receive no Host bridge.
use gpui_kit::{prelude::*, *};
use gpui_webview::WebView;
use pero_contracts::web_document::{WebAddress, WebDocument, WebLoad};
use std::time::Duration;

enum Update {
    Load(wry::PageLoadEvent, String),
    Title(String),
    Navigate(String),
    Failed(String),
}
pub struct NativeWebChanged(pub WebDocument);
pub struct NativeWebPage {
    pub document: WebDocument,
    view: Option<Entity<WebView>>,
    sender: async_channel::Sender<Update>,
    generation: u64,
}
impl EventEmitter<NativeWebChanged> for NativeWebPage {}
impl NativeWebPage {
    pub fn new(document: WebDocument, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let (sender, receiver) = async_channel::unbounded();
        let mut this = Self {
            document,
            view: None,
            sender,
            generation: 0,
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
        let builder = wry::WebViewBuilder::new()
            .with_url(self.document.observation.url.as_str())
            .with_navigation_handler(move |uri| {
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
                let _ = popups.try_send(Update::Navigate(uri));
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
            Update::Load(event, uri) => {
                let Ok(address) = WebAddress::try_from(uri) else {
                    return;
                };
                self.document.observation.url = address;
                match event {
                    wry::PageLoadEvent::Started => self.start_load(cx),
                    // Finished describes rendering; it does not certify an HTTP 2xx response.
                    wry::PageLoadEvent::Finished => self.document.observation.load = WebLoad::Ready,
                }
            }
            Update::Title(title) => self.document.observation.title = title,
            Update::Navigate(uri) => match WebAddress::try_from(uri) {
                Ok(address) => self.navigate(address, cx),
                Err(error) => self.document.observation.load = WebLoad::Failed(error),
            },
            Update::Failed(error) => self.document.observation.load = WebLoad::Failed(error),
        }
        self.changed(cx);
    }
    pub fn navigate(&mut self, address: WebAddress, cx: &mut Context<Self>) {
        self.document.observation.url = address;
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
    #[cfg(feature = "native-probe")]
    pub fn visible(&self, cx: &App) -> bool {
        self.view
            .as_ref()
            .is_some_and(|view| view.read(cx).visible())
    }
    pub fn hide(&self, cx: &mut App) {
        if let Some(view) = &self.view {
            if view.read(cx).visible() {
                view.update(cx, |view, _| view.hide());
            }
        }
    }
}
impl Render for NativeWebPage {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if let Some(view) = &self.view {
            view.update(cx, |view, _| {
                if !view.visible() {
                    view.show();
                    if window.is_window_active() {
                        let _ = view.raw().focus();
                    }
                }
            });
        }
        div()
            .flex_1()
            .min_h_0()
            .h_full()
            .children(self.view.clone())
    }
}
