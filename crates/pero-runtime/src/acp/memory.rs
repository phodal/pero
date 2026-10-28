//! Optional long-term memory through an external Engram MCP process.
//!
//! This is operator configuration only. It adds one stdio entry to the ACP
//! `mcpServers` list the session already sends, and attaches the trusted tool
//! policy that the Go harness enforces. Engram owns storage, schema and
//! recovery; Pero owns which tools may run and which calls need approval.
//! Nothing here runs for a disabled configuration, not even a file lookup.

use agent_client_protocol::schema::v1::{EnvVariable, McpServer, McpServerStdio, Meta};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::path::PathBuf;

/// Server name the model-facing tools carry (`mcp__engram__mem_search`).
pub const SERVER_NAME: &str = "engram";
/// ACP `_meta` key read by the Go harness.
const META_KEY: &str = "pero.dev/mcp-server";

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Mutations {
    /// Mutating tools are not offered to the model.
    #[default]
    Deny,
    /// Mutating tools are offered and every call asks for approval.
    Approve,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MemoryConfig {
    /// Off unless the operator says otherwise.
    #[serde(default)]
    pub enabled: bool,
    /// Absolute path of an Engram binary. It is never discovered or installed.
    pub engram: PathBuf,
    /// Absolute data directory. Use a separate directory wherever workspaces
    /// must not share memory: the project below is a default, not a boundary.
    pub data_dir: PathBuf,
    /// Project every read and write is pinned to.
    pub project: String,
    #[serde(default)]
    pub mutations: Mutations,
    /// Subset of the supported tools to offer. Default: the read tools, plus
    /// the write tools when `mutations` is `approve`.
    #[serde(default)]
    pub tools: Option<Vec<String>>,
}

#[derive(Debug, Eq, PartialEq)]
pub enum MemoryState {
    Disabled,
    MissingBinary,
    Ready,
}

struct Tool {
    name: &'static str,
    mutates: bool,
    /// Arguments Engram would otherwise default from the prompt, the working
    /// directory or its own configuration.
    pins: &'static [(&'static str, &'static str)],
    /// Arguments that widen a call beyond the pinned project.
    forbids: &'static [&'static str],
    default: bool,
}

/// The only Engram tools Pero knows how to police. `mem_save_prompt`,
/// `mem_capture_passive`, deletion, merging and every other tool are absent on
/// purpose; adding one means deciding its policy here first.
const TOOLS: &[Tool] = &[
    Tool {
        name: "mem_search",
        mutates: false,
        pins: &[("project", "project")],
        forbids: &["all_projects"],
        default: true,
    },
    Tool {
        name: "mem_get_observation",
        mutates: false,
        pins: &[],
        forbids: &[],
        default: true,
    },
    Tool {
        name: "mem_context",
        mutates: false,
        pins: &[("project", "project")],
        forbids: &[],
        default: true,
    },
    // `capture_prompt` defaults to true in Engram; it is pinned off so a save
    // can never record a prompt.
    Tool {
        name: "mem_save",
        mutates: true,
        pins: &[("project", "project"), ("capture_prompt", "false")],
        forbids: &[],
        default: true,
    },
    Tool {
        name: "mem_session_summary",
        mutates: true,
        pins: &[("project", "project")],
        forbids: &[],
        default: true,
    },
];

impl MemoryConfig {
    pub fn validate(&self) -> Result<(), String> {
        if !self.engram.is_absolute() || !self.data_dir.is_absolute() {
            return Err("Memory requires absolute Engram and data directory paths".into());
        }
        if [self.engram.as_path(), self.data_dir.as_path()]
            .iter()
            .any(|p| p.to_string_lossy().contains('\0'))
        {
            return Err("Invalid memory path".into());
        }
        if self.project.trim().is_empty() || self.project.chars().any(char::is_control) {
            return Err("Memory requires a project name".into());
        }
        if let Some(names) = &self.tools {
            for (i, name) in names.iter().enumerate() {
                if !TOOLS.iter().any(|t| t.name == name) || names[..i].contains(name) {
                    return Err("Unsupported or duplicate memory tool".into());
                }
            }
        }
        if self.exposed().is_empty() {
            return Err("Memory configuration offers no tools".into());
        }
        Ok(())
    }

