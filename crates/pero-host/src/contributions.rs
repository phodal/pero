//! Contribution process requests run off the stdio reader so ACP remains responsive.
use pero_contracts::HostEvent;
use pero_runtime::{
    contribution::{ContributionError, ContributionSnapshot, Repository, TaskId},
    contribution_git::{self, GitHubCli},
};
use serde::Deserialize;
use std::path::PathBuf;

#[derive(Deserialize)]
enum Method {
    #[serde(rename = "contribution")]
    Contribution,
}
#[derive(Deserialize)]
#[serde(tag = "operation", rename_all = "snake_case", deny_unknown_fields)]
enum Request {
    Prepare {
        method: Method,
        id: String,
        task_id: TaskId,
        repository: Repository,
        parent: PathBuf,
        title: String,
        source_url: String,
        source_revision: String,
    },
    Review {
        method: Method,
        id: String,
        task_id: TaskId,
        workspace: PathBuf,
    },
    Status {
        method: Method,
        id: String,
        task_id: TaskId,
        workspace: PathBuf,
    },
    Publish {
        method: Method,
        id: String,
        task_id: TaskId,
        workspace: PathBuf,
        review_token: String,
    },
}

pub fn dispatch(value: serde_json::Value) {
    let id = value["id"]
        .as_str()
        .filter(|id| !id.is_empty() && id.len() <= 128)
        .map(str::to_string);
    let task = value["task_id"].as_str().unwrap_or("").to_string();
    std::thread::spawn(move || {
        let result = if id.is_none() {
            Err(ContributionError::new(
                "invalid_request",
                "Invalid contribution request",
            ))
        } else {
            serde_json::from_value::<Request>(value)
                .map_err(|error| {
                    ContributionError::new(
                        "invalid_request",
                        format!("Invalid contribution request: {error}"),
                    )
                })
                .and_then(execute)
        };
        let event = match result {
            Ok(snapshot) => {
                let mut event = HostEvent::new("contribution_result", id, String::new());
                event.data = serde_json::to_value(snapshot).unwrap();
                event
            }
            Err(error) => {
                let mut event = HostEvent::new("contribution_error", id, error.message.clone());
                event.data =
                    serde_json::json!({"code":error.code,"message":error.message,"task_id":task});
                event
            }
        };
        let _ = super::emit(event);
    });
}
fn execute(request: Request) -> Result<ContributionSnapshot, ContributionError> {
    let github = GitHubCli;
    match request {
        Request::Prepare {
            method,
            id,
            task_id,
            repository,
            parent,
            title,
            source_url,
            source_revision,
        } => {
            let _ = (method, id);
            let c = contribution_git::prepare(
                task_id,
                repository,
                &parent,
                title,
                source_url,
                source_revision,
            )?;
            let mut snapshot = contribution_git::review(c, &github)?;
            if snapshot.changed_files.is_empty() && snapshot.contribution.pr_url.is_none() {
                snapshot.status = "ready".into();
            }
            Ok(snapshot)
        }
        Request::Review {
            method,
            id,
            task_id,
            workspace,
        }
        | Request::Status {
            method,
            id,
            task_id,
            workspace,
        } => {
            let _ = (method, id);
            contribution_git::review(contribution_git::load(&workspace, &task_id)?, &github)
        }
        Request::Publish {
            method,
            id,
            task_id,
            workspace,
            review_token,
        } => {
            let _ = (method, id);
            contribution_git::publish(
                contribution_git::load(&workspace, &task_id)?,
                &review_token,
                &github,
            )
        }
    }
}
