//! Local contribution values. Git/process work is in `contribution_git`.
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct Repository(String);
impl TryFrom<String> for Repository {
    type Error = String;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        let parts: Vec<_> = value.split('/').collect();
        if parts.len() != 2
            || parts.iter().any(|part| {
                part.is_empty()
                    || part.len() > 100
                    || *part == "."
                    || *part == ".."
                    || part.starts_with('-')
                    || !part
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b))
            })
        {
            return Err("Select a GitHub repository in owner/repository form".into());
        }
        Ok(Self(value))
    }
}
impl From<Repository> for String {
    fn from(value: Repository) -> Self {
        value.0
    }
}
impl Repository {
    pub fn as_str(&self) -> &str {
        &self.0
    }
    pub fn owner(&self) -> &str {
        self.0.split('/').next().unwrap()
    }
    pub fn clone_url(&self) -> String {
        format!("https://github.com/{}.git", self.0)
    }
    pub fn pull_request_url(&self, url: &str) -> bool {
        url.strip_prefix(&format!("https://github.com/{}/pull/", self.0))
            .is_some_and(|number| !number.is_empty() && number.bytes().all(|b| b.is_ascii_digit()))
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct TaskId(String);
impl TryFrom<String> for TaskId {
    type Error = String;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        if value.is_empty()
            || value.len() > 128
            || !value
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"-_".contains(&b))
        {
            return Err("Invalid contribution task".into());
        }
        Ok(Self(value))
    }
}
impl From<TaskId> for String {
    fn from(value: TaskId) -> Self {
        value.0
    }
}
impl TaskId {
    pub fn as_str(&self) -> &str {
        &self.0
    }
    pub fn branch(&self) -> String {
        format!("codex/pero-{}", self.0)
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Contribution {
    pub task_id: TaskId,
    pub repository: Repository,
    pub workspace: PathBuf,
    pub branch: String,
    pub base: String,
    pub base_head: String,
    pub title: String,
    pub source_url: String,
    pub source_revision: String,
    pub pr_url: Option<String>,
}
impl Contribution {
    pub fn new(
        task_id: TaskId,
        repository: Repository,
        workspace: PathBuf,
        title: String,
        source_url: String,
        source_revision: String,
    ) -> Result<Self, ContributionError> {
        if title.trim().is_empty() || title.len() > 1000 || title.contains(['\r', '\n', '\0']) {
            return Err(ContributionError::new(
                "invalid_title",
                "The contribution needs a title of one line",
            ));
        }
        if !source_url.starts_with(&format!("https://github.com/{}/", repository.as_str()))
            || source_url.len() > 2048
            || source_url.chars().any(char::is_control)
        {
            return Err(ContributionError::new(
                "invalid_source",
                "The source must belong to the selected GitHub repository",
            ));
        }
        if source_revision.is_empty()
            || source_revision.len() > 256
            || source_revision.chars().any(char::is_control)
        {
            return Err(ContributionError::new(
                "invalid_revision",
                "Refresh the public task before preparing its workspace",
            ));
        }
        Ok(Self {
            branch: task_id.branch(),
            task_id,
            repository,
            workspace,
            base: String::new(),
            base_head: String::new(),
            title,
            source_url,
            source_revision,
            pr_url: None,
        })
    }
    pub fn review_matches(&self, expected: &str, current: &str) -> Result<(), ContributionError> {
        if expected.is_empty() || expected != current {
            Err(ContributionError::new(
                "review_changed",
                "Files changed after review. Refresh the diff before creating the PR.",
            ))
        } else {
            Ok(())
        }
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct ContributionSnapshot {
    #[serde(flatten)]
    pub contribution: Contribution,
    pub head: String,
    pub review_token: String,
    pub diff: String,
    pub changed_files: Vec<String>,
    pub status: String,
    pub gh_available: bool,
    pub gh_authenticated: bool,
}
#[derive(Clone, Debug, Serialize)]
pub struct ContributionError {
    pub code: String,
    pub message: String,
}
impl ContributionError {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}
impl std::fmt::Display for ContributionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}
impl std::error::Error for ContributionError {}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn contribution_invariants() {
        for (repo, valid) in [
            ("phodal/pero", true),
            ("user/name.with-dashes", true),
            ("../pero", false),
            ("-x/repo", false),
            ("user/repo/extra", false),
            ("user/;cmd", false),
        ] {
            assert_eq!(
                Repository::try_from(repo.to_string()).is_ok(),
                valid,
                "{repo}"
            );
        }
        for (id, valid) in [("task_123", true), ("../bad", false), ("", false)] {
            assert_eq!(TaskId::try_from(id.to_string()).is_ok(), valid);
        }
        let c = Contribution::new(
            TaskId::try_from("task_123".to_string()).unwrap(),
            Repository::try_from("phodal/pero".to_string()).unwrap(),
            PathBuf::from("/work"),
            "Fix layout".into(),
            "https://github.com/phodal/pero/issues/1".into(),
            "revision-1".into(),
        )
        .unwrap();
        assert_eq!(c.branch, "codex/pero-task_123");
        for (expected, current, valid) in [
            ("abc", "abc", true),
            ("abc", "changed", false),
            ("", "", false),
        ] {
            assert_eq!(c.review_matches(expected, current).is_ok(), valid);
        }
    }
}
