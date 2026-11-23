//! WebKit owns the suspended script; this delegate owns its sheet and answer.
use super::WebGrant;
use block2::{DynBlock, RcBlock};
use objc2::{
    DefinedClass, MainThreadOnly, define_class, msg_send,
    rc::Retained,
    runtime::{AnyObject, Bool, NSObject, NSObjectProtocol, ProtocolObject, Sel},
};
use objc2_app_kit::{
    NSAlert, NSAlertFirstButtonReturn, NSModalResponseCancel, NSTextField, NSWindow,
};
use objc2_foundation::{NSSize, NSString};
use objc2_web_kit::{WKFrameInfo, WKUIDelegate, WKWebView};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{cell::RefCell, ptr, rc::Rc};
use uuid::Uuid;
use wry::WebViewExtMacOS;

#[derive(Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(super) enum Decision {
    Accept,
    Dismiss,
}

enum Completion {
    Alert(RcBlock<dyn Fn()>),
    Confirm(RcBlock<dyn Fn(Bool)>),
    Prompt(RcBlock<dyn Fn(*mut NSString)>),
}

impl Completion {
    fn kind(&self) -> &'static str {
        match self {
            Self::Alert(_) => "alert",
            Self::Confirm(_) => "confirm",
            Self::Prompt(_) => "prompt",
        }
    }

    fn answer(self, accept: bool, text: Option<&str>) {
        match self {
            Self::Alert(reply) => reply.call(()),
            Self::Confirm(reply) => reply.call((Bool::new(accept),)),
            Self::Prompt(reply) => {
                let text = text.map(NSString::from_str);
                reply.call((text
                    .as_deref()
                    .map_or(ptr::null_mut(), |value| ptr::from_ref(value).cast_mut()),));
            }
        }
    }
}

struct PendingDialog {
    id: Uuid,
    publication: Option<(Uuid, Uuid)>,
    origin: String,
    message: String,
    completion: Completion,
    sheet: Retained<NSWindow>,
}

impl PendingDialog {
    fn end_sheet(&self) {
        if let Some(parent) = self.sheet.sheetParent() {
            parent.endSheet_returnCode(&self.sheet, NSModalResponseCancel);
        }
    }
}

type Evaluation = Box<dyn FnOnce(anyhow::Result<Value>)>;

#[derive(Default)]
struct DialogState {
    pending: Option<PendingDialog>,
    revision: u64,
    evaluation: Option<(Uuid, Evaluation)>,
}

impl DialogState {
    fn take(&mut self) -> Option<PendingDialog> {
        let pending = self.pending.take()?;
        self.revision += 1;
        Some(pending)
    }
}

pub(crate) struct DelegateIvars {
    fallback: Retained<AnyObject>,
    state: Rc<RefCell<DialogState>>,
}

impl Drop for DelegateIvars {
    fn drop(&mut self) {
        let (pending, evaluation) = {
            let mut state = self.state.borrow_mut();
            (state.take(), state.evaluation.take())
        };
        if let Some(pending) = pending {
            pending.end_sheet();
            pending.completion.answer(false, None);
        }
        if let Some((_, reply)) = evaluation {
            reply(Err(anyhow::anyhow!(
                "The Web tab closed before the page replied."
            )));
        }
    }
}

