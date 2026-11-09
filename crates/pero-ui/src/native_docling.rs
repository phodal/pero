//! Private native-shell consent. App input can request a component, never approve it.
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::sync::{Mutex, mpsc};

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Component {
    Software,
    Model,
}

#[derive(Deserialize)]
#[serde(tag = "operation", rename_all = "lowercase", deny_unknown_fields)]
pub(crate) enum Input {
    Status {},
    Request { component: Component },
    Cancel {},
    Revoke {},
}

#[derive(Clone, Deserialize, Serialize)]
pub(crate) struct Prompt {
    pub id: u64,
    pub summary: String,
    pub revoke: bool,
    #[serde(default)]
    pub action: Option<String>,
}

struct Pending {
    id: u64,
    owner: String,
    cancelled: bool,
    answer: Option<mpsc::Sender<bool>>,
}
#[derive(Default)]
struct Consent {
    next: u64,
    pending: Option<Pending>,
}
#[derive(Default)]
pub(crate) struct NativeDocling(Mutex<Consent>);

impl NativeDocling {
    pub fn pending(&self, id: u64) -> bool {
        self.0
            .lock()
            .unwrap()
            .pending
            .as_ref()
            .is_some_and(|pending| {
                pending.id == id && !pending.cancelled && pending.answer.is_some()
            })
    }

    /// Called only from the trusted Rust dialog, never a WebView IPC handler.
    pub fn answer(&self, id: u64, allowed: bool) {
        let mut state = self.0.lock().unwrap();
        if let Some(pending) = state.pending.as_mut().filter(|pending| pending.id == id) {
            if let Some(answer) = pending.answer.take() {
                let _ = answer.send(allowed && !pending.cancelled);
            }
        }
    }

    pub fn cancel(&self) -> Option<u64> {
        let mut state = self.0.lock().unwrap();
        let pending = state.pending.as_mut()?;
        pending.cancelled = true;
        if let Some(answer) = pending.answer.take() {
            let _ = answer.send(false);
        }
        Some(pending.id)
    }

    fn cancel_matching(&self, matches: impl Fn(&str) -> bool) -> Option<u64> {
        let mut state = self.0.lock().unwrap();
        let pending = state.pending.as_mut().filter(|pending| matches(&pending.owner))?;
        pending.cancelled = true;
        if let Some(answer) = pending.answer.take() { let _ = answer.send(false); }
        Some(pending.id)
    }
    fn cancel_owner(&self, owner: &str) -> Option<u64> { self.cancel_matching(|value| value == owner) }
    pub fn cancel_canvases(&self) -> Option<u64> { self.cancel_matching(|value| value.starts_with("canvas:")) }
    pub fn cancel_canvas(&self, instance: &str) -> Option<u64> { self.cancel_owner(&format!("canvas:{instance}")) }

    /// Same private consent queue as installation. A WebView can request, never answer.
    pub fn confirm_canvas(&self, instance: &str, summary: String,
        show: impl Fn(Prompt) -> Result<(), String>, dismiss: impl Fn(u64)) -> Result<bool, String> {
        let (answer, result) = mpsc::channel();
        let id = {
            let mut state = self.0.lock().unwrap();
            if state.pending.is_some() { return Err("Finish the current confirmation first".into()); }
            state.next += 1;
            let id = state.next;
            state.pending = Some(Pending { id, owner: format!("canvas:{instance}"), cancelled: false, answer: Some(answer) });
            id
        };
        if show(Prompt { id, summary, revoke: false, action: Some("Run declared App action".into()) }).is_err() { self.answer(id, false); }
        let allowed = result.recv().unwrap_or(false);
        let accepted = self.0.lock().unwrap().pending.take().is_some_and(|pending| pending.id == id && !pending.cancelled && allowed);
        dismiss(id);
        Ok(accepted)
    }

