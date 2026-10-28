use super::*;
use std::{collections::BTreeMap, sync::mpsc, time::Instant};

#[test]
fn unsupported_protocol_never_creates_a_ready_session() {
    let (_handle, rx) = launch("unsupported_protocol", None);
    let deadline = Instant::now() + Duration::from_secs(5);
    let mut failed = false;
    loop {
        let event = rx
            .recv_timeout(deadline.saturating_duration_since(Instant::now()))
            .unwrap();
        assert_ne!(event.kind, "session_ready");
        assert_ne!(event.kind, "turn_started");
        assert_ne!(
            event.kind, "session_update",
            "session/new was sent after an unsupported protocol version"
        );
        if event.kind == "session_error" {
            failed = true;
        }
        if event.kind == "session_closed" {
            break;
        }
    }
    assert!(
        failed,
        "protocol mismatch must be reported, not silently closed"
    );
}

fn launch(scenario: &str, model: Option<&str>) -> (SessionHandle, mpsc::Receiver<HostEvent>) {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    let config = AgentConfig {
        id: "fixture".into(),
        name: "Lifecycle fixture".into(),
        command: "node".into(),
        args: vec![
            root.join("tests/runtime/lifecycle-agent.mjs")
                .to_string_lossy()
                .into(),
        ],
        env: BTreeMap::from([("PERO_FIXTURE_SCENARIO".into(), scenario.into())]),
        model: model.map(str::to_owned),
        mcp_servers: vec![],
        memory: None,
    };
    let (tx, rx) = mpsc::channel();
    (start(config, root, "fixture-thread".into(), tx), rx)
}

#[test]
fn dsh_wire_empty_model_options_and_minimal_permission_are_supported() {
    let (handle, rx) = launch("dsh_wire", None);
    let ready = until(&rx, "session_ready");
    assert_eq!(ready.data["configOptions"], json!([]));
    handle
        .tx
        .send(SessionCommand::Prompt("permission".into()))
        .unwrap();
    let permission = until(&rx, "permission");
    let id = permission.data["permission_id"].as_str().unwrap();
    handle
        .permissions
        .lock()
        .unwrap()
        .remove(id)
        .unwrap()
        .send(None)
        .unwrap();
    assert_eq!(
        until(&rx, "session_update").data["content"]["text"],
        "permission:cancelled"
    );
    until(&rx, "turn_finished");
    close(&handle, &rx);
}

