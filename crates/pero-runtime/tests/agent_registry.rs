//! Exercise the built-in registry through real ACP processes, without provider I/O.
use pero_contracts::HostEvent;
use pero_runtime::acp::{self, SessionCommand};
use std::{path::PathBuf, process::Command, sync::mpsc, time::Duration};

#[test]
fn node_adapters_connect_and_reconnect() {
    let root = std::env::temp_dir().join(format!("pero adapters {}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(root.join("node_modules/.bin")).unwrap();
    std::fs::create_dir(root.join("adapters")).unwrap();
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