    pub fn apply(
        &self,
        input: Input,
        host: impl Fn(Value) -> Result<Value, String>,
        show: impl Fn(Prompt) -> Result<(), String>,
        dismiss: impl Fn(u64),
    ) -> Result<Value, String> {
        match input {
            Input::Status {} => return host(json!({"operation":"status"})).map(public_status),
            Input::Cancel {} => {
                if let Some(id) = self.cancel_owner("docling") {
                    dismiss(id);
                }
                return host(json!({"operation":"cancel"})).map(public_status);
            }
            _ => {}
        }
        let (answer, result) = mpsc::channel();
        let id = {
            let mut state = self.0.lock().unwrap();
            if state.pending.is_some() {
                return Err("Finish the current confirmation first".into());
            }
            state.next += 1;
            let id = state.next;
            state.pending = Some(Pending {
                id,
                owner: "docling".into(),
                cancelled: false,
                answer: Some(answer),
            });
            id
        };
        let value = (|| {
            let (ticket, summary, revoke) = match input {
                Input::Request { component } => {
                    let prepared = host(json!({"operation":"prepare","component":component}))?;
                    if prepared["state"] != "requires-approval" {
                        return Ok(prepared);
                    }
                    let ticket = prepared["ticket"]
                        .as_str()
                        .filter(|value| !value.is_empty() && value.len() <= 256);
                    let summary = prepared["summary"]
                        .as_str()
                        .filter(|value| !value.is_empty() && value.len() <= 16000);
                    if prepared["component"] != json!(component)
                        || ticket.is_none()
                        || summary.is_none()
                    {
                        return Err("Invalid Host installation confirmation".into());
                    }
                    (
                        Some(ticket.unwrap().to_owned()),
                        summary.unwrap().to_owned(),
                        false,
                    )
                }
                Input::Revoke {} => {
                    host(json!({"operation":"cancel"}))?;
                    (None, "Disable optional Docling OCR. Downloaded files are retained. Your papers, evidence and manual values are unchanged. Enabling OCR again requires installation approval.".into(), true)
                }
                _ => unreachable!(),
            };
            if !self.pending(id) {
                return host(json!({"operation":"cancel"}));
            }
            if show(Prompt {
                id,
                summary,
                revoke,
                action: None,
            })
            .is_err()
            {
                self.answer(id, false);
            }
            // No polling or renderer callback. Window/tab close and Cancel wake this wait.
            let allowed = result.recv().unwrap_or(false);
            let cancelled = self
                .0
                .lock()
                .unwrap()
                .pending
                .as_ref()
                .is_none_or(|pending| pending.id != id || pending.cancelled);
            // This is the shell's consent handoff. Later cancellation goes to
            // Host: it either invalidates this ticket or cancels its installer.
            // Never keep the UI consent mutex locked across Host process I/O.
            host(if allowed && !cancelled {
                ticket.map_or_else(
                    || json!({"operation":"revoke"}),
                    |ticket| json!({"operation":"install","ticket":ticket}),
                )
            } else {
                json!({"operation":"cancel"})
            })
        })();
        if value.is_err() {
            let _ = host(json!({"operation":"cancel"}));
        }
        // The pending slot remains occupied until the request has fully unwound.
        self.0.lock().unwrap().pending = None;
        dismiss(id);
        value.map(public_status)
    }
}

