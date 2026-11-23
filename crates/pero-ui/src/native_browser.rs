//! Browser Use for the workbench's own WKWebViews.
use crate::{app::Workbench, workspace::WorkspaceItem};
use gpui_kit::{prelude::*, *};
use objc2::{
    class, msg_send,
    rc::Retained,
    runtime::{AnyObject, Bool},
    sel,
};
use pero_contracts::{
    HostEvent,
    web_document::{WebAddress, WebDocument, WebLoad},
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{ffi::CStr, ptr};

use crate::native_web::{ObjcPoint, ObjcRect};

mod capture;
use capture::ScreenshotClip;
mod dialogs;
pub(crate) use dialogs::DialogDelegate;

pub(super) struct WebGrant {
    id: uuid::Uuid,
    thread: String,
    origin: String,
}

pub(super) struct WebPopupWatch {
    request: String,
    grant: uuid::Uuid,
    generation: u64,
    url: String,
}

impl WebGrant {
    pub(super) fn matches(&self, value: &str) -> bool {
        origin(value).is_some_and(|candidate| candidate == self.origin)
    }

    fn stamp(&self, generation: u64, dialogs: Option<&DialogDelegate>, url: &str) -> String {
        format!("{}:{generation}:{}:{url}", self.id, dialogs.map_or(0, DialogDelegate::revision))
    }
}

pub(super) fn origin(value: &str) -> Option<String> {
    let url = url::Url::parse(value).ok()?;
    (matches!(url.scheme(), "http" | "https")
        && url.username().is_empty()
        && url.password().is_none())
    .then(|| url.origin().ascii_serialization())
}

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "camelCase")]
enum BrowserOp {
    Tabs {
        thread: String,
    },
    Revoke {
        thread: Option<String>,
    },
    Manage {
        thread: String,
        tab: String,
        grant: uuid::Uuid,
        command: TabAction,
    },
    Run {
        thread: String,
        tab: String,
        stamp: String,
        operation: WebOperation,
    },
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
enum TabAction {
    Open { url: String },
    Activate,
    Close,
    GetJsDialog,
    HandleJsDialog { dialog_id: uuid::Uuid, decision: dialogs::Decision, prompt_text: Option<String> },
}

#[derive(Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(super) enum WebHistory {
    Back,
    Forward,
    Reload,
}

impl WebHistory {
    fn destination(self, view: &wry::WebView) -> anyhow::Result<Option<String>> {
        if self == Self::Reload {
            return Ok(Some(view.url()?));
        }
        let view = webkit(view);
        unsafe {
            let list: *mut AnyObject = msg_send![&*view, backForwardList];
            let item: *mut AnyObject = match self {
                Self::Back => msg_send![list, backItem],
                Self::Forward => msg_send![list, forwardItem],
                Self::Reload => unreachable!(),
            };
            if item.is_null() {
                return Ok(None);
            }
            let url: *mut AnyObject = msg_send![item, URL];
            let text: *mut AnyObject = msg_send![url, absoluteString];
            let utf8: *const std::ffi::c_char = msg_send![text, UTF8String];
            anyhow::ensure!(!utf8.is_null(), "The history entry has no URL.");
            Ok(Some(CStr::from_ptr(utf8).to_str()?.to_owned()))
        }
    }

