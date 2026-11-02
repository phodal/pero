//! Negotiated structured input. This inbox never authorizes a tool operation.
use agent_client_protocol::{JsonRpcMessage, JsonRpcRequest, Responder, UntypedMessage};
use pero_contracts::{
    HostEvent,
    user_questions::{PendingQuestions, QuestionReply, QuestionRequest},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
        mpsc::Sender,
    },
};
use tokio::sync::oneshot;

pub(super) const CAPABILITY: &str = "pero.userQuestions";
const ASK: &str = "_pero/user_questions/ask";
pub(super) const CANCEL: &str = "_pero/user_questions/cancel";

struct Pending {
    request: QuestionRequest,
    answer: oneshot::Sender<QuestionReply>,
}

#[derive(Default)]
struct State {
    negotiated: bool,
    session: Option<String>,
    pending: BTreeMap<String, Pending>,
}

pub struct QuestionInbox {
    state: Mutex<State>,
    tx: Sender<HostEvent>,
    thread: String,
}

impl QuestionInbox {
    pub(super) fn new(tx: Sender<HostEvent>, thread: String) -> Self {
        Self {
            state: Mutex::default(),
            tx,
            thread,
        }
    }

    pub(super) fn negotiate(&self, supported: bool) {
        self.state.lock().unwrap().negotiated = supported;
    }

    pub(super) fn bind(&self, session: String) {
        self.state.lock().unwrap().session = Some(session);
    }

    fn emit(&self, kind: &str, data: Value) {
        let mut event = HostEvent::new(kind, None, String::new());
        event.thread_id = Some(self.thread.clone());
        event.data = data;
        let _ = self.tx.send(event);
    }

    fn resolved(&self, id: &str, tool: &str) {
        self.emit(
            "user_questions_resolved",
            json!({"request_id":id,"toolCallId":tool}),
        );
    }

    fn ask(
        &self,
        request: QuestionRequest,
    ) -> agent_client_protocol::Result<(String, oneshot::Receiver<QuestionReply>)> {
        request
            .validate()
            .map_err(|_| agent_client_protocol::Error::invalid_params())?;
        let mut state = self.state.lock().unwrap();
        if !state.negotiated {
            return Err(agent_client_protocol::Error::method_not_found());
        }
        if state.session.as_deref() != Some(request.session_id.as_str())
            || state
                .pending
                .values()
                .any(|pending| pending.request.tool_call_id == request.tool_call_id)
        {
            return Err(agent_client_protocol::Error::invalid_params());
        }
        static NEXT: AtomicU64 = AtomicU64::new(1);
        let id = format!("question-{}", NEXT.fetch_add(1, Ordering::Relaxed));
        let (answer, reply) = oneshot::channel();
        let event = PendingQuestions {
            request_id: id.clone(),
            request: request.clone(),
        };
        state
            .pending
            .insert(id.clone(), Pending { request, answer });
        self.emit(
            "user_questions",
            serde_json::to_value(event)
                .map_err(agent_client_protocol::Error::into_internal_error)?,
        );
        Ok((id, reply))
    }

    /// Invalid or incomplete input leaves the original request available for retry.
    pub fn finish(&self, request_id: &str, reply: QuestionReply) -> Result<(), String> {
        let mut state = self.state.lock().unwrap();
        let pending = state
            .pending
            .get(request_id)
            .ok_or("This question is no longer active")?;
        reply.validate(&pending.request).map_err(str::to_owned)?;
        let pending = state
            .pending
            .remove(request_id)
            .expect("validated pending question");
        let result = pending
            .answer
            .send(reply)
            .map_err(|_| "This question is no longer active".to_owned());
        self.resolved(request_id, &pending.request.tool_call_id);
        result
    }

    fn cancel_id(&self, request_id: &str) {
        let mut state = self.state.lock().unwrap();
        if let Some(pending) = state.pending.remove(request_id) {
            let _ = pending.answer.send(QuestionReply::Cancelled {});
            self.resolved(request_id, &pending.request.tool_call_id);
        }
    }

    pub(super) fn cancel(&self, value: Value) {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        struct Cancel {
            session_id: String,
            tool_call_id: String,
        }
        let Ok(cancel) = serde_json::from_value::<Cancel>(value) else {
            return;
        };
        let mut state = self.state.lock().unwrap();
        if !state.negotiated || state.session.as_deref() != Some(cancel.session_id.as_str()) {
            return;
        }
        let id = state
            .pending
            .iter()
            .find(|(_, pending)| pending.request.tool_call_id == cancel.tool_call_id)
            .map(|(id, _)| id.clone());
        if let Some(id) = id {
            let pending = state
                .pending
                .remove(&id)
                .expect("selected pending question");
            let _ = pending.answer.send(QuestionReply::Cancelled {});
            self.resolved(&id, &pending.request.tool_call_id);
        }
    }

    pub fn clear(&self) {
        let mut state = self.state.lock().unwrap();
        for (id, pending) in std::mem::take(&mut state.pending) {
            let _ = pending.answer.send(QuestionReply::Cancelled {});
            self.resolved(&id, &pending.request.tool_call_id);
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(transparent)]
pub(super) struct AskQuestions(QuestionRequest);

impl JsonRpcMessage for AskQuestions {
    fn matches_method(method: &str) -> bool {
        method == ASK
    }
    fn method(&self) -> &'static str {
        ASK
    }
    fn to_untyped_message(&self) -> agent_client_protocol::Result<UntypedMessage> {
        UntypedMessage::new(ASK, &self.0)
    }
    fn parse_message(
        _method: &str,
        params: &impl Serialize,
    ) -> agent_client_protocol::Result<Self> {
        serde_json::to_value(params)
            .and_then(serde_json::from_value)
            .map_err(|_| agent_client_protocol::Error::invalid_params())
    }
}
impl JsonRpcRequest for AskQuestions {
    type Response = Value;
}

pub(super) fn receive(
    inbox: Arc<QuestionInbox>,
    request: AskQuestions,
    responder: Responder<Value>,
) -> agent_client_protocol::Result<()> {
    let (id, reply) = match inbox.ask(request.0) {
        Ok(pending) => pending,
        Err(error) => return responder.respond_with_error(error),
    };
    // SDK handlers are serial dispatch. Retain the responder in a task so a
    // pending human answer cannot block cancellation notifications or responses.
    tokio::spawn(async move {
        let cancellation = responder.cancellation();
        let reply = tokio::select! {
            reply = reply => reply.unwrap_or(QuestionReply::Cancelled {}),
            _ = cancellation.cancelled() => { inbox.cancel_id(&id); QuestionReply::Cancelled {} },
        };
        let _ = responder.respond_with_result(
            serde_json::to_value(reply).map_err(agent_client_protocol::Error::into_internal_error),
        );
    });
    Ok(())
}

#[cfg(test)]
#[path = "../../../../tests/runtime/acp_user_questions.rs"]
mod tests;