define_class!(
    #[unsafe(super(NSObject))]
    #[name = "PeroBrowserDialogDelegate"]
    #[thread_kind = MainThreadOnly]
    #[ivars = DelegateIvars]
    pub(crate) struct DialogDelegate;

    unsafe impl NSObjectProtocol for DialogDelegate {
        #[unsafe(method(respondsToSelector:))]
        fn responds(&self, selector: Sel) -> Bool {
            unsafe {
                let local: Bool = msg_send![super(self), respondsToSelector: selector];
                if local.as_bool() { local } else { msg_send![&*self.ivars().fallback, respondsToSelector: selector] }
            }
        }
    }

    impl DialogDelegate {
        #[unsafe(method_id(forwardingTargetForSelector:))]
        fn forward(&self, _selector: Sel) -> Retained<AnyObject> { self.ivars().fallback.clone() }
    }

    unsafe impl WKUIDelegate for DialogDelegate {
        #[unsafe(method(webView:runJavaScriptAlertPanelWithMessage:initiatedByFrame:completionHandler:))]
        fn alert(&self, view: &WKWebView, message: &NSString, frame: &WKFrameInfo, reply: &DynBlock<dyn Fn()>) {
            self.present(view, frame, message, None, Completion::Alert(reply.copy()));
        }

        #[unsafe(method(webView:runJavaScriptConfirmPanelWithMessage:initiatedByFrame:completionHandler:))]
        fn confirm(&self, view: &WKWebView, message: &NSString, frame: &WKFrameInfo, reply: &DynBlock<dyn Fn(Bool)>) {
            self.present(view, frame, message, None, Completion::Confirm(reply.copy()));
        }

        #[unsafe(method(webView:runJavaScriptTextInputPanelWithPrompt:defaultText:initiatedByFrame:completionHandler:))]
        fn prompt(&self, view: &WKWebView, message: &NSString, default: Option<&NSString>, frame: &WKFrameInfo,
            reply: &DynBlock<dyn Fn(*mut NSString)>) {
            self.present(view, frame, message, default, Completion::Prompt(reply.copy()));
        }
    }
);

impl DialogDelegate {
    pub(crate) fn install(view: &wry::WebView) -> Option<Retained<Self>> {
        let view = view.webview();
        let fallback = unsafe { Retained::cast_unchecked(view.UIDelegate()?) };
        let this = Self::alloc(view.mtm()).set_ivars(DelegateIvars {
            fallback,
            state: Rc::default(),
        });
        let this: Retained<Self> = unsafe { msg_send![super(this), init] };
        // WebKit keeps a weak delegate reference; the tab owns `this`.
        unsafe {
            view.setUIDelegate(Some(ProtocolObject::from_ref(&*this)));
        }
        Some(this)
    }

    fn present(
        &self,
        view: &WKWebView,
        frame: &WKFrameInfo,
        message: &NSString,
        default: Option<&NSString>,
        completion: Completion,
    ) {
        let security = unsafe { frame.securityOrigin() };
        let scheme = unsafe { security.protocol() }.to_string();
        let host = unsafe { security.host() }.to_string();
        let port = unsafe { security.port() };
        let host = if host.contains(':') && !host.starts_with('[') {
            format!("[{host}]")
        } else {
            host
        };
        let address = if port > 0 {
            format!("{scheme}://{host}:{port}")
        } else {
            format!("{scheme}://{host}")
        };
        let identity = super::origin(&address).zip(view.window());
        let state = &self.ivars().state;
        let Some((origin, parent)) = identity.filter(|(_, window)| {
            !view.isHiddenOrHasHiddenAncestor()
                && window.isVisible()
                && window.attachedSheet().is_none()
                && state.borrow().pending.is_none()
        }) else {
            completion.answer(false, None);
            return;
        };
        let message: String = message.to_string().chars().take(2048).collect();
        let alert = NSAlert::new(view.mtm());
        alert.setMessageText(&NSString::from_str(&origin));
        alert.setInformativeText(&NSString::from_str(&message));
        alert.addButtonWithTitle(&NSString::from_str("OK"));
        if !matches!(completion, Completion::Alert(_)) {
            alert.addButtonWithTitle(&NSString::from_str("Cancel"));
        }
        let input = matches!(completion, Completion::Prompt(_)).then(|| {
            let default: String = default
                .map(ToString::to_string)
                .unwrap_or_default()
                .chars()
                .take(4096)
                .collect();
            let input = NSTextField::textFieldWithString(&NSString::from_str(&default), view.mtm());
            input.setFrameSize(NSSize::new(320., 24.));
            alert.setAccessoryView(Some(&input));
            input
        });
        let id = Uuid::new_v4();
        let mut current = state.borrow_mut();
        current.revision += 1;
        current.pending = Some(PendingDialog {
            id,
            publication: None,
            origin,
            message,
            completion,
            sheet: alert.window(),
        });
        let evaluation = current.evaluation.take();
        drop(current);
        let weak = Rc::downgrade(state);
        let done = RcBlock::new(move |response| {
            let Some(state) = weak.upgrade() else { return };
            let pending = {
                let mut state = state.borrow_mut();
                if !state.pending.as_ref().is_some_and(|dialog| dialog.id == id) {
                    return;
                }
                state.take().unwrap()
            };
            let accept = response == NSAlertFirstButtonReturn;
            let text = input
                .as_ref()
                .filter(|_| accept)
                .map(|input| input.stringValue().to_string());
            pending.completion.answer(accept, text.as_deref());
        });
        alert.beginSheetModalForWindow_completionHandler(&parent, Some(&done));
        if let Some((_, reply)) = evaluation {
            reply(Err(anyhow::anyhow!(
                "The page opened a JavaScript dialog. Read it with getJsDialog."
            )));
        }
    }

