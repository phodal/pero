//! Transport into the scientific kernel owned by this ACP Agent session.
use agent_client_protocol::schema::v1::SessionId;
use agent_client_protocol::{Agent, ConnectionTo, UntypedMessage};
use pero_contracts::HostEvent;
use serde_json::{Value, json};
use std::sync::mpsc::Sender;

pub(super) const CAPABILITY: &str = "pero.scienceSession";
const METHOD: &str = "_pero/science/session";

pub struct ScienceRequest {
    pub request_id: String,
    pub thread_id: String,
    pub command: Value,
    pub reply: Sender<HostEvent>,
}

impl ScienceRequest {
    pub fn reply(self, result: Result<Value, String>) {
        let mut event = HostEvent::new("apps_result", Some(self.request_id), String::new());
        event.thread_id = Some(self.thread_id);
        event.data = match result {
            Ok(value) => json!({"ok":true,"value":value}),
            Err(error) => json!({"ok":false,"error":error}),
        };
        let _ = self.reply.send(event);
    }
}

/// The Agent returns promptly for execution and owns its running cell. Keeping
/// the request off the command loop also leaves interrupt and approvals usable.
pub(super) fn dispatch(
    connection: &ConnectionTo<Agent>,
    session: &SessionId,
    negotiated: bool,
    request: ScienceRequest,
) {
    if !negotiated {
        request.reply(Err(
            "This Agent does not expose a shared science session; select the Pero Agent".into(),
        ));
        return;
    }
    let message = match UntypedMessage::new(
        METHOD,
        json!({"sessionId":session,"request":request.command}),
    ) {
        Ok(message) => message,
        Err(error) => {
            request.reply(Err(error.to_string()));
            return;
        }
    };
    let response = connection.send_request(message).block_task();
    tokio::spawn(async move {
        let result = tokio::time::timeout(super::session::SETUP_TIMEOUT, response)
            .await
            .map_err(|_| {
                "Science session request timed out; check its status before retrying".to_owned()
            })
            .and_then(|result| result.map_err(|error| error.to_string()));
        request.reply(result);
    });
}
