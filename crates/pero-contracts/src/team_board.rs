//! Read-only projection shared by the Host and Desktop Team panel.
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct TeamBoard {
    pub revision: u64,
    pub enabled: bool,
    pub tasks: Vec<TeamTaskSummary>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct TeamTaskSummary {
    pub id: String,
    pub subject: String,
    pub revision: u64,
    pub status: TeamTaskStatus,
    pub ready: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owner: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TeamTaskStatus {
    Pending,
    InProgress,
    Completed,
}