    fn selected(&self) -> Vec<&'static Tool> {
        TOOLS
            .iter()
            .filter(|t| match &self.tools {
                Some(names) => names.iter().any(|n| n == t.name),
                None => t.default,
            })
            .collect()
    }

    /// Tools the model can actually see under the mutation mode.
    fn exposed(&self) -> Vec<&'static Tool> {
        self.selected()
            .into_iter()
            .filter(|t| !t.mutates || self.mutations == Mutations::Approve)
            .collect()
    }

    /// Only looks at the filesystem when memory is enabled, and never writes.
    pub fn state(&self) -> MemoryState {
        if !self.enabled {
            MemoryState::Disabled
        } else if self.engram.is_file() {
            MemoryState::Ready
        } else {
            MemoryState::MissingBinary
        }
    }

    /// The ACP entry for a ready configuration.
    pub fn mcp_server(&self) -> Result<McpServer, String> {
        self.validate()?;
        let exposed = self.exposed();
        let rule = |t: &Tool| {
            let mut rule = json!({ "name": t.name });
            if t.mutates {
                rule["mutates"] = json!(true);
            }
            if !t.pins.is_empty() {
                let pins: serde_json::Map<String, Value> = t
                    .pins
                    .iter()
                    .map(|(arg, value)| {
                        let pinned = if *value == "project" {
                            json!(self.project)
                        } else {
                            serde_json::from_str(value).unwrap()
                        };
                        (arg.to_string(), pinned)
                    })
                    .collect();
                rule["pin"] = Value::Object(pins);
            }
            if !t.forbids.is_empty() {
                rule["forbid"] = json!(t.forbids);
            }
            rule
        };
        let policy = json!({
            "mutations": if self.mutations == Mutations::Approve { "approve" } else { "deny" },
            "tools": exposed.iter().map(|t| rule(t)).collect::<Vec<_>>(),
        });
        let data_dir = self.data_dir.to_string_lossy().into_owned();
        let env = [
            // Engram refuses to start without a home directory even when a data
            // directory is given; point it at the data directory, never at the
            // user's home.
            ("HOME", data_dir.as_str()),
            ("ENGRAM_DATA_DIR", data_dir.as_str()),
            ("ENGRAM_PROJECT", self.project.as_str()),
            // Cloud sync stays off and no cloud endpoint or token is carried.
            ("ENGRAM_CLOUD_AUTOSYNC", "0"),
            ("ENGRAM_CLOUD_SERVER", ""),
            ("ENGRAM_CLOUD_TOKEN", ""),
        ]
        .into_iter()
        .map(|(name, value)| EnvVariable::new(name, value))
        .collect();
        let tools = exposed.iter().map(|t| t.name).collect::<Vec<_>>().join(",");
        let mut meta = Meta::new();
        meta.insert(
            META_KEY.into(),
            json!({ "toolPolicy": policy, "cleanEnvironment": true, "failOnStartupError": true }),
        );
        Ok(McpServer::Stdio(
            McpServerStdio::new(SERVER_NAME, self.engram.clone())
                .args(vec!["mcp".into(), format!("--tools={tools}")])
                .env(env)
                .meta(meta),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::acp::AgentConfig;
    use std::path::Path;

    fn config(binary: &std::path::Path, mutations: Mutations) -> MemoryConfig {
        MemoryConfig {
            enabled: true,
            engram: binary.to_path_buf(),
            data_dir: "/data/engram-a".into(),
            project: "synthetic-project".into(),
            mutations,
            tools: None,
        }
    }

    fn agent(memory: Option<MemoryConfig>) -> AgentConfig {
        let mut value = json!({"id": "fixture", "name": "Fixture", "command": "/bin/true"});
        if let Some(memory) = memory {
            value["memory"] = serde_json::to_value(memory).unwrap();
        }
        serde_json::from_value(value).unwrap()
    }

    /// Any existing file stands in for the binary: the runtime only checks that it exists.
    fn binary() -> PathBuf {
        std::env::current_exe().unwrap()
    }

    fn entry(config: &MemoryConfig) -> Value {
        serde_json::to_value(config.mcp_server().unwrap()).unwrap()
    }

    #[test]
    fn default_is_off_and_adds_nothing() {
        let without = agent(None);
        assert!(without.session_mcp_servers().unwrap().is_empty());
        let mut disabled = config(&binary(), Mutations::Approve);
        disabled.enabled = false;
        assert_eq!(disabled.state(), MemoryState::Disabled);
        assert!(
            agent(Some(disabled))
                .session_mcp_servers()
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn disabled_does_not_look_at_paths() {
        // Even a nonsense configuration is inert while disabled.
        let value = json!({"id": "a", "name": "A", "command": "/bin/true",
            "memory": {"enabled": false, "engram": "relative", "data_dir": "x", "project": ""}});
        let agent: AgentConfig = serde_json::from_value(value).unwrap();
        assert!(agent.validate_mcp().is_ok());
        assert!(agent.session_mcp_servers().unwrap().is_empty());
    }

    #[test]
    fn missing_binary_is_an_explicit_error_with_no_side_effects() {
        let dir = std::env::temp_dir().join(format!("pero-memory-missing-{}", std::process::id()));
        let mut missing = config(&dir.join("engram"), Mutations::Deny);
        missing.data_dir = dir.join("data");
        assert_eq!(missing.state(), MemoryState::MissingBinary);
        let error = agent(Some(missing)).session_mcp_servers().unwrap_err();
        assert!(error.contains("not available"), "{error}");
        assert!(!dir.exists(), "a missing binary must not create anything");
    }

    #[test]
    fn ready_entry_matches_the_policy_contract_shared_with_the_go_harness() {
        let memory = config(Path::new("/opt/engram/engram"), Mutations::Approve);
        let golden = include_str!("../../../../tests/fixtures/engram-memory/mcp-server.json")
            .replace("{{ENGRAM_BIN}}", "/opt/engram/engram")
            .replace("{{DATA_DIR}}", "/data/engram-a")
            .replace("{{PROJECT}}", "synthetic-project");
        assert_eq!(
            entry(&memory),
            serde_json::from_str::<Value>(&golden).unwrap()
        );
    }

    #[test]
    fn mutations_are_hidden_unless_approved() {
        let denied = entry(&config(&binary(), Mutations::Deny));
        let tools = denied["args"][1].as_str().unwrap();
        assert_eq!(tools, "--tools=mem_search,mem_get_observation,mem_context");
        let policy = &denied["_meta"][META_KEY]["toolPolicy"];
        assert_eq!(policy["mutations"], "deny");
        assert!(
            policy["tools"]
                .as_array()
                .unwrap()
                .iter()
                .all(|t| t.get("mutates").is_none())
        );
        let approved = entry(&config(&binary(), Mutations::Approve));
        let tools = approved["args"][1].as_str().unwrap();
        assert!(tools.contains("mem_save") && tools.contains("mem_session_summary"));
        for unsupported in [
            "mem_save_prompt",
            "mem_capture_passive",
            "mem_delete",
            "mem_update",
        ] {
            assert!(
                !tools.contains(unsupported),
                "{unsupported} must stay unreachable"
            );
        }
    }

    #[test]
    fn privacy_defaults_are_pinned_not_assumed() {
        let approved = entry(&config(&binary(), Mutations::Approve));
        let rules = approved["_meta"][META_KEY]["toolPolicy"]["tools"]
            .as_array()
            .unwrap();
        let rule = |name: &str| rules.iter().find(|r| r["name"] == name).unwrap();
        assert_eq!(rule("mem_save")["pin"]["capture_prompt"], false);
        assert_eq!(rule("mem_save")["pin"]["project"], "synthetic-project");
        assert_eq!(rule("mem_search")["forbid"], json!(["all_projects"]));
        let env: Vec<_> = approved["env"]
            .as_array()
            .unwrap()
            .iter()
            .map(|e| (e["name"].as_str().unwrap(), e["value"].as_str().unwrap()))
            .collect();
        assert!(env.contains(&("ENGRAM_CLOUD_AUTOSYNC", "0")));
        assert!(env.contains(&("ENGRAM_CLOUD_TOKEN", "")));
        assert!(env.contains(&("HOME", "/data/engram-a")));
        assert_eq!(approved["_meta"][META_KEY]["cleanEnvironment"], true);
        assert_eq!(approved["_meta"][META_KEY]["failOnStartupError"], true);
    }

    #[test]
    fn invalid_configuration_is_rejected() {
        let ok = config(&binary(), Mutations::Deny);
        let cases: Vec<(&str, Box<dyn Fn(&mut MemoryConfig)>)> = vec![
            ("relative binary", Box::new(|m| m.engram = "engram".into())),
            (
                "relative data dir",
                Box::new(|m| m.data_dir = "data".into()),
            ),
            ("blank project", Box::new(|m| m.project = "  ".into())),
            (
                "unknown tool",
                Box::new(|m| m.tools = Some(vec!["mem_delete".into()])),
            ),
            (
                "duplicate tool",
                Box::new(|m| m.tools = Some(vec!["mem_search".into(), "mem_search".into()])),
            ),
            (
                "only mutating tools while denied",
                Box::new(|m| m.tools = Some(vec!["mem_save".into()])),
            ),
        ];
        for (name, mutate) in cases {
            let mut bad = ok.clone();
            mutate(&mut bad);
            assert!(bad.validate().is_err(), "{name} was accepted");
            assert!(
                agent(Some(bad)).validate_mcp().is_err(),
                "{name} passed registry validation"
            );
        }
    }

    #[test]
    fn typos_do_not_silently_disable_or_widen_memory() {
        let value = json!({"id": "a", "name": "A", "command": "/bin/true",
            "memory": {"enable": true, "engram": "/e", "data_dir": "/d", "project": "p"}});
        assert!(serde_json::from_value::<AgentConfig>(value).is_err());
        let value = json!({"id": "a", "name": "A", "command": "/bin/true",
            "memory": {"enabled": true, "engram": "/e", "data_dir": "/d", "project": "p", "mutations": "allow"}});
        assert!(serde_json::from_value::<AgentConfig>(value).is_err());
    }

    #[test]
    fn memory_server_name_cannot_collide() {
        let mut value = json!({"id": "a", "name": "A", "command": "/bin/true",
            "mcp_servers": [{"name": "engram", "command": "/usr/bin/other", "args": [], "env": []}]});
        value["memory"] = serde_json::to_value(config(&binary(), Mutations::Deny)).unwrap();
        let agent: AgentConfig = serde_json::from_value(value).unwrap();
        assert!(
            agent
                .session_mcp_servers()
                .unwrap_err()
                .contains("conflicts")
        );
    }

    #[test]
    fn explicit_servers_are_kept_alongside_memory() {
        let mut value = json!({"id": "a", "name": "A", "command": "/bin/true",
            "mcp_servers": [{"name": "other", "command": "/usr/bin/other", "args": [], "env": []}]});
        value["memory"] = serde_json::to_value(config(&binary(), Mutations::Deny)).unwrap();
        let agent: AgentConfig = serde_json::from_value(value).unwrap();
        assert_eq!(agent.session_mcp_servers().unwrap().len(), 2);
    }
}
