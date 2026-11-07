//! GitHub PR identity and observed review data. No transport or clock lives here.
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct PullRequestRef(String);
impl TryFrom<String> for PullRequestRef {
    type Error = String;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        let url = url::Url::parse(value.trim()).map_err(|_| "Invalid pull request URL")?;
        let parts: Vec<_> = url.path().trim_matches('/').split('/').collect();
        if !matches!(url.scheme(), "https" | "http")
            || !matches!(url.host_str(), Some("github.com" | "www.github.com"))
            || !url.username().is_empty()
            || url.password().is_some()
            || url.port().is_some()
            || parts.len() < 4
            || parts[2] != "pull"
            || !parts[..2].iter().all(|part| {
                !part.is_empty()
                    && *part != "."
                    && *part != ".."
                    && part
                        .bytes()
                        .all(|c| c.is_ascii_alphanumeric() || b"_.-".contains(&c))
            })
            || parts[3]
                .parse::<u64>()
                .ok()
                .filter(|n| *n > 0 && n.to_string() == parts[3])
                .is_none()
        {
            return Err("Expected a GitHub pull request URL".into());
        }
        Ok(Self(format!(
            "https://github.com/{}/{}/pull/{}",
            parts[0].to_ascii_lowercase(),
            parts[1].to_ascii_lowercase(),
            parts[3]
        )))
    }
}
impl From<PullRequestRef> for String {
    fn from(value: PullRequestRef) -> Self {
        value.0
    }
}
impl PullRequestRef {
    pub fn url(&self) -> &str {
        &self.0
    }
    pub fn repository(&self) -> &str {
        self.0
            .strip_prefix("https://github.com/")
            .unwrap()
            .split("/pull/")
            .next()
            .unwrap()
    }
    pub fn number(&self) -> &str {
        self.0.rsplit('/').next().unwrap()
    }
    pub fn api_path(&self) -> String {
        format!("repos/{}/pulls/{}", self.repository(), self.number())
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PullRequestTab {
    #[default]
    Changes,
    Description,
    Commits,
    Checks,
    Reviews,
}
impl PullRequestTab {
    pub const ALL: [Self; 5] = [
        Self::Changes,
        Self::Description,
        Self::Commits,
        Self::Checks,
        Self::Reviews,
    ];
    pub fn key(self) -> &'static str {
        match self {
            Self::Changes => "pr.changes",
            Self::Description => "pr.description",
            Self::Commits => "pr.commits",
            Self::Checks => "pr.checks",
            Self::Reviews => "pr.reviews",
        }
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PullRequestStatus {
    Open,
    Draft,
    Closed,
    Merged,
}
impl PullRequestStatus {
    pub fn observed(state: &str, draft: bool, merged: bool) -> Result<Self, String> {
        match (state, draft, merged) {
            ("closed", _, true) => Ok(Self::Merged),
            ("closed", _, false) => Ok(Self::Closed),
            ("open", true, false) => Ok(Self::Draft),
            ("open", false, false) => Ok(Self::Open),
            _ => Err("Unrecognized GitHub pull request state".into()),
        }
    }
    pub fn key(self) -> &'static str {
        match self {
            Self::Open => "pr.open",
            Self::Draft => "pr.draft",
            Self::Closed => "pr.closed",
            Self::Merged => "pr.merged",
        }
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PullRequestSection<T> {
    pub items: Vec<T>,
    pub error: Option<String>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PullRequestFile {
    pub filename: String,
    pub previous_filename: Option<String>,
    pub status: String,
    pub additions: u64,
    pub deletions: u64,
    pub patch: Option<String>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PullRequestCommit {
    pub sha: String,
    pub message: String,
    pub author: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PullRequestCheck {
    pub name: String,
    pub status: String,
    pub conclusion: Option<String>,
    pub url: Option<String>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PullRequestReview {
    pub author: String,
    pub state: String,
    pub body: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PullRequestSnapshot {
    pub reference: PullRequestRef,
    pub title: String,
    pub body: String,
    pub status: PullRequestStatus,
    pub author: String,
    pub base: String,
    pub head: String,
    pub head_sha: String,
    pub additions: u64,
    pub deletions: u64,
    pub changed_files: u64,
    pub files: PullRequestSection<PullRequestFile>,
    pub commits: PullRequestSection<PullRequestCommit>,
    pub checks: PullRequestSection<PullRequestCheck>,
    pub reviews: PullRequestSection<PullRequestReview>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
pub enum PullRequestAction {
    Load { reference: PullRequestRef },
    Discover { thread_id: String },
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum PullRequestMethod {
    #[serde(rename = "pull_requests")]
    PullRequests,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PullRequestRequest {
    pub method: PullRequestMethod,
    pub request_id: String,
    #[serde(flatten)]
    pub action: PullRequestAction,
}

/// Data availability, request progress and GitHub outcomes are independent.
#[derive(Clone, Debug)]
pub struct PullRequestView {
    pub reference: PullRequestRef,
    pub snapshot: Option<PullRequestSnapshot>,
    pub pending: Option<String>,
    pub error: Option<String>,
    pub tab: PullRequestTab,
    pub selected_file: Option<String>,
}
impl PullRequestView {
    pub fn new(reference: PullRequestRef) -> Self {
        Self {
            reference,
            snapshot: None,
            pending: None,
            error: None,
            tab: Default::default(),
            selected_file: None,
        }
    }
    pub fn refresh(&mut self, request_id: String) {
        self.pending = Some(request_id);
        self.error = None;
    }
    pub fn receive(
        &mut self,
        request_id: &str,
        result: Result<PullRequestSnapshot, String>,
    ) -> bool {
        if self.pending.as_deref() != Some(request_id) {
            return false;
        }
        self.pending = None;
        match result {
            Ok(mut snapshot) if snapshot.reference == self.reference => {
                if let Some(previous) = &self.snapshot {
                    macro_rules! retain {
                        ($section:ident) => {
                            if snapshot.$section.error.is_some()
                                && snapshot.$section.items.is_empty()
                            {
                                snapshot.$section.items = previous.$section.items.clone();
                            }
                        };
                    }
                    retain!(files);
                    retain!(commits);
                    retain!(checks);
                    retain!(reviews);
                }
                if !snapshot
                    .files
                    .items
                    .iter()
                    .any(|file| Some(&file.filename) == self.selected_file.as_ref())
                {
                    self.selected_file = snapshot
                        .files
                        .items
                        .first()
                        .map(|file| file.filename.clone());
                }
                self.snapshot = Some(snapshot);
                self.error = None;
            }
            Ok(_) => self.error = Some("GitHub returned a different pull request".into()),
            Err(error) => self.error = Some(error),
        }
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pull_request_identity_admission() {
        for (url, expected) in [
            (
                "https://github.com/Phodal/Pero/pull/164",
                Some("https://github.com/phodal/pero/pull/164"),
            ),
            (
                "https://www.github.com/phodal/pero/pull/164/files?x=1#diff-a",
                Some("https://github.com/phodal/pero/pull/164"),
            ),
            ("https://github.com/phodal/pero/issues/164", None),
            ("https://github.com.evil.org/phodal/pero/pull/164", None),
            ("https://user@github.com/phodal/pero/pull/1", None),
            ("https://github.com/phodal/pero/pull/0", None),
            ("https://github.com/phodal/pero/pull/01", None),
            ("https://github.com/phodal/pero/pull/-1", None),
            (
                "https://github.com/phodal/pero/pull/99999999999999999999",
                None,
            ),
            ("file:///phodal/pero/pull/1", None),
        ] {
            assert_eq!(
                PullRequestRef::try_from(url.to_owned())
                    .ok()
                    .map(String::from)
                    .as_deref(),
                expected,
                "{url}"
            );
        }
    }
    #[test]
    fn observed_states_have_distinct_outcomes() {
        for (state, draft, merged, expected) in [
            ("open", false, false, Some(PullRequestStatus::Open)),
            ("open", true, false, Some(PullRequestStatus::Draft)),
            ("closed", false, false, Some(PullRequestStatus::Closed)),
            ("closed", true, true, Some(PullRequestStatus::Merged)),
            ("open", false, true, None),
            ("unknown", false, false, None),
        ] {
            assert_eq!(
                PullRequestStatus::observed(state, draft, merged).ok(),
                expected
            );
        }
    }
    #[test]
    fn read_requests_decode_at_the_boundary() {
        for request in [
            serde_json::json!({"method":"pull_requests","action":"load","request_id":"a","reference":"https://github.com/phodal/pero/pull/164"}),
            serde_json::json!({"method":"pull_requests","action":"discover","request_id":"b","thread_id":"thread"}),
        ] {
            let decoded: PullRequestRequest = serde_json::from_value(request).unwrap();
            assert!(!decoded.request_id.is_empty());
            let mut unknown = serde_json::to_value(decoded).unwrap();
            unknown["extra"] = true.into();
            assert!(serde_json::from_value::<PullRequestRequest>(unknown).is_err());
        }
    }
    fn snapshot() -> PullRequestSnapshot {
        serde_json::from_value(serde_json::json!({
            "reference":"https://github.com/phodal/pero/pull/164","title":"Review","body":"Description","status":"open",
            "author":"author","base":"master","head":"feature","head_sha":"abc","additions":1,"deletions":0,"changed_files":1,
            "files":{"items":[{"filename":"a.rs","previous_filename":null,"status":"added","additions":1,"deletions":0,"patch":"@@ -0,0 +1 @@\n+hello"}],"error":null},
            "commits":{"items":[],"error":null},"checks":{"items":[],"error":null},"reviews":{"items":[],"error":null}
        })).unwrap()
    }
    #[test]
    fn refresh_keeps_content_selection_and_localizes_failures() {
        let original = snapshot();
        let mut view = PullRequestView::new(original.reference.clone());
        view.refresh("first".into());
        assert!(view.receive("first", Ok(original.clone())));
        view.tab = PullRequestTab::Checks;
        view.refresh("second".into());
        assert_eq!(view.snapshot, Some(original.clone()));
        assert!(!view.receive("first", Err("late".into())));
        assert_eq!(view.pending.as_deref(), Some("second"));
        assert!(view.receive("second", Err("offline".into())));
        assert_eq!(view.snapshot, Some(original.clone()));
        assert_eq!(view.selected_file.as_deref(), Some("a.rs"));
        assert_eq!(view.tab, PullRequestTab::Checks);
        let mut partial = original.clone();
        partial.files.items.clear();
        partial.files.error = Some("forbidden".into());
        partial.title = "New title".into();
        view.refresh("third".into());
        view.receive("third", Ok(partial));
        let retained = view.snapshot.as_ref().unwrap();
        assert_eq!(retained.title, "New title");
        assert_eq!(retained.files.items, original.files.items);
        assert_eq!(retained.files.error.as_deref(), Some("forbidden"));
        let mut other = original;
        other.reference =
            PullRequestRef::try_from("https://github.com/phodal/pero/pull/165".to_owned()).unwrap();
        view.refresh("fourth".into());
        view.receive("fourth", Ok(other));
        assert!(view.error.is_some());
        assert_eq!(view.snapshot.as_ref().unwrap().reference, view.reference);
    }
}
