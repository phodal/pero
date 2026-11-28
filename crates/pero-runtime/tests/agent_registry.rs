//! Exercise the built-in registry through real ACP processes, without provider I/O.
use pero_contracts::HostEvent;
use pero_runtime::acp::{self, SessionCommand, SupervisedPermission};
use std::{path::PathBuf, process::Command, sync::mpsc, time::Duration};

struct FixtureRoot(PathBuf);
impl Drop for FixtureRoot {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[test]
fn node_adapters_connect_and_reconnect() {
    let root = std::env::temp_dir().join(format!("pero adapters {}", uuid::Uuid::new_v4()));
    let cleanup = FixtureRoot(root);
    let root = &cleanup.0;
    std::fs::create_dir_all(root.join("node_modules/.bin")).unwrap();
    std::fs::create_dir(root.join("adapters")).unwrap();
    let runtime = root.join("packages/agent-runtime");
    std::fs::create_dir_all(&runtime).unwrap();
    std::fs::copy(PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../packages/agent-runtime/windows-background.cjs"),
        runtime.join("windows-background.cjs")).unwrap();
    let fixture =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../tests/runtime/lifecycle-agent.mjs");
    for adapter in ["codex-acp", "claude-agent-acp"] {
        let package = root.join("node_modules/@agentclientprotocol").join(adapter);
        std::fs::create_dir_all(package.join("dist")).unwrap();
        std::fs::write(package.join("package.json"), r#"{"type":"module"}"#).unwrap();
        std::fs::copy(&fixture, package.join("dist/index.js")).unwrap();
        std::fs::copy(
            &fixture,
            root.join("adapters").join(format!("{adapter}.mjs")),
        )
        .unwrap();
        // npm creates this Unix shim even on Windows; it is not a Win32 executable.
        std::fs::write(
            root.join("node_modules/.bin").join(adapter),
            "#!/bin/sh\nexit 1\n",
        )
        .unwrap();
    }
    let node = Command::new("node")
        .args(["-p", "process.execPath"])
        .output()
        .unwrap();
    assert!(node.status.success());
    let node = String::from_utf8(node.stdout).unwrap().trim().to_owned();
    let custom = root.join("custom.json");
    std::fs::write(
        &custom,
        serde_json::to_vec(&serde_json::json!([{
            "id":"codex", "name":"Custom Codex", "command":node,
            "args":["--no-warnings", fixture],
            "supervision":"gate",
            "env":{"PERO_FIXTURE_SCENARIO":"dsh_wire", "ELECTRON_RUN_AS_NODE":"1"}
        }]))
        .unwrap(),
    )
    .unwrap();
    for mode in ["development", "path-node", "packaged", "custom", "missing"] {
        // Isolate process environment instead of mutating the test runner's globals.
        let mut child = Command::new(std::env::current_exe().unwrap());
        child
            .args([
                "--ignored",
                "--exact",
                "adapter_registry_child",
                "--nocapture",
            ])
            .current_dir(&root)
            .env("PERO_AGENT_ROOT", &root)
            .env("PERO_AGENTS_FILE", root.join("absent.json"))
            .env("PERO_APP_NODE", &node)
            .env("PERO_FIXTURE_SCENARIO", "dsh_wire")
            .env_remove("PERO_ADAPTER_NODE");
        match mode {
            "path-node" => {
                child.env_remove("PERO_APP_NODE");
            }
            "packaged" => {
                child.env("PERO_ADAPTER_NODE", &node);
            }
            "custom" => {
                child.env("PERO_AGENTS_FILE", &custom);
            }
            "missing" => {
                for adapter in ["codex-acp", "claude-agent-acp"] {
                    std::fs::remove_file(
                        root.join("node_modules/@agentclientprotocol")
                            .join(adapter)
                            .join("dist/index.js"),
                    )
                    .unwrap();
                }
                child.env("PERO_TEST_MISSING_ADAPTER", "1");
            }
            _ => {}
        }
        let result = child.output().unwrap();
        assert!(
            result.status.success(),
            "{mode}:\n{}\n{}",
            String::from_utf8_lossy(&result.stdout),
            String::from_utf8_lossy(&result.stderr)
        );
    }
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
#[ignore = "executed in an isolated registry environment by the parent test"]
fn adapter_registry_child() {
    let workspace = std::env::current_dir().unwrap();
    let registry = acp::registry(&workspace).unwrap();
    for id in ["codex", "claude"] {
        let config = registry.iter().find(|agent| agent.id == id).unwrap();
        if std::env::var_os("PERO_TEST_MISSING_ADAPTER").is_some() {
            assert!(!config.available(), "{id} needs its adapter, not just Node");
            continue;
        }
        assert!(
            config.available(),
            "{id} must be available before connecting"
        );
        for attempt in 0..2 {
            let (tx, rx) = mpsc::channel();
            let handle = acp::start_supervised(
                config.clone(),
                workspace.clone(),
                format!("{id}-{attempt}"),
                tx,
                SupervisedPermission::ReadOnlyDsh,
            );
            wait_for(&rx, "session_ready");
            handle.tx.send(SessionCommand::Close).unwrap();
            wait_for(&rx, "session_closed");
        }
    }
}

fn wait_for(events: &mpsc::Receiver<HostEvent>, kind: &str) {
    loop {
        let event = events.recv_timeout(Duration::from_secs(10)).unwrap();
        assert_ne!(event.kind, "session_error", "{}", event.text);
        if event.kind == kind {
            return;
        }
        assert_ne!(event.kind, "session_closed", "closed before {kind}");
    }
}

#[test]
fn supervised_dsh_requires_read_only_acknowledgement_before_prompt() {
    let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/runtime/lifecycle-agent.mjs");
    let root = FixtureRoot(std::env::temp_dir().join(format!("pero dsh worker {}", uuid::Uuid::new_v4())));
    std::fs::create_dir(&root.0).unwrap();
    for (scenario, permission, expected_mode, expected_error) in [
        ("dsh_worker_ready", SupervisedPermission::ReadOnlyDsh, Some("read-only"), None),
        ("dsh_worker_no_selector", SupervisedPermission::ReadOnlyDsh, None, Some("not advertised")),
        ("dsh_worker_rejected", SupervisedPermission::ReadOnlyDsh, None, Some("Fixture rejected read-only")),
        ("dsh_worker_wrong_ack", SupervisedPermission::ReadOnlyDsh, None, Some("did not acknowledge")),
        ("dsh_worker_wrong_name", SupervisedPermission::ReadOnlyDsh, None, Some("not a DSH")),
        ("dsh_worker_no_info", SupervisedPermission::ReadOnlyDsh, None, Some("not a DSH")),
        ("dsh_worker_ready", SupervisedPermission::AskDsh, Some("full-access"), None),
        ("dsh_worker_wrong_ack", SupervisedPermission::AskDsh, None, Some("did not acknowledge")),
        ("dsh_worker_wrong_name", SupervisedPermission::AskDsh, None, Some("not a DSH")),
        ("dsh_worker_no_info", SupervisedPermission::AskDsh, None, Some("not a DSH")),
    ] {
        let config = serde_json::from_value(serde_json::json!({
            "id": "dsh-alias", "name": "Worker Agent", "command": "node",
            "args": [&fixture], "env": {"PERO_FIXTURE_SCENARIO": scenario}
        })).unwrap();
        let (tx, rx) = mpsc::channel();
        let handle = acp::start_supervised(config, root.0.clone(), scenario.into(), tx, permission);
        handle.tx.send(SessionCommand::Prompt("queued before setup".into())).unwrap();
        let (mut ready, mut prompted, mut error) = (false, false, false);
        loop {
            let event = rx.recv_timeout(Duration::from_secs(10)).unwrap();
            match event.kind.as_str() {
                "session_ready" => {
                    assert!(expected_mode.is_some(), "{scenario} exposed readiness");
                    let options = event.data["peroSettings"]["options"].as_array().unwrap();
                    let setting = options.iter().find(|option| option["id"] == "permission").unwrap();
                    assert_eq!(setting["current"].as_str(), expected_mode, "{scenario}");
                    ready = true;
                }
                "turn_started" => assert!(ready, "{scenario} prompted before readiness"),
                "session_update" if event.data["sessionUpdate"] == "agent_message_chunk" => {
                    assert_ne!(event.data["content"]["text"].as_str(), Some("session-new-reached"), "{scenario} reached session/new");
                    assert_eq!(event.data["content"]["text"].as_str(), expected_mode, "{scenario}");
                    prompted = true;
                }
                "turn_finished" => handle.tx.send(SessionCommand::Close).unwrap(),
                "session_error" => {
                    assert!(expected_error.is_some_and(|detail| event.text.contains(detail)), "{scenario}: {}", event.text);
                    error = true;
                }
                "session_closed" => break,
                _ => {}
            }
        }
        assert_eq!(ready && prompted, expected_mode.is_some(), "{scenario}");
        assert_eq!(error, expected_error.is_some(), "{scenario}");
    }
}

#[test]
fn gate_supervision_is_an_explicit_opt_in_for_non_dsh_peers() {
    let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/runtime/lifecycle-agent.mjs");
    let root = FixtureRoot(std::env::temp_dir().join(format!("pero gate worker {}", uuid::Uuid::new_v4())));
    std::fs::create_dir(&root.0).unwrap();
    for (scenario, supervision, admitted) in [
        ("gate_refused", false, false),
        ("gate_opt_in", true, true),
    ] {
        let mut spec = serde_json::json!({
            "id": "codex", "name": "Codex", "command": "node",
            "args": [&fixture], "env": {"PERO_FIXTURE_SCENARIO": scenario}
        });
        if supervision {
            spec["supervision"] = serde_json::json!("gate");
        }
        let config = serde_json::from_value(spec).unwrap();
        let (tx, rx) = mpsc::channel();
        let handle = acp::start_supervised(config, root.0.clone(), scenario.into(), tx, SupervisedPermission::ReadOnlyDsh);
        handle.tx.send(SessionCommand::Prompt("hello".into())).unwrap();
        let (mut ready, mut prompted, mut error, mut created) = (false, false, false, false);
        loop {
            let event = rx.recv_timeout(Duration::from_secs(10)).unwrap();
            if event.data["content"]["text"] == "session-new-reached" {
                created = true;
            }
            match event.kind.as_str() {
                "session_ready" => {
                    assert!(admitted, "{scenario} became ready");
                    let options = event.data["peroSettings"]["options"].as_array().unwrap();
                    assert!(options.iter().all(|option| option["id"] != "permission"), "{scenario} set a DSH selector");
                    ready = true;
                }
                "turn_started" => assert!(ready, "{scenario} prompted before readiness"),
                "session_update" if event.data["sessionUpdate"] == "agent_message_chunk" && event.data["content"]["text"] != "session-new-reached" => {
                    prompted = true;
                }
                "turn_finished" => handle.tx.send(SessionCommand::Close).unwrap(),
                "session_error" => {
                    assert!(!admitted, "{scenario}: {}", event.text);
                    assert!(event.text.contains("did not opt in"), "{scenario}: {}", event.text);
                    error = true;
                }
                "session_closed" => break,
                _ => {}
            }
        }
        assert_eq!(ready && prompted, admitted, "{scenario}");
        assert_eq!(error, !admitted, "{scenario}");
        assert!(!created, "{scenario} reached session/new");
    }
}
