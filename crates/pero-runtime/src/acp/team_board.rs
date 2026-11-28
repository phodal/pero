//! Read-only Team board on one admitted Host/ACP connection.
use agent_client_protocol::schema::v1::SessionId;
use agent_client_protocol::{Agent, ConnectionTo, UntypedMessage};
use pero_contracts::HostEvent;
use pero_contracts::mcp_runtime::McpRuntimeSession;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::sync::{Arc, Mutex, mpsc::Sender};

pub(super) const CAPABILITY: &str = "pero.teamBoard";
const METHOD: &str = "_pero/team/board";
const READ_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(8);

pub struct TeamBoardRead {
    pub request_id: String,
    pub thread_id: String,
    pub incarnation: u64,
    pub reply: Sender<HostEvent>,
}

#[derive(Deserialize, Serialize)]
struct TaskSummary {
    id: String,
    subject: String,
    revision: u64,
    status: TaskStatus,
    ready: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    owner: Option<String>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum TaskStatus {
    Pending,
    InProgress,
    Completed,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Board {
    session_id: String,
    revision: u64,
    enabled: bool,
    tasks: Vec<TaskSummary>,
}

fn project(response: Value, session_id: &str) -> Result<Value, &'static str> {
    let board: Board = serde_json::from_value(response).map_err(|_| "invalid_response")?;
    if board.session_id != session_id
        || board.tasks.len() > 256
        || (!board.enabled && !board.tasks.is_empty())
    {
        return Err("invalid_response");
    }
    // The shell receives only display fields, not model task descriptions or
    // internal metadata. Numeric task and board revisions belong to this root.
    Ok(json!({"revision":board.revision,"enabled":board.enabled,"tasks":board.tasks}))
}

impl TeamBoardRead {
    fn matches(&self, state: &McpRuntimeSession, session: &str) -> bool {
        !state.closed
            && self.thread_id == state.thread_id
            && self.incarnation == state.incarnation
            && state.session_id.as_deref() == Some(session)
    }

    pub fn finish(self, result: Result<Value, &'static str>) {
        let (kind, data) = match result {
            Ok(board) => (
                "team_board",
                json!({"incarnation":self.incarnation,"board":board}),
            ),
            Err(reason) => (
                "team_board_error",
                json!({"incarnation":self.incarnation,"reason":reason}),
            ),
        };
        let mut event = HostEvent::new(kind, Some(self.request_id), String::new());
        event.thread_id = Some(self.thread_id);
        event.data = data;
        let _ = self.reply.send(event);
    }
}

pub(super) fn dispatch(
    connection: &ConnectionTo<Agent>,
    session: &SessionId,
    available: bool,
    live: Arc<Mutex<McpRuntimeSession>>,
    request: TeamBoardRead,
) {
    let session_id = session.to_string();
    if !request.matches(&live.lock().unwrap(), &session_id) {
        request.finish(Err("stale"));
        return;
    }
    if !available {
        request.finish(Err("unsupported"));
        return;
    }
    let Ok(message) = UntypedMessage::new(METHOD, json!({"sessionId":session})) else {
        request.finish(Err("unavailable"));
        return;
    };
    let response = connection.send_request(message).block_task();
    tokio::spawn(async move {
        let result = tokio::time::timeout(READ_TIMEOUT, response).await;
        if !request.matches(&live.lock().unwrap(), &session_id) {
            request.finish(Err("stale"));
            return;
        }
        request.finish(match result {
            Ok(Ok(board)) => project(board, &session_id),
            _ => Err("unavailable"),
        });
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn board_is_validated_against_the_exact_session_and_only_exposes_display_fields() {
        let mut board = json!({"sessionId":"b","revision":5,"enabled":true,
            "tasks":[{"id":"1","subject":"Verify","description":"hidden","status":"in_progress","revision":2,"ready":false}]});
        assert_eq!(project(board.clone(), "a"), Err("invalid_response"));
        assert_eq!(
            project(board.clone(), "b").unwrap()["tasks"][0],
            json!({"id":"1","subject":"Verify","status":"in_progress","revision":2,"ready":false})
        );
        board["enabled"] = json!(false);
        assert_eq!(project(board, "b"), Err("invalid_response"));
    }
}