#[test]
fn dsh_wire_text_and_tool_updates_are_supported_without_a_model_setter() {
    let (handle, rx) = launch("dsh_wire", None);
    until(&rx, "session_ready");
    handle
        .tx
        .send(SessionCommand::Prompt("updates".into()))
        .unwrap();
    for kind in ["agent_message_chunk", "tool_call", "tool_call_update"] {
        assert_eq!(until(&rx, "session_update").data["sessionUpdate"], kind);
    }
    assert_eq!(until(&rx, "turn_finished").data["stopReason"], "end_turn");
    close(&handle, &rx);
}
fn until(rx: &mpsc::Receiver<HostEvent>, kind: &str) -> HostEvent {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let event = rx
            .recv_timeout(deadline.saturating_duration_since(Instant::now()))
            .unwrap_or_else(|error| panic!("waiting for {kind}: {error}"));
        if event.kind == kind {
            return event;
        }
        assert_ne!(
            event.kind, "session_closed",
            "session closed while waiting for {kind}: {}",
            event.text
        );
    }
}
fn close(handle: &SessionHandle, rx: &mpsc::Receiver<HostEvent>) {
    handle.tx.send(SessionCommand::Close).unwrap();
    until(rx, "session_closed");
}
#[test]
fn authentication_is_explicit_and_keeps_the_connection_for_retry() {
    let (handle, rx) = launch("auth", Some("model-b"));
    let required = until(&rx, "session_auth_required");
    assert_eq!(required.data["authMethods"].as_array().unwrap().len(), 2);
    assert!(
        rx.recv_timeout(Duration::from_millis(100)).is_err(),
        "authentication must not run automatically"
    );
    handle
        .tx
        .send(SessionCommand::Authenticate("unknown".into()))
        .unwrap();
    assert!(until(&rx, "session_auth_error").text.contains("Unknown"));
    handle
        .tx
        .send(SessionCommand::Authenticate("terminal-login".into()))
        .unwrap();
    assert!(
        until(&rx, "session_auth_error")
            .text
            .contains("interactive terminal")
    );
    handle
        .tx
        .send(SessionCommand::Authenticate("login".into()))
        .unwrap();
    let ready = until(&rx, "session_ready");
    assert_eq!(ready.data["configOptions"][0]["currentValue"], "model-b");
    handle
        .tx
        .send(SessionCommand::Prompt("after-login".into()))
        .unwrap();
    assert_eq!(
        until(&rx, "session_update").data["content"]["text"],
        "turn-1:after-login"
    );
    until(&rx, "turn_finished");
    close(&handle, &rx);
}
#[test]
fn followup_messages_are_queued_instead_of_discarded_during_generation() {
    let (handle, rx) = launch("", None);
    until(&rx, "session_ready");
    handle
        .tx
        .send(SessionCommand::Prompt("first".into()))
        .unwrap();
    until(&rx, "turn_started");
    handle
        .tx
        .send(SessionCommand::Prompt("second".into()))
        .unwrap();
    until(&rx, "prompt_queued");
    until(&rx, "turn_finished");
    until(&rx, "turn_started");
    assert_eq!(
        until(&rx, "session_update").data["content"]["text"],
        "turn-2:second"
    );
    until(&rx, "turn_finished");
    close(&handle, &rx);
}
#[test]
fn invalid_permission_selection_is_cancelled_and_session_remains_usable() {
    let (handle, rx) = launch("", None);
    until(&rx, "session_ready");
    handle
        .tx
        .send(SessionCommand::Prompt("permission".into()))
        .unwrap();
    let permission = until(&rx, "permission");
    let id = permission.data["permission_id"].as_str().unwrap();
    handle
        .permissions
        .lock()
        .unwrap()
        .remove(id)
        .unwrap()
        .send(Some("not-advertised".into()))
        .unwrap();
    assert_eq!(
        until(&rx, "session_update").data["content"]["text"],
        "permission:cancelled"
    );
    until(&rx, "turn_finished");
    assert!(handle.permissions.lock().unwrap().is_empty());
    close(&handle, &rx);
}
#[test]
fn cancellation_clears_pending_permissions_without_requiring_host_cleanup() {
    let (handle, rx) = launch("", None);
    until(&rx, "session_ready");
    handle
        .tx
        .send(SessionCommand::Prompt("permission".into()))
        .unwrap();
    until(&rx, "permission");
    assert_eq!(handle.permissions.lock().unwrap().len(), 1);
    handle.tx.send(SessionCommand::Cancel).unwrap();
    until(&rx, "turn_finished");
    assert!(handle.permissions.lock().unwrap().is_empty());
    close(&handle, &rx);
}
#[test]
fn unacknowledged_cancellation_closes_the_session_after_a_bound() {
    let (handle, rx) = launch("ignore_cancel", None);
    until(&rx, "session_ready");
    handle
        .tx
        .send(SessionCommand::Prompt("wait".into()))
        .unwrap();
    until(&rx, "turn_started");
    let started = Instant::now();
    handle.tx.send(SessionCommand::Cancel).unwrap();
    assert!(
        until(&rx, "session_error")
            .text
            .contains("did not acknowledge cancellation")
    );
    until(&rx, "session_closed");
    assert!(started.elapsed() < Duration::from_secs(3));
}
#[test]
fn close_interrupts_initialization_and_model_failure_never_marks_ready() {
    let (handle, rx) = launch("initialization_hangs", None);
    until(&rx, "session_connecting");
    let started = Instant::now();
    close(&handle, &rx);
    assert!(started.elapsed() < Duration::from_secs(1));
    let (_handle, rx) = launch("bad_model", Some("model-b"));
    loop {
        let event = rx.recv_timeout(Duration::from_secs(5)).unwrap();
        assert_ne!(event.kind, "session_ready");
        if event.kind == "session_closed" {
            break;
        }
    }
}