    pub(super) fn start(self, view: &wry::WebView) -> anyhow::Result<()> {
        let view = webkit(view);
        let navigation: *mut AnyObject = unsafe {
            match self {
                Self::Back => msg_send![&*view, goBack],
                Self::Forward => msg_send![&*view, goForward],
                Self::Reload => msg_send![&*view, reload],
            }
        };
        anyhow::ensure!(
            !navigation.is_null(),
            "WebKit did not start history navigation."
        );
        Ok(())
    }
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum WebOperation {
    Check,
    CheckFrames,
    Evaluate {
        script: String,
        #[serde(default, rename = "awaitResult")]
        await_result: bool,
    },
    Navigate { url: String },
    History { action: WebHistory },
    Screenshot { clip: Option<ScreenshotClip> },
    Dispatch {
        input: WebInput,
        #[serde(default, rename = "expectPopup")]
        expect_popup: bool,
    },
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum WebInput {
    Pointer {
        x: f64,
        y: f64,
        count: u8,
    },
    Wheel {
        x: f64,
        y: f64,
        delta_x: i32,
        delta_y: i32,
    },
    Key {
        key: String,
        modifiers: Option<Vec<String>>,
    },
}

impl Workbench {
    pub(super) fn browser_thread(&self, cx: &App) -> Option<String> {
        let chat = self.chat.read(cx);
        chat.active_chat
            .and_then(|index| chat.chats.get(index))
            .filter(|chat| chat.scope.is_none())
            .map(|chat| chat.id.clone())
    }

    pub(crate) fn native_browser_granted(&self, id: &str, cx: &App) -> bool {
        self.native_web_pages
            .get(id)
            .and_then(|page| page.view.read(cx).browser_grant.as_ref())
            .is_some_and(|grant| self.browser_thread(cx).as_ref() == Some(&grant.thread))
    }

    pub(crate) fn native_browser_toggle(
        &mut self,
        id: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(thread) = self.browser_thread(cx) else {
            return;
        };
        let Some(page) = self.native_web_pages.get(id).map(|page| page.view.clone()) else {
            return;
        };
        let tab = page.read(cx);
        if tab
            .browser_grant
            .as_ref()
            .is_some_and(|grant| grant.thread == thread)
        {
            page.update(cx, |tab, _| tab.browser_grant = None);
            cx.notify();
            return;
        }
        let url = tab.document.observation.url.as_str();
        let Some(origin) = origin(url) else { return };
        if tab.document.html.is_some() || !matches!(tab.document.observation.load, WebLoad::Ready) {
            return;
        }
        let Ok((_, generation)) = tab.browser_view(cx) else {
            return;
        };
        let detail = format!(
            "{}\n{}\n\n{}",
            origin,
            tab.document.observation.title,
            self.t("browser_use.native_grant_detail")
        );
        let answer = window.prompt(
            PromptLevel::Warning,
            self.t("browser_use.allow_tab"),
            Some(&detail),
            &[self.t("browser_use.deny"), self.t("browser_use.allow")],
            cx,
        );
        let id = id.to_owned();
        cx.spawn_in(window, async move |this, cx| {
            if answer.await != Ok(1) {
                return;
            }
            let _ = this.update_in(cx, |this, _, cx| {
                if this.browser_thread(cx).as_deref() != Some(&thread)
                    || this.navigation.current() != Some(&WorkspaceItem::Web(id.clone()))
                    || !this
                        .native_web_pages
                        .get(&id)
                        .is_some_and(|open| open.view.entity_id() == page.entity_id())
                {
                    return;
                }
                let tab = page.read(cx);
                if tab.browser_view(cx).ok().map(|(_, current)| current) != Some(generation)
                    || self::origin(tab.document.observation.url.as_str()).as_deref()
                        != Some(&origin)
                {
                    return;
                }
                this.native_browser_allow(&id, cx);
            });
        })
        .detach();
    }

    pub(super) fn native_browser_allow(&mut self, id: &str, cx: &mut Context<Self>) -> bool {
        let Some(thread) = self.browser_thread(cx) else {
            return false;
        };
        let Some(page) = self.native_web_pages.get(id).map(|page| page.view.clone()) else {
            return false;
        };
        let tab = page.read(cx);
        let Some(origin) = origin(tab.document.observation.url.as_str()) else {
            return false;
        };
        if tab.document.html.is_some()
            || tab.browser_view(cx).is_err()
            || self.navigation.current() != Some(&WorkspaceItem::Web(id.to_owned()))
        {
            return false;
        }
        page.update(cx, |tab, _| {
            tab.browser_grant = Some(WebGrant {
                id: uuid::Uuid::new_v4(),
                thread,
                origin,
            })
        });
        cx.notify();
        true
    }

    pub(crate) fn native_browser_rpc(
        &mut self,
        event: HostEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let request = event.request_id.unwrap_or_default();
        let apps = crate::native::apps();
        let result = (|| -> anyhow::Result<Option<Value>> {
            let action: BrowserOp = serde_json::from_value(event.data)?;
            match action {
                BrowserOp::Revoke { thread } => {
                    for page in self.native_web_pages.values() {
                        page.view.update(cx, |tab, _| {
                            if tab.browser_grant.as_ref().is_some_and(|grant| {
                                thread.as_ref().is_none_or(|thread| thread == &grant.thread)
                            }) {
                                tab.browser_grant = None;
                            }
                        });
                    }
                    cx.notify();
                    Ok(Some(Value::Null))
                }
                BrowserOp::Tabs { thread } => {
                    let tabs: Vec<_> = self.native_web_pages.values().filter_map(|page| {
                        let tab = page.view.read(cx);
                        let grant = tab.browser_grant.as_ref().filter(|grant| grant.thread == thread)?;
                        let (engine, _) = tab.browser_engine(cx).ok()?;
                        let url = engine.url().ok().filter(|value| !value.is_empty())
                            .unwrap_or_else(|| tab.document.observation.url.as_str().to_owned());
                        if !grant.matches(&url) { return None; }
                        let id = &tab.document.id;
                        let active = self.navigation.current() == Some(&WorkspaceItem::Web(id.clone()));
                        let stamp = tab.browser_view(cx).ok().map(|(_, generation)| grant.stamp(generation, tab.browser_dialogs.as_deref(), &url));
                        let load_error = if let WebLoad::Failed(error) = &tab.document.observation.load { Some(error) } else { None };
                        Some(json!({"tabId":id,"origin":grant.origin,"url":url,"title":tab.document.observation.title.chars().take(160).collect::<String>(),
                            "visible":tab.visible(cx) && window_visible(engine),"active":active,"stamp":stamp,"grantId":grant.id,"loadError":load_error}))
                    }).collect();
                    Ok(Some(json!(tabs)))
                }
                BrowserOp::Manage {
                    thread,
                    tab,
                    grant,
                    command,
                } => {
                    anyhow::ensure!(
                        self.browser_thread(cx).as_deref() == Some(&thread),
                        "The selected conversation changed."
                    );
                    let view = self
                        .native_web_pages
                        .get(&tab)
                        .ok_or_else(|| anyhow::anyhow!("The Web tab is closed."))?
                        .view
                        .read(cx);
                    let grant = view
                        .browser_grant
                        .as_ref()
                        .filter(|current| current.id == grant && current.thread == thread)
                        .ok_or_else(|| anyhow::anyhow!("Allow Browser Use for this tab."))?;
                    let (raw, _) = view.browser_engine(cx)?;
                    anyhow::ensure!(
                        grant.matches(&raw.url()?),
                        "The Web tab left the authorized site."
                    );
                    match command {
                        TabAction::Open { url } => {
                            view.browser_view(cx)?;
                            anyhow::ensure!(
                                grant.matches(&url),
                                "The address is outside the authorized site."
                            );
                            let origin = grant.origin.clone();
                            Ok(Some(self.open_native_browser_tab(&url, origin, window, cx)?))
                        }
                        TabAction::Activate => {
                            let item = WorkspaceItem::Web(tab.clone());
                            if let Some(route) = self.navigation.select(&item) {
                                self.activate_route(route, window, cx);
                            }
                            anyhow::ensure!(
                                self.navigation.current() == Some(&item),
                                "The Web tab is unavailable."
                            );
                            Ok(Some(json!({"kind":"tabActivated","tabId":tab})))
                        }
                        TabAction::Close => {
                            self.close_web(&tab, window, cx);
                            Ok(Some(json!({"kind":"tabClosed","tabId":tab})))
                        }
                        action @ (TabAction::GetJsDialog | TabAction::HandleJsDialog { .. }) => {
                            anyhow::ensure!(
                                view.visible(cx) && window_visible(raw) && self.navigation.current() == Some(&WorkspaceItem::Web(tab)),
                                "Select the authorized Web tab before handling its JavaScript dialog."
                            );
                            let dialogs = view.browser_dialogs.as_ref().ok_or_else(|| anyhow::anyhow!("The WebKit dialog delegate is unavailable."))?;
                            Ok(Some(match action {
                                TabAction::HandleJsDialog { dialog_id, decision, prompt_text } => dialogs.answer(grant, dialog_id, decision, prompt_text),
                                _ => dialogs.observe(grant).unwrap_or(Value::Null),
                            }))
                        }
                    }
                }
                BrowserOp::Run {
                    thread,
                    tab,
                    stamp,
                    operation,
                } => {
                    anyhow::ensure!(
                        self.browser_thread(cx).as_deref() == Some(&thread),
                        "The selected conversation changed."
                    );
                    let page = &self
                        .native_web_pages
                        .get(&tab)
                        .ok_or_else(|| anyhow::anyhow!("The Web tab is closed."))?
                        .view;
                    let view = page.read(cx);
                    let grant = view
                        .browser_grant
                        .as_ref()
                        .filter(|grant| grant.thread == thread)
                        .ok_or_else(|| anyhow::anyhow!("Allow Browser Use for this tab."))?;
                    let dialogs = view.browser_dialogs.as_deref();
                    anyhow::ensure!(!dialogs.is_some_and(DialogDelegate::is_open), "A JavaScript dialog is open. Use getJsDialog or close it in the Workbench.");
                    let (raw, generation) = view.browser_view(cx)?;
                    let url = raw.url()?;
                    anyhow::ensure!(
                        grant.matches(&url) && stamp == grant.stamp(generation, dialogs, &url),
                        "The Web tab or document changed."
                    );
                    match operation {
                        WebOperation::Check => Ok(Some(Value::Null)),
                        WebOperation::Evaluate { script, await_result } => {
                            let request = request.clone();
                            let apps = apps.clone();
                            let reply = move |reply| reply_browser(&apps, &request, reply);
                            if let Some(dialogs) = dialogs {
                                evaluate(raw, &script, await_result, dialogs.evaluation(Box::new(reply)));
                            } else {
                                evaluate(raw, &script, await_result, reply);
                            }
                            Ok(None)
                        }
                        WebOperation::Navigate { url } => {
                            anyhow::ensure!(
                                grant.matches(&url),
                                "The address is outside the authorized site."
                            );
                            let address = WebAddress::try_from(url).map_err(anyhow::Error::msg)?;
                            let origin = grant.origin.clone();
                            page.update(cx, |view, cx| view.browser_navigate(address, origin, cx));
                            Ok(Some(Value::Null))
                        }
                        WebOperation::History { action } => {
                            let Some(destination) = action.destination(raw)? else {
                                return Ok(Some(
                                    json!({"rejected":"There is no history entry in that direction."}),
                                ));
                            };
                            if !grant.matches(&destination) {
                                return Ok(Some(
                                    json!({"rejected":"The history entry is outside the authorized site."}),
                                ));
                            }
                            let origin = grant.origin.clone();
                            page.update(cx, |view, cx| {
                                view.browser_history(action, destination, origin, cx)
                            })?;
                            Ok(Some(Value::Null))
                        }
                        WebOperation::CheckFrames => {
                            let apps = apps.clone();
                            let id = request.clone();
                            capture::check_frames(raw, &grant.origin, move |reply| {
                                reply_browser(&apps, &id, reply)
                            })?;
                            Ok(None)
                        }
                        WebOperation::Screenshot { clip } => {
                            let apps = apps.clone();
                            let id = request.clone();
                            capture::capture(raw, clip, move |reply| {
                                reply_browser(&apps, &id, reply)
                            });
                            Ok(None)
                        }
                        WebOperation::Dispatch { input, expect_popup } => {
                            anyhow::ensure!(
                                self.navigation.current() == Some(&WorkspaceItem::Web(tab)),
                                "Select the authorized Web tab before sending input."
                            );
                            if !expect_popup {
                                dispatch(raw, input)?;
                                return Ok(Some(Value::Null));
                            }
                            anyhow::ensure!(
                                matches!(input, WebInput::Pointer { count: 1, .. }),
                                "A popup can only be observed after a single click."
                            );
                            anyhow::ensure!(
                                view.browser_popup.is_none(),
                                "A new tab is already being observed."
                            );
                            let watch = WebPopupWatch {
                                request: request.clone(),
                                grant: grant.id,
                                generation,
                                url,
                            };
                            dispatch(raw, input)?;
                            page.update(cx, |view, _| view.browser_popup = Some(watch));
                            let page = page.clone();
                            let apps = apps.clone();
                            let request = request.clone();
                            cx.spawn(async move |_, cx| {
                                cx.background_executor().timer(std::time::Duration::from_secs(5)).await;
                                let expired = page.update(cx, |view, _| {
                                    if view.browser_popup.as_ref().is_some_and(|watch| watch.request == request) {
                                        view.browser_popup.take();
                                        true
                                    } else {
                                        false
                                    }
                                });
                                if expired {
                                    reply_browser(&apps, &request, Ok(json!({
                                        "kind": "notObserved", "reason": "No new tab was observed after the click."
                                    })));
                                }
                            }).detach();
                            Ok(None)
                        }
                    }
                }
            }
        })();
        match result {
            Ok(Some(value)) => reply_browser(&apps, &request, Ok(value)),
            Ok(None) => {}
            Err(error) => reply_browser(&apps, &request, Err(error)),
        }
    }

    fn open_native_browser_tab(
        &mut self,
        url: &str,
        origin: String,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> anyhow::Result<Value> {
        let address = WebAddress::try_from(url.to_owned()).map_err(anyhow::Error::msg)?;
        let id = format!("web-tab:{}", uuid::Uuid::new_v4());
        let document = WebDocument::restore(id.clone(), address.into(), None)
            .map_err(anyhow::Error::msg)?;
        self.mount_native_web(document, true, Some(origin), window, cx);
        Ok(json!({"kind":"tabOpened","tabId":id,"authorized":false}))
    }

    pub(super) fn native_browser_popup(
        &mut self,
        source: &Entity<crate::native_web::NativeWebPage>,
        url: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        let Some(watch) = source.update(cx, |view, _| view.browser_popup.take()) else {
            return false;
        };
        let result = (|| -> anyhow::Result<Value> {
            let view = source.read(cx);
            let grant = view.browser_grant.as_ref().filter(|grant| grant.id == watch.grant)
                .ok_or_else(|| anyhow::anyhow!("The source tab's authorization ended."))?;
            let (engine, generation) = view.browser_view(cx)?;
            anyhow::ensure!(generation == watch.generation && engine.url()? == watch.url
                && self.browser_thread(cx).as_deref() == Some(grant.thread.as_str())
                && self.navigation.current() == Some(&WorkspaceItem::Web(view.document.id.clone())),
                "The source tab or conversation changed.");
            anyhow::ensure!(grant.matches(url), "The new tab is outside the authorized site.");
            let origin = grant.origin.clone();
            self.open_native_browser_tab(url, origin, window, cx)
        })();
        let effect = result.unwrap_or_else(|error| json!({"kind":"blocked","reason":error.to_string()}));
        reply_browser(&crate::native::apps(), &watch.request, Ok(effect));
        true
    }
}

fn reply_browser(
    apps: &crate::native_apps::NativeApps,
    request: &str,
    result: anyhow::Result<Value>,
) {
    apps.shell_reply(
        request,
        Ok(match result {
            Ok(value) => json!({"ok": true, "value": value}),
            Err(error) => json!({"ok": false, "error": error.to_string()}),
        }),
    );
}

thread_local! {
    // WebKit scopes JavaScript globals to the lifetime of this content world.
    static BROWSER_WORLD: Retained<AnyObject> = unsafe {
        let name: *mut AnyObject = msg_send![class!(NSString), stringWithUTF8String: c"PeroBrowserUse".as_ptr()];
        msg_send![class!(WKContentWorld), worldWithName: name]
    };
}

fn webkit(view: &wry::WebView) -> Retained<AnyObject> {
    use wry::WebViewExtMacOS;
    unsafe { Retained::cast_unchecked(view.webview()) }
}

pub(super) fn web_loading(view: &wry::WebView) -> bool {
    let view = webkit(view);
    let loading: Bool = unsafe { msg_send![&*view, isLoading] };
    loading.as_bool()
}

fn evaluate(
    view: &wry::WebView,
    script: &str,
    await_result: bool,
    reply: impl Fn(anyhow::Result<Value>) + 'static,
) {
    let script = if await_result {
        format!("return JSON.stringify(await ({script}));")
    } else {
        format!("JSON.stringify({script})")
    };
    let Ok(source) = std::ffi::CString::new(script) else {
        reply(Err(anyhow::anyhow!("Invalid Browser Use script.")));
        return;
    };
    let view = webkit(view);
    BROWSER_WORLD.with(|world| unsafe {
        let source: *mut AnyObject =
            msg_send![class!(NSString), stringWithUTF8String: source.as_ptr()];
        let handler = block2::RcBlock::new(move |value: *mut AnyObject, error: *mut AnyObject| {
            let result = if error.is_null() && !value.is_null() {
                let value: *const std::ffi::c_char = msg_send![&*value, UTF8String];
                serde_json::from_slice(CStr::from_ptr(value).to_bytes())
                    .map_err(anyhow::Error::from)
            } else {
                Err(anyhow::anyhow!(
                    "The authorized WebKit document did not answer."
                ))
            };
            reply(result);
        });
        if await_result {
            let _: () = msg_send![&*view, callAsyncJavaScript: source, arguments: ptr::null::<AnyObject>(),
                inFrame: ptr::null::<AnyObject>(), inContentWorld: &**world, completionHandler: &*handler];
        } else {
            let _: () = msg_send![&*view, evaluateJavaScript: source, inFrame: ptr::null::<AnyObject>(),
                inContentWorld: &**world, completionHandler: &*handler];
        }
    });
}

pub(super) fn window_visible(view: &wry::WebView) -> bool {
    let view = webkit(view);
    unsafe {
        let wk = &*view;
        let window: *mut AnyObject = msg_send![wk, window];
        let visible: Bool = msg_send![window, isVisible];
        let minimized: Bool = msg_send![window, isMiniaturized];
        visible.as_bool() && !minimized.as_bool()
    }
}

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGEventCreateScrollWheelEvent2(
        source: *mut std::ffi::c_void,
        units: u32,
        count: u32,
        vertical: i32,
        horizontal: i32,
        third: i32,
    ) -> *mut std::ffi::c_void;
    fn CGEventSetLocation(event: *mut std::ffi::c_void, point: ObjcPoint);
}
#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    fn CFRelease(value: *mut std::ffi::c_void);
}

fn pointer_location(wk: &AnyObject, x: f64, y: f64) -> anyhow::Result<ObjcPoint> {
    unsafe {
        let bounds: ObjcRect = msg_send![wk, bounds];
        let flipped: Bool = msg_send![wk, isFlipped];
        let zoom: f64 = msg_send![wk, pageZoom];
        let (x, y) = (x * zoom, y * zoom);
        anyhow::ensure!(
            x >= 0. && y >= 0. && x < bounds.size.width && y < bounds.size.height,
            "The pointer is outside the visible Web tab."
        );
        let point = ObjcPoint {
            x,
            y: if flipped.as_bool() {
                y
            } else {
                bounds.size.height - y
            },
        };
        Ok(msg_send![wk, convertPoint: point, toView: ptr::null::<AnyObject>()])
    }
}

fn dispatch(view: &wry::WebView, input: WebInput) -> anyhow::Result<()> {
    let view = webkit(view);
    let wk = &*view;
    unsafe {
        let window: *mut AnyObject = msg_send![wk, window];
        let window = window
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("The Web tab has no window."))?;
        let number: isize = msg_send![window, windowNumber];
        let info: *mut AnyObject = msg_send![class!(NSProcessInfo), processInfo];
        let timestamp: f64 = msg_send![info, systemUptime];
        match input {
            WebInput::Pointer { x, y, count } => {
                anyhow::ensure!(count <= 2, "Unsupported pointer click count.");
                let location = pointer_location(wk, x, y)?;
                let types: &[usize] = if count == 0 { &[5] } else { &[1, 2] };
                for ty in types {
                    let event: *mut AnyObject = msg_send![class!(NSEvent), mouseEventWithType: *ty,
                        location: location, modifierFlags: 0usize, timestamp: timestamp,
                        windowNumber: number, context: ptr::null::<AnyObject>(), eventNumber: 0isize,
                        clickCount: isize::from(count), pressure: 1.0f32];
                    match ty {
                        1 => {
                            let _: () = msg_send![wk, mouseDown: event];
                        }
                        2 => {
                            let _: () = msg_send![wk, mouseUp: event];
                        }
                        _ => {
                            // WebKit delivers MouseMoved through the owner of its tracking area.
                            let areas: *mut AnyObject = msg_send![wk, trackingAreas];
                            let count: usize = msg_send![areas, count];
                            let mut sent = false;
                            for index in 0..count {
                                let area: *mut AnyObject = msg_send![areas, objectAtIndex: index];
                                let options: usize = msg_send![area, options];
                                if options & 2 == 0 {
                                    continue;
                                } // NSTrackingMouseMoved
                                let owner: *mut AnyObject = msg_send![area, owner];
                                let handles_move: Bool =
                                    msg_send![owner, respondsToSelector: sel!(mouseMoved:)];
                                if handles_move.as_bool() {
                                    let _: () = msg_send![owner, mouseMoved: event];
                                    sent = true;
                                    break;
                                }
                            }
                            if !sent {
                                let _: () = msg_send![wk, mouseMoved: event];
                            }
                        }
                    }
                }
            }
            WebInput::Wheel {
                x,
                y,
                delta_x,
                delta_y,
            } => {
                let location = pointer_location(wk, x, y)?;
                anyhow::ensure!(
                    (-2000..=2000).contains(&delta_x)
                        && (-2000..=2000).contains(&delta_y)
                        && (delta_x != 0 || delta_y != 0),
                    "Send bounded, nonzero scroll deltas."
                );
                let cg =
                    CGEventCreateScrollWheelEvent2(ptr::null_mut(), 0, 2, -delta_y, -delta_x, 0);
                anyhow::ensure!(!cg.is_null(), "Cannot create a WebKit wheel event.");
                // The event is delivered directly. Encode window-local coordinates in
                // the CoreGraphics point so NSEvent presents the position WebKit expects.
                let screens: *mut AnyObject = msg_send![class!(NSScreen), screens];
                let primary: *mut AnyObject = msg_send![screens, firstObject];
                let screen: ObjcRect = msg_send![primary, frame];
                CGEventSetLocation(
                    cg,
                    ObjcPoint {
                        x: location.x,
                        y: screen.size.height - location.y,
                    },
                );
                let event: *mut AnyObject = msg_send![class!(NSEvent), eventWithCGEvent: cg];
                CFRelease(cg);
                anyhow::ensure!(
                    !event.is_null(),
                    "AppKit could not represent the wheel event."
                );
                let _: () = msg_send![wk, scrollWheel: event];
            }
            WebInput::Key { key, modifiers } => {
                let (code, ch) = match key.as_str() {
                    "Enter" => (36, '\r'),
                    "Tab" => (48, '\t'),
                    "Escape" => (53, '\u{1b}'),
                    "Backspace" => (51, '\u{7f}'),
                    "Delete" => (117, '\u{f728}'),
                    "ArrowLeft" => (123, '\u{f702}'),
                    "ArrowRight" => (124, '\u{f703}'),
                    "ArrowDown" => (125, '\u{f701}'),
                    "ArrowUp" => (126, '\u{f700}'),
                    "Home" => (115, '\u{f729}'),
                    "End" => (119, '\u{f72b}'),
                    "PageUp" => (116, '\u{f72c}'),
                    "PageDown" => (121, '\u{f72d}'),
                    "Space" | " " => (49, ' '),
                    value if value.len() == 1 => {
                        let ch = value.chars().next().unwrap();
                        let (codes, alphabet) = (
                            [
                                0, 11, 8, 2, 14, 3, 5, 4, 34, 38, 40, 37, 46, 45, 31, 35, 12, 15,
                                1, 17, 32, 9, 13, 7, 16, 6, 29, 18, 19, 20, 21, 23, 22, 26, 28, 25,
                            ],
                            "abcdefghijklmnopqrstuvwxyz0123456789",
                        );
                        let index = alphabet
                            .find(ch.to_ascii_lowercase())
                            .ok_or_else(|| anyhow::anyhow!("Unsupported key."))?;
                        (codes[index], ch)
                    }
                    _ => anyhow::bail!("Unsupported key."),
                };
                let mut flags = 0usize;
                for modifier in modifiers.unwrap_or_default() {
                    flags |= 1
                        << match modifier.as_str() {
                            "Shift" => 17,
                            "Control" => 18,
                            "Alt" => 19,
                            "Meta" => 20,
                            _ => anyhow::bail!("Unsupported key modifier."),
                        };
                }
                let characters = std::ffi::CString::new(
                    if flags & (1 << 17) != 0 {
                        ch.to_ascii_uppercase()
                    } else {
                        ch
                    }
                    .to_string(),
                )?;
                let plain = std::ffi::CString::new(ch.to_ascii_lowercase().to_string())?;
                let text: *mut AnyObject =
                    msg_send![class!(NSString), stringWithUTF8String: characters.as_ptr()];
                let plain: *mut AnyObject =
                    msg_send![class!(NSString), stringWithUTF8String: plain.as_ptr()];
                for ty in [10usize, 11] {
                    let event: *mut AnyObject = msg_send![class!(NSEvent), keyEventWithType: ty,
                        location: ObjcPoint { x: 0., y: 0. }, modifierFlags: flags, timestamp: timestamp,
                        windowNumber: number, context: ptr::null::<AnyObject>(), characters: text,
                        charactersIgnoringModifiers: plain, isARepeat: Bool::NO, keyCode: code as u16];
                    if ty == 10 {
                        let _: () = msg_send![wk, keyDown: event];
                    } else {
                        let _: () = msg_send![wk, keyUp: event];
                    }
                }
            }
        }
    }
    Ok(())
}
