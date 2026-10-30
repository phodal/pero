use serde::{Deserialize, Serialize};
pub mod app_chat;
pub use app_chat::AppChatScope;
pub mod composer_capabilities;
pub mod computer_use;
pub mod computer_runtime;
pub mod context;
pub mod content_document;
pub mod content_origin;
pub mod content_link;
pub mod file_document;
pub mod i18n;
pub mod local_worker;
pub mod roadmap;
pub mod session_settings;
pub mod usage;
pub mod workbench;
pub mod web_document;
pub mod table_projection;

pub const PROTOCOL_VERSION: u32 = 1;
pub const MAX_TEXT_CHARS: usize = 4096;

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct EchoRequest {
    pub id: String,
    pub text: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct HostEvent {
    pub version: u32,
    pub kind: String,
    pub request_id: Option<String>,
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thread_id: Option<String>,
    #[serde(default, skip_serializing_if = "serde_json::Value::is_null")]
    pub data: serde_json::Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message_key: Option<String>,
}

impl HostEvent {
    /// A deleted thread stays out of replay and thread context, including events
    /// recorded after its tombstone.
    pub fn without_deleted_threads(events: &[Self]) -> Vec<Self> {
        let deleted: std::collections::HashSet<&str> = events
            .iter()
            .filter(|event| event.kind == "session_deleted")
            .filter_map(|event| event.thread_id.as_deref())
            .collect();
        events
            .iter()
            .filter(|event| {
                event.kind != "session_deleted"
                    && event
                        .thread_id
                        .as_deref()
                        .is_none_or(|id| !deleted.contains(id))
            })
            .cloned()
            .collect()
    }

    pub fn new(kind: &str, request_id: Option<String>, text: String) -> Self {
        Self {
            version: PROTOCOL_VERSION,
            kind: kind.into(),
            request_id,
            text,
            thread_id: None,
            data: serde_json::Value::Null,
            message_key: None,
        }
    }
    pub fn message(kind: &str, request_id: Option<String>, key: &str) -> Self {
        let mut event = Self::new(kind, request_id, String::new());
        event.message_key = Some(key.into());
        event
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
pub enum HostCommand {
    ListAgents,
    Workspace {
        path: String,
    },
    LoadRoadmap,
    AttachFiles {
        paths: Vec<String>,
    },
    SearchContext {
        request_id: String,
        kind: context::ContextKind,
        query: String,
    },
    ResolveContext {
        request_id: String,
        kind: context::ContextKind,
        source: String,
        #[serde(default)]
        start_line: Option<u32>,
        #[serde(default)]
        end_line: Option<u32>,
    },
    Authenticate {
        thread_id: String,
        method_id: String,
    },
    NewSession {
        thread_id: String,
        agent_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        scope: Option<AppChatScope>,
    },
    Prompt {
        thread_id: String,
        text: String,
        #[serde(default)]
        contexts: Vec<context::ContextReference>,
    },
    Cancel {
        thread_id: String,
    },
    Permission {
        thread_id: String,
        request_id: String,
        option_id: Option<String>,
    },
    Model {
        thread_id: String,
        model_id: String,
    },
    Configure {
        thread_id: String,
        config_id: String,
        value: String,
    },
    Close {
        thread_id: String,
    },
    Delete {
        thread_id: String,
    },
}

/// Only the Desktop main process handles plaintext credentials. Runtime settings
/// store the OS-encrypted envelope and never publish it as a Host event.
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct RemoteConnectionSettings {
    pub url: String,
    pub mode: RemoteConnectionMode,
    pub encrypted_token: String,
}

impl std::fmt::Debug for RemoteConnectionSettings {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("RemoteConnectionSettings")
            .field("url", &self.url)
            .field("mode", &self.mode)
            .field("credential_configured", &!self.encrypted_token.is_empty())
            .finish()
    }
}

impl RemoteConnectionSettings {
    pub fn valid(&self) -> bool {
        let encrypted = self.encrypted_token.trim_end_matches('=');
        !self.url.is_empty()
            && self.url.len() <= 2048
            && (self.url.starts_with("https://") || self.url.starts_with("http://"))
            && !self.url.chars().any(char::is_control)
            && !self.encrypted_token.is_empty()
            && self.encrypted_token.len() <= 4096
            && self.encrypted_token.len().is_multiple_of(4)
            && self.encrypted_token.len() - encrypted.len() <= 2
            && !encrypted.is_empty()
            && encrypted
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"+/".contains(&b))
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum RemoteConnectionMode {
    Client,
    Operator,
}

#[derive(Debug, Deserialize)]
pub enum RemoteSettingsMethod {
    #[serde(rename = "settings.remote")]
    Remote,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub enum RemoteConnectionPreference {
    Configured(RemoteConnectionSettings),
    Disconnected(()),
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SetRemoteSettingsRequest {
    pub method: RemoteSettingsMethod,
    pub id: String,
    pub connection: RemoteConnectionPreference,
}

#[cfg(test)]
mod remote_settings_tests {
    use super::*;

    #[test]
    fn preferences_require_explicit_encrypted_connection_or_disconnect() {
        let configured = serde_json::json!({
            "method": "settings.remote", "id": "settings-1",
            "connection": {"url": "https://openpero.com", "mode": "client", "encrypted_token": "ZW5jcnlwdGVk"}
        });
        let request: SetRemoteSettingsRequest = serde_json::from_value(configured.clone()).unwrap();
        let RemoteConnectionPreference::Configured(connection) = request.connection else {
            panic!("expected configured preference");
        };
        assert!(connection.valid());
        assert!(!format!("{connection:?}").contains(&connection.encrypted_token));
        let mut plaintext = configured.clone();
        plaintext["connection"]["token"] = "never-persist-plaintext".into();
        assert!(serde_json::from_value::<SetRemoteSettingsRequest>(plaintext).is_err());
        assert!(
            serde_json::from_value::<SetRemoteSettingsRequest>(serde_json::json!({
                "method": "settings.remote", "id": "settings-1"
            }))
            .is_err()
        );
        let disconnected: SetRemoteSettingsRequest = serde_json::from_value(serde_json::json!({
            "method": "settings.remote", "id": "settings-1", "connection": null
        }))
        .unwrap();
        assert!(matches!(
            disconnected.connection,
            RemoteConnectionPreference::Disconnected(())
        ));
        for encrypted_token in ["====", "ZW=5", "ZW5j\n", "YWJj===", "abc"] {
            assert!(
                !RemoteConnectionSettings {
                    encrypted_token: encrypted_token.into(),
                    ..connection.clone()
                }
                .valid()
            );
        }
    }
}

#[cfg(test)]
mod history_tests {
    use super::*;

    #[test]
    fn deleted_threads_leave_visible_history() {
        let thread = |kind: &str, id: &str| {
            let mut event = HostEvent::new(kind, None, kind.into());
            event.thread_id = Some(id.into());
            event
        };
        let visible = HostEvent::without_deleted_threads(&[
            thread("user_message", "keep"),
            thread("user_message", "gone"),
            thread("session_deleted", "gone"),
            thread("session_closed", "gone"),
            HostEvent::new("workspace", None, "/tmp".into()),
        ]);
        assert_eq!(visible.len(), 2);
        assert_eq!(visible[0].thread_id.as_deref(), Some("keep"));
        assert_eq!(visible[1].kind, "workspace");
        assert!(visible[1].thread_id.is_none());
    }
}

pub mod appearance;