#[test]
fn prompt_time_authentication_requires_explicit_login_and_a_new_user_prompt() {
    let (handle, rx) = launch("prompt_auth", None);
    let ready = until(&rx, "session_ready");
    let session_id = ready.data["sessionId"].clone();
    handle
        .tx
        .send(SessionCommand::Prompt("needs-login".into()))
        .unwrap();
    until(&rx, "turn_started");
    handle
        .tx
        .send(SessionCommand::Prompt("must-not-replay".into()))
        .unwrap();
    until(&rx, "prompt_queued");
    let rejected = until(&rx, "command_rejected");
    assert_eq!(rejected.data["count"], 1);
    let required = until(&rx, "session_auth_required");
    assert_eq!(required.data["authMethods"][0]["id"], "login");
    handle
        .tx
        .send(SessionCommand::Authenticate("login".into()))
        .unwrap();
    let authenticated = until(&rx, "session_authenticated");
    assert_eq!(authenticated.data["sessionId"], session_id);
    assert!(
        rx.recv_timeout(Duration::from_millis(150)).is_err(),
        "authentication must not replay any previous prompt"
    );
    handle
        .tx
        .send(SessionCommand::Prompt("explicit-retry".into()))
        .unwrap();
    until(&rx, "turn_started");
    assert_eq!(
        until(&rx, "session_update").data["content"]["text"],
        "turn-2:explicit-retry"
    );
    until(&rx, "turn_finished");
    close(&handle, &rx);
}

