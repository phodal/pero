use super::*;

fn manifest() -> serde_json::Value {
    // Parsed and frozen only, never launched: use an absolute path on every OS.
    let command = std::env::current_exe().unwrap();
    serde_json::json!({"schemaVersion":1,"name":"paper-tools","version":"1.0.0","instructions":"Use frozen paper sources.","skills":["skills/read/SKILL.md"],"mcpServers":[{"name":"paper-docs","command":command,"args":["node","{pluginRoot}/mcp.mjs"],"env":[]}]})
}

#[test]
fn package_declaration_admission() {
    for (key, value, accepted) in [
        ("schemaVersion", serde_json::json!(1), true),
        ("schemaVersion", serde_json::json!(2), false),
        ("unknown", serde_json::json!(true), false),
        ("name", serde_json::json!("../escape"), false),
        ("skills", serde_json::json!(["../SKILL.md"]), false),
        (
            "skills",
            serde_json::json!(["skills/read/README.md"]),
            false,
        ),
        (
            "skills",
            serde_json::json!(["skills/read/SKILL.md", "skills/read/SKILL.md"]),
            false,
        ),
        (
            "mcpServers",
            serde_json::json!([{"name":"docs","command":"node","args":[],"env":[]}]),
            false,
        ),
        (
            "mcpServers",
            serde_json::json!([{"name":"docs","command":"{pluginRoot}/server","args":[],"env":[]}]),
            true,
        ),
        (
            "mcpServers",
            serde_json::json!([{"name":"docs","command":"{pluginRoot}/../server","args":[],"env":[]}]),
            false,
        ),
        (
            "mcpServers",
            serde_json::json!([{"name":"docs","command":"{pluginRoot}/server","args":[],"env":[],"shell":true}]),
            false,
        ),
        (
            "mcpServers",
            serde_json::json!([{"type":"unknown","name":"docs","command":"{pluginRoot}/server","args":[],"env":[]}]),
            false,
        ),
        (
            "mcpServers",
            serde_json::json!([{"type":"http","name":"docs","url":"file:///tmp/server","headers":[]}]),
            false,
        ),
        (
            "mcpServers",
            serde_json::json!([{"type":"http","name":"docs","url":"https://example.test/mcp","headers":[]}]),
            true,
        ),
        (
            "mcpServers",
            serde_json::json!([{"name":"pero-app-use","command":"{pluginRoot}/server","args":[],"env":[]}]),
            false,
        ),
    ] {
        let mut candidate = manifest();
        candidate[key] = value;
        let result = AgentPluginDefinition::parse(&serde_json::to_vec(&candidate).unwrap());
        assert_eq!(result.is_ok(), accepted, "{key}: {result:?}");
    }
}

struct Home(PathBuf);
impl Home {
    fn new() -> Self {
        let root =
            std::env::temp_dir().join(format!("pero-agent-plugin-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        Self(dunce::canonicalize(root).unwrap())
    }
    fn source(&self) -> PathBuf {
        let root = self.0.join("app/agent-plugins/paper-tools");
        fs::create_dir_all(root.join("skills/read")).unwrap();
        fs::write(
            root.join("plugin.json"),
            serde_json::to_vec(&manifest()).unwrap(),
        )
        .unwrap();
        fs::write(
            root.join("skills/read/SKILL.md"),
            "# Paper reading\nRead the exact frozen source.",
        )
        .unwrap();
        fs::write(root.join("mcp.mjs"), "process.stdin.resume();").unwrap();
        root
    }
}
impl Drop for Home {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn dependency_installation_preserves_explicit_choices_and_frozen_values() {
    // One dependency concept table: absent, installed, disabled, unavailable.
    for (state, accepted) in [
        ("absent", true),
        ("installed", true),
        ("disabled", false),
        ("unavailable", false),
    ] {
        let home = Home::new();
        let source = home.source();
        let name = AppName::try_from("paper-tools".to_string()).unwrap();
        let managed = home.0.join("profile/agent-plugins");
        let mut store = AgentPluginStore::open(managed.clone()).unwrap();
        if matches!(state, "installed" | "disabled") {
            store.install(&source).unwrap();
        }
        if state == "disabled" {
            store.set_enabled(&name, false).unwrap();
        }
        if state == "unavailable" {
            fs::remove_dir_all(&source).unwrap();
        }
        let result = store.ensure_dependencies(std::slice::from_ref(&name), &home.0.join("app"));
        assert_eq!(result.is_ok(), accepted, "{state}: {result:?}");
        if !accepted {
            if state == "disabled" {
                assert!(!store.list()[0].enabled);
                assert!(!AgentPluginStore::open(managed).unwrap().list()[0].enabled);
            }
            continue;
        }
        let snapshot = result.unwrap();
        assert_eq!(snapshot.skills[0].path, managed.join("paper-tools/skills/read/SKILL.md"));
        assert_eq!(
            snapshot.skills[0].content,
            "# Paper reading\nRead the exact frozen source."
        );
        let McpServer::Stdio(server) = &snapshot.mcp_servers[0] else {
            panic!("stdio expected")
        };
        assert_eq!(
            server.args[1],
            managed.join("paper-tools/mcp.mjs").to_string_lossy()
        );
        let revision = &snapshot.plugins[0].revision;
        fs::write(source.join("skills/read/SKILL.md"), "Changed source").unwrap();
        store.set_enabled(&name, false).unwrap();
        assert_eq!(
            snapshot.skills[0].content,
            "# Paper reading\nRead the exact frozen source."
        );
        let mut reopened = AgentPluginStore::open(managed).unwrap();
        reopened.set_enabled(&name, true).unwrap();
        let restored = reopened
            .ensure_dependencies(&[name], &home.0.join("app"))
            .unwrap();
        assert_eq!(&restored.plugins[0].revision, revision);
        assert_eq!(restored.skills[0].content, snapshot.skills[0].content);
    }
}

#[test]
fn package_installation_rejects_incomplete_sources_without_creating_an_installation() {
    let home = Home::new();
    let source = home.source();
    fs::remove_file(source.join("skills/read/SKILL.md")).unwrap();
    let managed = home.0.join("profile/agent-plugins");
    let mut store = AgentPluginStore::open(managed.clone()).unwrap();
    assert!(store
        .install(&source)
        .unwrap_err()
        .contains("Cannot read Agent Plugin Skill"));
    assert!(store.list().is_empty());
    assert_eq!(fs::read_dir(managed).unwrap().count(), 0);
}
