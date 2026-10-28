use super::*;
use std::{collections::BTreeMap, sync::mpsc, time::Instant};

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
    };
    let (tx, rx) = mpsc::channel();
    (start(config, root, "fixture-thread".into(), tx), rx)
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
        if kind == "configuration_changed" {
            assert_ne!(event.kind,"session_error","setting acknowledgement failed: {}",event.text);
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
fn session_settings_follow_agent_acknowledgements() {
    for scenario in ["settings", "legacy_modes"] {
        let (handle,rx) = launch(scenario,None);
        let ready = until(&rx,"session_ready");
        assert!(ready.data["peroSettings"]["options"].as_array().unwrap().iter().any(|option|
            option["id"]=="mode" && option["current"]=="agent"));
        handle.tx.send(SessionCommand::Configure{id:"mode".into(),value:"plan".into()}).unwrap();
        let confirmed = until(&rx,"configuration_changed");
        assert!(confirmed.data["options"].as_array().unwrap().iter().any(|option|
            option["id"]=="mode" && option["current"]=="plan"));
        handle.tx.send(SessionCommand::Configure{id:"mode".into(),value:"injected".into()}).unwrap();
        assert!(until(&rx,"session_error").text.contains("not advertised"));
        if scenario=="settings" {
            handle.tx.send(SessionCommand::Configure{id:"effort".into(),value:"low".into()}).unwrap();
            let confirmed=until(&rx,"configuration_changed");
            assert!(confirmed.data["options"].as_array().unwrap().iter().any(|option|
                option["id"]=="effort" && option["current"]=="low"));
            handle.tx.send(SessionCommand::Configure{id:"effort".into(),value:"high".into()}).unwrap();
            assert!(until(&rx,"session_error").text.contains("rejected"));
        }
        handle.tx.send(SessionCommand::Prompt("still-usable".into())).unwrap();
        assert_eq!(until(&rx,"session_update").data["content"]["text"],"turn-1:still-usable");
        until(&rx,"turn_finished");
        close(&handle,&rx);
    }
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
