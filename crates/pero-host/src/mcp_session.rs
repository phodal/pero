//! Routes a trusted shell request only to its current existing Agent session.
use super::Manager;
use pero_contracts::{
    HostEvent,
    mcp_session::{McpSessionError, McpSessionRequest},
};
use pero_runtime::acp::{SessionCommand, mcp_session_reply};
impl Manager {
    pub fn mcp_session_snapshot(
        &self,
        thread: &str,
    ) -> Option<pero_contracts::mcp_runtime::McpRuntimeSession> {
        self.sessions
            .get(thread)
            .map(|handle| handle.mcp_runtime.lock().unwrap().clone())
            .filter(|snapshot| !snapshot.closed && snapshot.session_id.is_some())
    }
    pub fn dispatch_mcp_session(&mut self, value: serde_json::Value) {
        self.dispatch_mcp_session_to(value, self.tx.clone());
    }
    pub fn dispatch_mcp_session_to(
        &mut self,
        value: serde_json::Value,
        reply_tx: std::sync::mpsc::Sender<HostEvent>,
    ) {
        if value["method"]=="mcp.message" {self.dispatch_mcp_message_to(value,reply_tx);return;}
        let request: McpSessionRequest = match serde_json::from_value(value.clone()) {
            Ok(request) => request,
            Err(_) => {
                let mut event = HostEvent::new(
                    "mcp_session_error",
                    value["request_id"].as_str().map(str::to_owned),
                    String::new(),
                );
                event.thread_id = value["thread_id"].as_str().map(str::to_owned);
                event.data = serde_json::json!({"incarnation":value["incarnation"].as_u64().unwrap_or(0),"revision":value["revision"].as_u64().unwrap_or(0),"reason":"invalid"});
                let _ = reply_tx.send(event);
                return;
            }
        };
        if let Err(error) = request.validate() {
            mcp_session_reply(&reply_tx, &request, Err(error));
            return;
        }
        let Some(handle) = self.sessions.get(&request.thread_id) else {
            mcp_session_reply(&reply_tx, &request, Err(McpSessionError::Unavailable));
            return;
        };
        if matches!(
            request.action,
            pero_contracts::mcp_session::McpSessionAction::Close
        ) {
            // Enqueue revocation, then clear its permission senders before the
            // main thread can process the next UI permission answer.
            let admitted = request
                .target()
                .admit(&handle.mcp_runtime.lock().unwrap(), true)
                .map(|_| ());
            if let Err(error) = admitted {
                mcp_session_reply(&reply_tx, &request, Err(error));
                return;
            }
            if handle
                .tx
                .send(SessionCommand::McpSession {
                    request: request.clone(),
                    reply: reply_tx.clone(),
                })
                .is_err()
            {
                mcp_session_reply(&reply_tx, &request, Err(McpSessionError::Unavailable));
            } else if let Some(binding) = &request.binding {
                handle.revoke_mcp_binding(binding);
            }
            return;
        }
        // The session loop checks capability and live generation at execution time.
        if handle
            .tx
            .send(SessionCommand::McpSession {
                request: request.clone(),
                reply: reply_tx.clone(),
            })
            .is_err()
        {
            mcp_session_reply(&reply_tx, &request, Err(McpSessionError::Unavailable));
        }
    }
}
impl Manager {
    fn dispatch_mcp_message_to(
        &mut self,
        value: serde_json::Value,
        reply: std::sync::mpsc::Sender<HostEvent>,
    ) {
        use pero_contracts::mcp_session::McpMessageRequest;
        let parsed = serde_json::from_value::<McpMessageRequest>(value.clone())
            .map_err(|_| McpSessionError::Invalid);
        let result = parsed.and_then(|request| {
            let target = request.validate()?;
            let snapshot = self
                .mcp_session_snapshot(&request.thread_id)
                .ok_or(McpSessionError::Unavailable)?;
            target.admit(&snapshot, true)?;
            self.command(pero_contracts::HostCommand::Prompt {
                thread_id: request.thread_id,
                text: request.text,
                contexts: vec![],
            }).then_some(()).ok_or(McpSessionError::Denied)
        });
        let mut event = HostEvent::new(
            if result.is_ok() {
                "mcp_session"
            } else {
                "mcp_session_error"
            },
            value["request_id"].as_str().map(str::to_owned),
            String::new(),
        );
        event.thread_id = value["thread_id"].as_str().map(str::to_owned);
        event.data = match result {
            Ok(()) => {
                serde_json::json!({"incarnation":value["incarnation"],"revision":value["revision"],"result":{}})
            }
            Err(reason) => {
                serde_json::json!({"incarnation":value["incarnation"],"revision":value["revision"],"reason":reason})
            }
        };
        let _ = reply.send(event);
    }
}
