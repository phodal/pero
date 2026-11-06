//! User-managed local ACP connectors. No credentials belong in this contract.
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashSet},
    path::Path,
};

/// Execution policy is supplied by Host, never inferred from server annotations.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum McpToolDecision {
    Allow,
    Ask,
    Deny,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct McpToolPolicy {
    pub default: McpToolDecision,
    #[serde(default)]
    pub tools: BTreeMap<String, McpToolDecision>,
}

impl McpToolPolicy {
    pub fn validate(&self) -> Result<(), McpSettingsError> {
        if self.tools.len() > 256
            || self.tools.keys().any(|name| {
                name.trim().is_empty() || name.len() > 128 || name.chars().any(char::is_control)
            })
        {
            return Err(McpSettingsError::Invalid);
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum McpTransport {
    Stdio {
        command: String,
        #[serde(default)]
        args: Vec<String>,
    },
    Http {
        url: String,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct McpServerConfig {
    pub name: String,
    #[serde(default)]
    pub enabled: bool,
    pub transport: McpTransport,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_policy: Option<McpToolPolicy>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct McpConfiguration {
    pub revision: u64,
    pub servers: Vec<McpServerConfig>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum McpSettingsError {
    Conflict,
    Invalid,
    Unavailable,
    ReadWrite,
}

/// Settings response, distinct from persisted state only by the selected Agent identity.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct McpSettingsProjection {
    #[serde(default)]
    pub sessions: Vec<crate::mcp_runtime::McpRuntimeSession>,
    pub agent_id: String,
    pub revision: u64,
    pub servers: Vec<McpServerConfig>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct McpSettingsErrorProjection {
    pub agent_id: String,
    pub reason: McpSettingsError,
}

impl McpConfiguration {
    /// Validate at admission, including names reserved by operator/internal servers.
    pub fn validate(&self, reserved: &[String]) -> Result<(), McpSettingsError> {
        if self.servers.len() > 64 || self.revision > 9_007_199_254_740_991 {
            return Err(McpSettingsError::Invalid);
        }
        let mut names: HashSet<&str> = reserved.iter().map(String::as_str).collect();
        names.insert("pero-app-use");
        names.insert("pero-connectors");
        for server in &self.servers {
            if let Some(policy) = &server.tool_policy {
                policy.validate()?;
            }
            if server.name.trim().is_empty()
                || server.name.len() > 128
                || server.name.chars().any(char::is_control)
                || !names.insert(&server.name)
            {
                return Err(McpSettingsError::Invalid);
            }
            match &server.transport {
                McpTransport::Stdio { command, args } => {
                    if !Path::new(command).is_absolute()
                        || command.len() > 4096
                        || command.contains('\0')
                        || args.len() > 128
                        || args
                            .iter()
                            .any(|arg| arg.len() > 4096 || arg.contains('\0'))
                    {
                        return Err(McpSettingsError::Invalid);
                    }
                }
                McpTransport::Http { url } => {
                    let parsed = url::Url::parse(url).map_err(|_| McpSettingsError::Invalid)?;
                    // Credentials are deliberately out of scope, including URL credentials.
                    if url.len() > 4096
                        || !matches!(parsed.scheme(), "http" | "https")
                        || parsed.host_str().is_none()
                        || !parsed.username().is_empty()
                        || parsed.password().is_some()
                        || parsed.query().is_some()
                        || parsed.fragment().is_some()
                        || url.contains('\\')
                        || url.chars().any(|c| c.is_whitespace() || c.is_control())
                    {
                        return Err(McpSettingsError::Invalid);
                    }
                }
            }
        }
        Ok(())
    }

    /// One transition owns edits, toggles and removals; stale edits cannot overwrite.
    pub fn replace(
        &self,
        revision: u64,
        servers: Vec<McpServerConfig>,
        reserved: &[String],
    ) -> Result<Self, McpSettingsError> {
        if revision != self.revision {
            return Err(McpSettingsError::Conflict);
        }
        let next = Self {
            revision: self
                .revision
                .checked_add(1)
                .ok_or(McpSettingsError::Invalid)?,
            servers,
        };
        next.validate(reserved)?;
        Ok(next)
    }
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(tag = "method", deny_unknown_fields)]
pub enum McpSettingsRequest {
    #[serde(rename = "settings.mcp.get")]
    Get {
        request_id: String,
        agent_id: String,
    },
    #[serde(rename = "settings.mcp.set")]
    Set {
        request_id: String,
        agent_id: String,
        revision: u64,
        servers: Vec<McpServerConfig>,
    },
}

#[cfg(test)]
mod tests {
    use super::*;
    fn server() -> McpServerConfig {
        serde_json::from_str(
            r#"{"name":"docs","transport":{"type":"http","url":"https://example.test/mcp"}}"#,
        )
        .unwrap()
    }
    #[test]
    fn configuration_edits_are_revisioned_and_require_explicit_grant() {
        let empty = McpConfiguration::default();
        let added = empty.replace(0, vec![server()], &[]).unwrap();
        assert!(!added.servers[0].enabled);
        let mut enabled = added.servers.clone();
        enabled[0].enabled = true;
        let granted = added.replace(1, enabled, &[]).unwrap();
        assert!(granted.servers[0].enabled);
        assert_eq!(
            granted.replace(1, vec![], &[]),
            Err(McpSettingsError::Conflict)
        );
        assert!(granted.replace(2, vec![], &[]).unwrap().servers.is_empty());
        assert!(!added.servers[0].enabled); // existing snapshots remain frozen
    }
    #[test]
    fn admission_rejects_ambiguous_or_secret_bearing_configuration() {
        let mut cases = vec![vec![server(), server()]];
        for name in ["", "pero-app-use", "operator", "bad\nname"] {
            let mut item = server();
            item.name = name.into();
            cases.push(vec![item]);
        }
        for url in [
            "file:///tmp/mcp",
            "https://user:secret@example.test/mcp",
            "https://example.test/?token=secret",
            "https://example.test/#secret",
        ] {
            let mut item = server();
            item.transport = McpTransport::Http { url: url.into() };
            cases.push(vec![item]);
        }
        let mut item = server();
        item.transport = McpTransport::Stdio {
            command: "node".into(),
            args: vec![],
        };
        cases.push(vec![item]);
        for servers in cases {
            assert_eq!(
                McpConfiguration::default().replace(0, servers, &["operator".into()]),
                Err(McpSettingsError::Invalid)
            );
        }
        for input in [
            r#"{"name":"x","env":{"TOKEN":"secret"},"transport":{"type":"stdio","command":"/bin/x"}}"#,
            r#"{"name":"x","transport":{"type":"http","url":"https://example.test","headers":{"Authorization":"secret"}}}"#,
        ] {
            assert!(serde_json::from_str::<McpServerConfig>(input).is_err());
        }
    }
    #[test]
    fn tool_policy_admission_is_bounded_and_explicit() {
        for value in [
            serde_json::json!({"tools":{}}),
            serde_json::json!({"default":"unknown"}),
            serde_json::json!({"default":"deny","tools":{"read":"unknown"}}),
            serde_json::json!({"default":"deny","readOnlyHint":true}),
        ] {
            assert!(serde_json::from_value::<McpToolPolicy>(value).is_err());
        }
        let policy: McpToolPolicy =
            serde_json::from_value(serde_json::json!({"default":"ask"})).unwrap();
        assert!(policy.validate().is_ok());
        for name in [
            "".into(),
            "  ".into(),
            "bad\nname".into(),
            "x".repeat(129),
            "文".repeat(43),
        ] {
            let mut item = server();
            item.tool_policy = Some(McpToolPolicy {
                default: McpToolDecision::Deny,
                tools: BTreeMap::from([(name, McpToolDecision::Allow)]),
            });
            assert_eq!(
                McpConfiguration::default().replace(0, vec![item], &[]),
                Err(McpSettingsError::Invalid)
            );
        }
        let mut policy = McpToolPolicy {
            default: McpToolDecision::Deny,
            tools: (0..256)
                .map(|i| (format!("tool_{i}"), McpToolDecision::Ask))
                .collect(),
        };
        assert!(policy.validate().is_ok());
        policy.tools.insert("extra".into(), McpToolDecision::Allow);
        assert_eq!(policy.validate(), Err(McpSettingsError::Invalid));
        assert!(server().tool_policy.is_none()); // old saved configuration retains server-level grants
    }
}
