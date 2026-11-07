//! Custom MCPs on the Connectors page use the same Host settings command.
//! This module only admits the request and returns the Host projection.
use crate::app::Workbench;
use gpui_kit::prelude::*;
use pero_chat_ui::conversation::AgentChoice;
use pero_contracts::HostEvent;
use serde_json::{Value, json};

pub(crate) struct McpAppWait {
    request_id: String,
    reply_id: String,
    app: String,
    panel: String,
}

#[derive(Debug)]
pub(crate) enum Prepare {
    View(Value),
    Request(Value),
}

fn agent_id(value: &Value) -> Result<&str, &'static str> {
    let id = value.as_str().ok_or("invalid")?;
    if id.len() > 128 || id.chars().any(char::is_control) {
        return Err("invalid");
    }
    Ok(id)
}

/// One App request becomes either an immediate empty view or a Host command body.
pub(crate) fn prepare(input: &Value, agents: &[AgentChoice]) -> Result<Prepare, &'static str> {
    if serde_json::to_string(input)
        .map(|text| text.len())
        .unwrap_or(usize::MAX)
        > 256_000
    {
        return Err("invalid");
    }
    let object = input.as_object().ok_or("invalid")?;
    let method = object
        .get("method")
        .and_then(Value::as_str)
        .ok_or("invalid")?;
    let requested = agent_id(object.get("agent_id").ok_or("invalid")?)?;
    if method == "settings.mcp.get" {
        if object.len() != 2 {
            return Err("invalid");
        }
        let id = if requested.is_empty() {
            agents
                .iter()
                .find(|agent| agent.available)
                .or_else(|| agents.first())
                .map(|agent| agent.id.as_str())
                .unwrap_or("")
        } else {
            requested
        };
        if id.is_empty() {
            return Ok(Prepare::View(
                json!({"agents": agents, "agent_id": "", "revision": 0, "servers": [], "sessions": []}),
            ));
        }
        return Ok(Prepare::Request(
            json!({"method": "settings.mcp.get", "agent_id": id}),
        ));
    }
    if method == "settings.mcp.set" {
        if object.len() != 4 || requested.is_empty() {
            return Err("invalid");
        }
        let revision = object
            .get("revision")
            .and_then(Value::as_u64)
            .filter(|revision| *revision <= 9_007_199_254_740_991)
            .ok_or("invalid")?;
        let servers = object
            .get("servers")
            .and_then(Value::as_array)
            .filter(|servers| servers.len() <= 64)
            .ok_or("invalid")?;
        return Ok(Prepare::Request(
            json!({"method": "settings.mcp.set", "agent_id": requested, "revision": revision, "servers": servers}),
        ));
    }
    Err("invalid")
}

pub(crate) fn view(agents: &[AgentChoice], data: &Value) -> Value {
    json!({
        "agents": agents,
        "agent_id": data.get("agent_id").cloned().unwrap_or(Value::String(String::new())),
        "revision": data.get("revision").cloned().unwrap_or(json!(0)),
        "servers": data.get("servers").cloned().unwrap_or(json!([])),
        "sessions": data.get("sessions").cloned().unwrap_or(json!([])),
    })
}

fn reason(data: &Value) -> &'static str {
    match data.get("reason").and_then(Value::as_str) {
        Some("conflict") => "conflict",
        Some("invalid") => "invalid",
        Some("read_write") => "read_write",
        _ => "unavailable",
    }
}

