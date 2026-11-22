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
    web_document::{WebAddress, WebLoad},
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{ffi::CStr, ptr};

use crate::native_web::{ObjcPoint, ObjcRect};

pub(super) struct WebGrant {
    id: uuid::Uuid,
    thread: String,
    origin: String,
}

impl WebGrant {
    pub(super) fn matches(&self, value: &str) -> bool {
        origin(value).is_some_and(|candidate| candidate == self.origin)
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
    Run {
        thread: String,
        tab: String,
        stamp: String,
        operation: WebOperation,
    },
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum WebOperation {
    Check,
    Evaluate { script: String },
    Navigate { url: String },
    Dispatch { input: WebInput },
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum WebInput {
    Pointer {
        x: f64,
        y: f64,
        count: u8,
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
        _window: &mut Window,
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
                        let available = tab.browser_view(cx).ok();
                        let url = available.and_then(|(view, _)| view.url().ok())
                            .unwrap_or_else(|| tab.document.observation.url.as_str().to_owned());
                        if !grant.matches(&url) { return None; }
                        let id = &tab.document.id;
                        let active = self.navigation.current() == Some(&WorkspaceItem::Web(id.clone()));
                        Some(json!({"tabId":id,"origin":grant.origin,"url":url,"title":tab.document.observation.title.chars().take(160).collect::<String>(),
                            "visible":available.is_some(),"active":active,"stamp":available.map(|(_, generation)| format!("{}:{generation}:{url}",grant.id))}))
                    }).collect();
                    Ok(Some(json!(tabs)))
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
                    let (raw, generation) = view.browser_view(cx)?;
                    let url = raw.url()?;
                    anyhow::ensure!(
                        grant.matches(&url) && stamp == format!("{}:{generation}:{url}", grant.id),
                        "The Web tab or document changed."
                    );
                    match operation {
                        WebOperation::Check => Ok(Some(Value::Null)),
                        WebOperation::Evaluate { script } => {
                            let request = request.clone();
                            let apps = apps.clone();
                            evaluate(raw, &script, move |reply| {
                                reply_browser(&apps, &request, reply)
                            });
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
                        WebOperation::Dispatch { input } => {
                            anyhow::ensure!(
                                self.navigation.current() == Some(&WorkspaceItem::Web(tab)),
                                "Select the authorized Web tab before sending input."
                            );
                            dispatch(raw, input)?;
                            Ok(Some(Value::Null))
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

fn evaluate(view: &wry::WebView, script: &str, reply: impl Fn(anyhow::Result<Value>) + 'static) {
    use wry::WebViewExtMacOS;
    let Ok(source) = std::ffi::CString::new(format!("JSON.stringify({script})")) else {
        reply(Err(anyhow::anyhow!("Invalid Browser Use script.")));
        return;
    };
    let view = view.webview();
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
        let _: () = msg_send![&*(std::ptr::from_ref(&*view).cast::<AnyObject>()),
            evaluateJavaScript: source, inFrame: ptr::null::<AnyObject>(), inContentWorld: &**world, completionHandler: &*handler];
    });
}

pub(super) fn window_visible(view: &wry::WebView) -> bool {
    use wry::WebViewExtMacOS;
    let view = view.webview();
    unsafe {
        let wk = &*(std::ptr::from_ref(&*view).cast::<AnyObject>());
        let window: *mut AnyObject = msg_send![wk, window];
        let visible: Bool = msg_send![window, isVisible];
        let minimized: Bool = msg_send![window, isMiniaturized];
        visible.as_bool() && !minimized.as_bool()
    }
}

fn dispatch(view: &wry::WebView, input: WebInput) -> anyhow::Result<()> {
    use wry::WebViewExtMacOS;
    let view = view.webview();
    let wk = unsafe { &*(std::ptr::from_ref(&*view).cast::<AnyObject>()) };
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
                let bounds: ObjcRect = msg_send![wk, bounds];
                let flipped: Bool = msg_send![wk, isFlipped];
                let zoom: f64 = msg_send![wk, pageZoom];
                let (x, y) = (x * zoom, y * zoom);
                anyhow::ensure!(
                    x >= 0.
                        && y >= 0.
                        && x < bounds.size.width
                        && y < bounds.size.height
                        && count <= 2,
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
                let location: ObjcPoint =
                    msg_send![wk, convertPoint: point, toView: ptr::null::<AnyObject>()];
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