fn public_status(value: Value) -> Value {
    let fields = [
        "state",
        "software",
        "model",
        "component",
        "profile",
        "message",
        "installerSupported",
        "softwareApproved",
        "modelApproved",
    ];
    Value::Object(
        fields
            .into_iter()
            .filter_map(|key| {
                let field = value.get(key)?;
                let valid = match key {
                    "installerSupported" | "softwareApproved" | "modelApproved" => {
                        field.is_boolean()
                    }
                    "component" | "profile" => field.is_string() || field.is_null(),
                    _ => field.is_string(),
                };
                valid.then(|| (key.to_owned(), field.clone()))
            })
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canvas_consent_is_private_scoped_and_dismissed_on_close() {
        for decision in ["approve","deny","close","cancel","unavailable"] {
            let queue=NativeDocling::default();
            let allowed=queue.confirm_canvas("one","Exact saved source and action".into(),|prompt| {
                assert!(prompt.action.is_some());
                assert!(queue.cancel_canvas("other").is_none());
                assert!(queue.confirm_canvas("two","Another".into(), |_|panic!("overlapping prompt"), |_|{}).is_err());
                match decision {
                    "approve"=>queue.answer(prompt.id,true),
                    "deny"=>queue.answer(prompt.id,false),
                    "close"=>{queue.cancel();queue.answer(prompt.id,true);},
                    "cancel"=>{queue.cancel_canvas("one");queue.answer(prompt.id,true);},
                    _=>return Err("UI unavailable".into()),
                }
                Ok(())
            },|id|assert!(!queue.pending(id))).unwrap();
            assert_eq!(allowed,decision=="approve");
        }
    }

    fn prepared(component: Component) -> Value {
        json!({"state":"requires-approval","component":component,"summary":"Fixed official component, size and source","ticket":"private-ticket"})
    }

    #[test]
    fn apps_cannot_supply_consent_or_installation_parameters() {
        for body in [
            json!({"operation":"install","ticket":"forged"}),
            json!({"operation":"prepare","component":"software"}),
            json!({"operation":"request","component":"software","approved":true}),
            json!({"operation":"request","component":"model","url":"https://example.com"}),
            json!({"operation":"revoke","approved":true}),
            json!({"operation":"status","ticket":"forged"}),
            json!({"operation":"request","component":"other"}),
        ] {
            assert!(serde_json::from_value::<Input>(body).is_err());
        }
        for body in [
            json!({"operation":"status"}),
            json!({"operation":"cancel"}),
            json!({"operation":"revoke"}),
            json!({"operation":"request","component":"software"}),
            json!({"operation":"request","component":"model"}),
        ] {
            assert!(serde_json::from_value::<Input>(body).is_ok());
        }
    }

    #[test]
    fn only_a_live_explicit_native_decision_can_install_each_component() {
        for component in [Component::Software, Component::Model] {
            for decision in [
                "approve",
                "cancel",
                "close",
                "cancel-then-approve",
                "approve-then-cancel",
                "unavailable",
            ] {
                let setup = NativeDocling::default();
                let requests = Mutex::new(Vec::new());
                let status = setup.apply(Input::Request { component }, |request| {
                    requests.lock().unwrap().push(request.clone());
                    if request["operation"] == "prepare" { Ok(prepared(component)) }
                    else { Ok(json!({"state":"idle","ticket":"never-public","summary":"private","softwareApproved":false})) }
                }, |prompt| {
                    assert!(setup.pending(prompt.id));
                    assert!(setup.apply(Input::Request { component }, |_| panic!("duplicate Host request"), |_| unreachable!(), |_| {}).is_err());
                    match decision {
                        "approve" => setup.answer(prompt.id, true),
                        "cancel" => setup.answer(prompt.id, false),
                        "close" => { setup.cancel(); },
                        "cancel-then-approve" => { setup.cancel(); setup.answer(prompt.id, true); },
                        "approve-then-cancel" => { setup.answer(prompt.id, true); setup.cancel(); },
                        _ => return Err("UI unavailable".into()),
                    }
                    Ok(())
                }, |_| {}).unwrap();
                assert_eq!(
                    requests.lock().unwrap().last().unwrap()["operation"],
                    if decision == "approve" {
                        "install"
                    } else {
                        "cancel"
                    }
                );
                assert_eq!(status, json!({"state":"idle","softwareApproved":false}));
            }
        }
    }

    #[test]
    fn revocation_requires_its_own_confirmation_and_stale_answers_do_nothing() {
        let setup = NativeDocling::default();
        for allowed in [false, true] {
            let requests = Mutex::new(Vec::new());
            setup
                .apply(
                    Input::Revoke {},
                    |request| {
                        requests
                            .lock()
                            .unwrap()
                            .push(request["operation"].as_str().unwrap().to_owned());
                        Ok(json!({"state":"idle"}))
                    },
                    |prompt| {
                        assert!(prompt.revoke);
                        if prompt.id > 1 {
                            setup.answer(prompt.id - 1, true);
                            assert!(setup.pending(prompt.id));
                        }
                        setup.answer(prompt.id, allowed);
                        setup.answer(prompt.id, !allowed);
                        Ok(())
                    },
                    |_| {},
                )
                .unwrap();
            assert_eq!(
                *requests.lock().unwrap(),
                vec!["cancel", if allowed { "revoke" } else { "cancel" }]
            );
        }
    }
}