#[test]
fn legacy_model_advertisement_and_updates_survive_the_current_sdk() {
    let (handle, rx) = launch("legacy_models", Some("model-b"));
    let ready = until(&rx, "session_ready");
    assert_eq!(ready.data["models"]["currentModelId"], "model-b");
    assert_eq!(
        ready.data["models"]["availableModels"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    handle
        .tx
        .send(SessionCommand::Model("model-a".into()))
        .unwrap();
    let update = until(&rx, "session_update");
    assert_eq!(update.data["sessionUpdate"], "current_model_update");
    assert_eq!(update.data["currentModelId"], "model-a");
    assert_eq!(
        until(&rx, "model_changed").data["models"]["currentModelId"],
        "model-a"
    );
    handle
        .tx
        .send(SessionCommand::Prompt("after-model-change".into()))
        .unwrap();
    assert_eq!(
        until(&rx, "session_update").data["content"]["text"],
        "turn-1:after-model-change"
    );
    until(&rx, "turn_finished");
    close(&handle, &rx);
}

#[test]
fn modern_model_config_takes_precedence_over_legacy_models() {
    let (handle, rx) = launch("both_models", Some("model-b"));
    assert_eq!(
        until(&rx, "session_ready").data["configOptions"][0]["currentValue"],
        "model-b"
    );
    handle
        .tx
        .send(SessionCommand::Model("model-a".into()))
        .unwrap();
    assert_eq!(
        until(&rx, "model_changed").data["configOptions"][0]["currentValue"],
        "model-a"
    );
    close(&handle, &rx);
}

#[test]
fn model_changes_require_an_advertised_id_for_each_supported_api() {
    for scenario in ["", "legacy_models", "no_models"] {
        let (handle, rx) = launch(scenario, None);
        until(&rx, "session_ready");
        handle
            .tx
            .send(SessionCommand::Model("unadvertised".into()))
            .unwrap();
        assert!(until(&rx, "session_error").text.contains("not advertised"));
        handle
            .tx
            .send(SessionCommand::Prompt("still-usable".into()))
            .unwrap();
        assert_eq!(
            until(&rx, "session_update").data["content"]["text"],
            "turn-1:still-usable"
        );
        until(&rx, "turn_finished");
        close(&handle, &rx);
    }
}

fn launch_mcp(scenario: &str, servers: Value) -> (SessionHandle, mpsc::Receiver<HostEvent>) {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    // Exercise the same operator JSON deserialization as the registry, not a hand-built request.
    let config: AgentConfig = serde_json::from_value(json!({
        "id": "mcp-fixture", "name": "MCP fixture", "command": "node",
        "args": [root.join("tests/runtime/lifecycle-agent.mjs")],
        "env": {"PERO_FIXTURE_SCENARIO": scenario, "PERO_EXPECT_MCP": servers.to_string()},
        "mcp_servers": servers
    }))
    .unwrap();
    let public = config.public().to_string();
    for secret in [
        "fixture-env-secret",
        "fixture-header-secret",
        "fixture-arg-secret",
    ] {
        assert!(!public.contains(secret));
        assert!(!format!("{config:?}").contains(secret));
    }
    assert!(config.public().get("mcp_servers").is_none());
    let (tx, rx) = mpsc::channel();
    (start(config, root, "mcp-fixture".into(), tx), rx)
}

fn mcp_servers() -> Value {
    json!([
        {"name":"stdio", "command":"/fixture/not-executed", "args":["fixture-arg-secret"], "env":[{"name":"TOKEN","value":"fixture-env-secret"}]},
        {"type":"http", "name":"http", "url":"https://fixture.invalid/mcp", "headers":[{"name":"Authorization","value":"fixture-header-secret"}]},
        {"type":"sse", "name":"sse", "url":"http://127.0.0.1:9/sse", "headers":[]}
    ])
}

#[test]
fn mcp_operator_config_reaches_wire_and_survives_auth_retry_and_cancellation() {
    let (handle, rx) = launch_mcp("mcp_auth", mcp_servers());
    until(&rx, "session_auth_required");
    handle
        .tx
        .send(SessionCommand::Authenticate("login".into()))
        .unwrap();
    until(&rx, "session_ready");
    handle
        .tx
        .send(SessionCommand::Prompt("wait".into()))
        .unwrap();
    until(&rx, "turn_started");
    handle.tx.send(SessionCommand::Cancel).unwrap();
    assert_eq!(until(&rx, "turn_finished").data["stopReason"], "cancelled");
    close(&handle, &rx);
}

#[test]
fn mcp_defaults_forward_empty_list() {
    let config: AgentConfig =
        serde_json::from_value(json!({"id":"old", "name":"old", "command":"node"})).unwrap();
    assert!(config.mcp_servers.is_empty());
    let (handle, rx) = launch_mcp("mcp", json!([]));
    until(&rx, "session_ready");
    close(&handle, &rx);
}

#[test]
fn mcp_invalid_config_fails_before_connecting_or_child_spawn() {
    let invalid = [
        json!([{"name":"bad","command":"relative","args":[],"env":[]}]),
        json!([{"type":"http","name":"bad","url":"file:///fixture-header-secret","headers":[]}]),
        json!([{"type":"http","name":"bad","url":"http://[broken","headers":[]}]),
        json!([{"type":"http","name":"bad","url":"https://fixture.invalid","headers":[{"name":"Authorization","value":"fixture-header-secret\r\nInjected: yes"}]}]),
        json!([{"name":"bad","command":"/fixture","args":[],"env":[{"name":"BAD=KEY","value":"fixture-env-secret"}]}]),
        json!([{"name":"same","command":"/fixture","args":[],"env":[]},{"name":"same","command":"/fixture","args":[],"env":[]}]),
    ];
    for servers in invalid {
        let (_handle, rx) = launch_mcp("mcp", servers);
        let error = rx.recv_timeout(Duration::from_secs(5)).unwrap();
        assert_eq!(
            error.kind, "session_error",
            "validation must precede connecting/spawn"
        );
        assert!(!error.text.contains("secret"));
        assert_eq!(
            rx.recv_timeout(Duration::from_secs(5)).unwrap().kind,
            "session_closed"
        );
    }
}

#[test]
fn mcp_unadvertised_remote_transport_never_creates_session() {
    let (_handle, rx) = launch_mcp("mcp_unsupported", mcp_servers());
    let error = until(&rx, "session_error");
    assert!(error.text.contains("does not support MCP HTTP"));
    until(&rx, "session_closed");
}

#[test]
fn mcp_malformed_operator_json_is_rejected_without_secret_details() {
    for server in [
        json!({"type":"http", "name":"bad", "command":"/fixture", "args":[], "env":[]}),
        json!({"type":"sse", "name":"bad", "command":"/fixture", "args":[], "env":[]}),
        json!({"type":null, "name":"bad", "command":"/fixture", "args":[], "env":[]}),
        json!({"type":"unknown", "name":"bad", "command":"/fixture", "args":[], "env":[]}),
        json!({"type":"http", "name":"bad", "url":"https://fixture.invalid", "headers":"fixture-header-secret"}),
    ] {
        let error = serde_json::from_value::<AgentConfig>(
            json!({"id":"fixture", "name":"fixture", "command":"node", "mcp_servers":[server]}),
        )
        .unwrap_err();
        assert!(!error.to_string().contains("fixture-header-secret"));
    }
}

#[test]
fn initialization_timeout_remains_bounded() {
    let started = Instant::now();
    let (_handle, rx) = launch("initialization_hangs", None);
    let error = until(&rx, "session_error");
    assert!(error.text.contains("Agent initialization timed out"));
    until(&rx, "session_closed");
    assert!(started.elapsed() >= SETUP_TIMEOUT);
    assert!(started.elapsed() < Duration::from_secs(5));
}

/// Launch with operator JSON that may enable memory. `expected` is what the
/// fixture Agent must receive as `mcpServers` on the wire.
fn launch_memory(memory: Value, expected: Value) -> (SessionHandle, mpsc::Receiver<HostEvent>) {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    let config: AgentConfig = serde_json::from_value(json!({
        "id": "memory-fixture", "name": "Memory fixture", "command": "node",
        "args": [root.join("tests/runtime/lifecycle-agent.mjs")],
        "env": {"PERO_FIXTURE_SCENARIO": "mcp", "PERO_EXPECT_MCP": expected.to_string()},
        "memory": memory
    }))
    .unwrap();
    assert!(config.public().get("memory").is_none());
    let (tx, rx) = mpsc::channel();
    (start(config, root, "memory-fixture".into(), tx), rx)
}

fn memory_json(enabled: bool, engram: &std::path::Path, data_dir: &std::path::Path) -> Value {
    json!({"enabled": enabled, "engram": engram, "data_dir": data_dir,
        "project": "synthetic-project", "mutations": "approve"})
}

#[test]
fn memory_is_off_by_default_and_sends_no_extra_server() {
    let dir = std::env::temp_dir().join("pero-memory-off");
    let (handle, rx) = launch_memory(
        memory_json(false, &dir.join("absent"), &dir.join("data")),
        json!([]),
    );
    until(&rx, "session_ready");
    close(&handle, &rx);
    assert!(!dir.exists(), "disabled memory must not touch the filesystem");
}

#[test]
fn memory_enabled_sends_exactly_the_documented_entry() {
    let binary = std::env::current_exe().unwrap();
    let data_dir = std::env::temp_dir().join("pero-memory-wire");
    let quoted = |path: &std::path::Path| {
        let text = serde_json::to_string(path).unwrap();
        text[1..text.len() - 1].to_owned()
    };
    let golden = include_str!("../fixtures/engram-memory/mcp-server.json")
        .replace("{{ENGRAM_BIN}}", &quoted(&binary))
        .replace("{{DATA_DIR}}", &quoted(&data_dir))
        .replace("{{PROJECT}}", "synthetic-project");
    let expected = json!([serde_json::from_str::<Value>(&golden).unwrap()]);
    let (handle, rx) = launch_memory(memory_json(true, &binary, &data_dir), expected);
    until(&rx, "session_ready");
    close(&handle, &rx);
    assert!(
        !data_dir.exists(),
        "Pero must leave creating the data directory to Engram"
    );
}

#[test]
fn memory_with_a_missing_binary_fails_before_connecting() {
    let dir = std::env::temp_dir().join("pero-memory-missing-binary");
    let (_handle, rx) = launch_memory(
        memory_json(true, &dir.join("engram"), &dir.join("data")),
        json!([]),
    );
    let error = rx.recv_timeout(Duration::from_secs(5)).unwrap();
    assert_eq!(error.kind, "session_error", "must precede connecting/spawn");
    assert!(error.text.contains("Engram binary is not available"));
    assert_eq!(
        rx.recv_timeout(Duration::from_secs(5)).unwrap().kind,
        "session_closed"
    );
    assert!(!dir.exists());
}