    pub(super) fn revision(&self) -> u64 {
        self.ivars().state.borrow().revision
    }
    pub(super) fn is_open(&self) -> bool {
        self.ivars().state.borrow().pending.is_some()
    }

    pub(super) fn observe(&self, grant: &WebGrant) -> Option<Value> {
        let mut state = self.ivars().state.borrow_mut();
        let dialog = state
            .pending
            .as_mut()
            .filter(|dialog| dialog.origin == grant.origin)?;
        let id = match dialog.publication {
            Some((owner, id)) if owner == grant.id => id,
            _ => {
                let id = Uuid::new_v4();
                dialog.publication = Some((grant.id, id));
                id
            }
        };
        Some(json!({"id":id,"type":dialog.completion.kind(),"message":dialog.message}))
    }

    pub(super) fn answer(
        &self,
        grant: &WebGrant,
        id: Uuid,
        decision: Decision,
        text: Option<String>,
    ) -> Value {
        let mut state = self.ivars().state.borrow_mut();
        let Some(dialog) = state.pending.as_ref().filter(|dialog| {
            dialog.origin == grant.origin && dialog.publication == Some((grant.id, id))
        }) else {
            return json!({"rejected":"The JavaScript dialog is no longer active. Read the dialog again."});
        };
        let accept = decision == Decision::Accept;
        let prompt = matches!(dialog.completion, Completion::Prompt(_));
        if accept && matches!(dialog.completion, Completion::Alert(_)) {
            return json!({"rejected":"This JavaScript dialog can only be dismissed."});
        }
        if prompt && accept && text.is_none() {
            return json!({"rejected":"Enter promptText to accept this prompt."});
        }
        if text.is_some() && !(prompt && accept) {
            return json!({"rejected":"promptText is only valid when accepting a prompt."});
        }
        let pending = state.take().unwrap();
        drop(state);
        pending.end_sheet();
        pending.completion.answer(accept, text.as_deref());
        Value::Null
    }

    pub(super) fn evaluation(&self, reply: Evaluation) -> impl Fn(anyhow::Result<Value>) + 'static {
        let state = &self.ivars().state;
        let id = Uuid::new_v4();
        state.borrow_mut().evaluation = Some((id, reply));
        let state = Rc::downgrade(state);
        move |result| {
            let Some(state) = state.upgrade() else { return };
            let reply = {
                let mut state = state.borrow_mut();
                if !state
                    .evaluation
                    .as_ref()
                    .is_some_and(|(owner, _)| *owner == id)
                {
                    return;
                }
                state.evaluation.take()
            };
            if let Some((_, reply)) = reply {
                reply(result);
            }
        }
    }
}