impl Workbench {
    pub(crate) fn begin_mcp_app(
        &mut self,
        reply_id: &str,
        app: &str,
        panel: &str,
        input: &Value,
        cx: &mut Context<Self>,
    ) -> Result<(), &'static str> {
        if self.mcp_app_wait.is_some() {
            return Err("unavailable");
        }
        let agents = self.chat.read(cx).agents.clone();
        match prepare(input, &agents)? {
            Prepare::View(value) => {
                self.send_mcp_reply(app, panel, reply_id, Ok(value), cx);
                Ok(())
            }
            Prepare::Request(mut request) => {
                self.next_request += 1;
                let request_id = format!("app-mcp-{}", self.next_request);
                request["request_id"] = json!(request_id.clone());
                if crate::app::session_command(&request.to_string()).is_err() {
                    return Err("unavailable");
                }
                self.mcp_app_wait = Some(McpAppWait {
                    request_id: request_id.clone(),
                    reply_id: reply_id.to_string(),
                    app: app.to_string(),
                    panel: panel.to_string(),
                });
                cx.spawn(async move |this, cx| {
                    cx.background_executor()
                        .timer(std::time::Duration::from_secs(15))
                        .await;
                    let _ = this.update(cx, |this, cx| {
                        if this
                            .mcp_app_wait
                            .as_ref()
                            .is_some_and(|wait| wait.request_id == request_id)
                        {
                            this.fail_mcp_app("unavailable", cx);
                        }
                    });
                })
                .detach();
                cx.notify();
                Ok(())
            }
        }
    }

    pub(crate) fn observe_mcp_app(&mut self, event: &HostEvent, cx: &mut Context<Self>) {
        if event.kind == "disconnected" {
            self.fail_mcp_app("unavailable", cx);
            return;
        }
        let Some(wait) = &self.mcp_app_wait else {
            return;
        };
        if event.request_id.as_deref() != Some(wait.request_id.as_str()) {
            return;
        };
        if event.kind == "mcp_settings" {
            let wait = self.mcp_app_wait.take().unwrap();
            let agents = self.chat.read(cx).agents.clone();
            let value = view(&agents, &event.data);
            self.send_mcp_reply(&wait.app, &wait.panel, &wait.reply_id, Ok(value), cx);
        } else if event.kind == "mcp_settings_error" || event.kind == "error" {
            self.fail_mcp_app(
                if event.kind == "mcp_settings_error" {
                    reason(&event.data)
                } else {
                    "unavailable"
                },
                cx,
            );
        }
    }

    fn fail_mcp_app(&mut self, reason: &'static str, cx: &mut Context<Self>) {
        let Some(wait) = self.mcp_app_wait.take() else {
            return;
        };
        self.send_mcp_reply(&wait.app, &wait.panel, &wait.reply_id, Err(reason), cx);
    }

    fn send_mcp_reply(
        &self,
        app: &str,
        panel: &str,
        reply_id: &str,
        result: Result<Value, &'static str>,
        cx: &mut Context<Self>,
    ) {
        let reply = match result {
            Ok(value) => {
                json!({"type":"pero:app:sdk-result","id":reply_id,"ok":true,"value":value})
            }
            Err(error) => {
                json!({"type":"pero:app:sdk-result","id":reply_id,"ok":false,"error":error})
            }
        };
        if let Some(page) = self
            .native_app_pages
            .get(&(app.to_string(), panel.to_string()))
        {
            page.view.update(cx, |page, cx| page.send(reply, cx));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn agent(id: &str, available: bool) -> AgentChoice {
        AgentChoice {
            id: id.into(),
            name: id.into(),
            available,
        }
    }

    #[test]
    fn prepare_picks_an_agent_or_returns_an_empty_view() {
        let empty = prepare(&json!({"method":"settings.mcp.get","agent_id":""}), &[]).unwrap();
        assert!(matches!(empty, Prepare::View(_)));
        let request = prepare(
            &json!({"method":"settings.mcp.get","agent_id":""}),
            &[agent("idle", false), agent("ready", true)],
        )
        .unwrap();
        match request {
            Prepare::Request(value) => assert_eq!(value["agent_id"], "ready"),
            other => panic!("{other:?}"),
        }
        assert!(
            prepare(
                &json!({"method":"settings.mcp.get","agent_id":"","token":"secret"}),
                &[agent("ready", true)]
            )
            .is_err()
        );
        let write = prepare(
            &json!({"method":"settings.mcp.set","agent_id":"ready","revision":1,"servers":[]}),
            &[],
        )
        .unwrap();
        match write {
            Prepare::Request(value) => assert_eq!(value["revision"], 1),
            other => panic!("{other:?}"),
        }
        assert!(
            prepare(
                &json!({"method":"settings.mcp.set","agent_id":"","revision":0,"servers":[]}),
                &[]
            )
            .is_err()
        );
    }
}
