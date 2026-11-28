//! Local Worker enrollment is distinct from the user's Cloud client credential.
use serde::{Deserialize, Serialize};

/// Private environment handoff from the Desktop Host to its managed Worker.
pub const BUILTIN_AGENT_KEY_ENV: &str = "PERO_LOCAL_WORKER_DEEPSEEK_API_KEY";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct LocalWorkerBinding {
    pub project_id: String,
    pub workspace_key: String,
    pub path: String,
    pub agent_ids: Vec<String>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct LocalWorkerConfig {
    pub id: String,
    pub name: String,
    pub url: String,
    pub token: String,
    pub bindings: Vec<LocalWorkerBinding>,
}
impl std::fmt::Debug for LocalWorkerConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("LocalWorkerConfig")
            .field("id", &self.id)
            .field("name", &self.name)
            .field("url", &self.url)
            .field("bindings", &self.bindings)
            .finish_non_exhaustive()
    }
}
impl LocalWorkerConfig {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.id.is_empty()
            || self.id.len() > 128
            || !self
                .id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"-_".contains(&b))
            || self.name.trim().is_empty()
            || self.name.len() > 256
            || self.token.is_empty()
            || self.token.len() > 4096
            || self.url.is_empty()
            || self.url.len() > 2048
            || self.bindings.is_empty()
            || self.bindings.len() > 16
        {
            return Err("Invalid local Worker identity, credential or bindings");
        }
        let mut keys = std::collections::HashSet::new();
        for binding in &self.bindings {
            if binding.project_id.is_empty()
                || binding.project_id.len() > 128
                || binding.workspace_key.is_empty()
                || binding.workspace_key.len() > 128
                || !keys.insert(&binding.workspace_key)
                || binding.path.is_empty()
                || binding.path.len() > 4096
                || binding.agent_ids.is_empty()
                || binding.agent_ids.len() > 16
                || binding
                    .agent_ids
                    .iter()
                    .any(|id| id.is_empty() || id.len() > 128)
            {
                return Err("A Worker requires unique workspace keys and explicit allowed Agents");
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct LocalWorkerSummary {
    pub id: String,
    pub name: String,
    pub url: String,
    pub bindings: Vec<LocalWorkerBinding>,
}
impl From<&LocalWorkerConfig> for LocalWorkerSummary {
    fn from(config: &LocalWorkerConfig) -> Self {
        Self {
            id: config.id.clone(),
            name: config.name.clone(),
            url: config.url.clone(),
            bindings: config.bindings.clone(),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(tag = "action", deny_unknown_fields)]
pub enum LocalWorkerRequest {
    #[serde(rename = "local_worker_start")]
    Start {
        request_id: String,
        worker: LocalWorkerConfig,
    },
    #[serde(rename = "local_worker_stop")]
    Stop { request_id: String },
    #[serde(rename = "local_worker_get")]
    Get { request_id: String },
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LocalWorkerStatus {
    #[default]
    Stopped,
    Starting,
    Idle,
    Running,
    Offline,
    Stopping,
    NeedsAttention,
    Unavailable,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct LocalWorkerState {
    pub status: LocalWorkerStatus,
    pub enabled: bool,
    pub configuration: Option<LocalWorkerSummary>,
    pub worker_id: String,
    pub name: String,
    pub url: String,
    pub message: String,
    pub run_id: Option<String>,
    pub attempt: u32,
}

/// Progress emitted only by the Worker supervisor, never Agent stdout.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct WorkerProgress {
    pub status: LocalWorkerStatus,
    pub message: String,
    pub run_id: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn local_worker_requires_explicit_bindings_and_redacts_credentials() {
        let mut config = LocalWorkerConfig {
            id: "device-1".into(),
            name: "My machine".into(),
            url: "https://example.com".into(),
            token: "private-token".into(),
            bindings: vec![LocalWorkerBinding {
                project_id: "project-id".into(),
                workspace_key: "project".into(),
                path: "/work/project".into(),
                agent_ids: vec!["codex".into()],
            }],
        };
        assert!(config.validate().is_ok());
        assert!(!format!("{config:?}").contains("private-token"));
        config.bindings.push(config.bindings[0].clone());
        assert!(config.validate().is_err());
        config.bindings.clear();
        assert!(config.validate().is_err());
    }
}
