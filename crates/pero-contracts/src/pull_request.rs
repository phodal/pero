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
    pub fn index(self) -> usize {
        Self::ALL.iter().position(|tab| *tab == self).unwrap_or(0)
    }
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

/// GitHub statuses in the order a repository list shows them.
/// Queued, ready and stack are not GitHub list fields.
pub fn present_statuses(items: impl IntoIterator<Item = PullRequestStatus>) -> Vec<PullRequestStatus> {
    let found: Vec<_> = items.into_iter().collect();
    [PullRequestStatus::Open, PullRequestStatus::Draft, PullRequestStatus::Closed, PullRequestStatus::Merged]
        .into_iter()
        .filter(|status| found.contains(status))
        .collect()
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReviewDecision {
    #[default]
    None,
    Approved,
    ChangesRequested,
    ReviewRequired,
}
impl ReviewDecision {
    pub fn observed(value: &str) -> Self {
        match value.to_ascii_uppercase().as_str() {
            "APPROVED" => Self::Approved,
            "CHANGES_REQUESTED" => Self::ChangesRequested,
            "REVIEW_REQUIRED" => Self::ReviewRequired,
            _ => Self::None,
        }
    }
    pub fn from_reviews(items: &[PullRequestReview]) -> Self {
        let mut approved = false;
        for review in items {
            match review.state.as_str() {
                "CHANGES_REQUESTED" => return Self::ChangesRequested,
                "APPROVED" => approved = true,
                _ => {}
            }
        }
        if approved { Self::Approved } else { Self::None }
    }
    pub fn key(self) -> Option<&'static str> {
        match self {
            Self::None => None,
            Self::Approved => Some("pr.approved"),
            Self::ChangesRequested => Some("pr.changes_requested"),
            Self::ReviewRequired => Some("pr.review_required"),
        }
    }
}

pub fn merge_blocked(state: &str) -> bool {
    state.eq_ignore_ascii_case("blocked")
}

/// Active-route refresh. Cursor's default self-heal interval is 5 minutes.
pub const ACTIVE_REFRESH: std::time::Duration = std::time::Duration::from_secs(5 * 60);
pub const LIST_LIMIT: u32 = 30;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct RepositoryName(String);
impl TryFrom<String> for RepositoryName {
    type Error = String;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::parse(&value).ok_or_else(|| "Expected owner/name".into())
    }
}
impl From<RepositoryName> for String {
    fn from(value: RepositoryName) -> Self {
        value.0
    }
}
impl RepositoryName {
    pub fn parse(value: &str) -> Option<Self> {
        let (owner, name) = value.split_once('/')?;
        if value.matches('/').count() != 1 || !repo_part(owner) || !repo_part(name) {
            return None;
        }
        Some(Self(format!(
            "{}/{}",
            owner.to_ascii_lowercase(),
            name.to_ascii_lowercase()
        )))
    }
    pub fn slug(&self) -> &str {
        &self.0
    }
}
fn repo_part(value: &str) -> bool {
    !value.is_empty()
        && value != "."
        && value != ".."
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"_.-".contains(&byte))
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PullRequestListState {
    #[default]
    Open,
    Closed,
    All,
}
impl PullRequestListState {
    pub fn argument(self) -> &'static str {
        match self {
            Self::Open => "open",
            Self::Closed => "closed",
            Self::All => "all",
        }
    }
    pub fn key(self) -> &'static str {
        match self {
            Self::Open => "pr.list_open",
            Self::Closed => "pr.list_closed",
            Self::All => "pr.list_all",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PullRequestSummary {
    pub reference: PullRequestRef,
    pub title: String,
    pub status: PullRequestStatus,
    pub author: String,
    pub additions: u64,
    pub deletions: u64,
    #[serde(default)]
    pub opened_at: String,
    #[serde(default)]
    pub review: ReviewDecision,
    #[serde(default)]
    pub blocked: bool,
}
impl PullRequestSummary {
    pub fn label(&self) -> String {
        format!("#{}", self.reference.number())
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PullRequestList {
    pub repository: RepositoryName,
    pub state: PullRequestListState,
    pub items: Vec<PullRequestSummary>,
}

pub fn mentions(text: &str) -> Vec<PullRequestRef> {
    let mut found = Vec::new();
    let mut rest = text;
    while let Some(start) = rest.find("https://").or_else(|| rest.find("http://")) {
        let scheme = if rest[start..].starts_with("https://") {
            8
        } else {
            7
        };
        let tail = &rest[start + scheme..];
        let end = tail
            .find(|c: char| c.is_whitespace() || matches!(c, ')' | '>' | ']' | '"' | '\'' | ','))
            .unwrap_or(tail.len());
        let candidate = rest[start..start + scheme + end].trim_end_matches('.');
        if let Ok(reference) = PullRequestRef::try_from(candidate.to_owned()) {
            if !found.contains(&reference) {
                found.push(reference);
            }
        }
        rest = &rest[start + scheme + end..];
    }
    found
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
    #[serde(default)]
    pub opened_at: String,
    #[serde(default)]
    pub mergeable_state: String,
}
impl PullRequestSnapshot {
    pub fn summary(&self) -> PullRequestSummary {
        PullRequestSummary {
            reference: self.reference.clone(),
            title: self.title.clone(),
            status: self.status,
            author: self.author.clone(),
            additions: self.additions,
            deletions: self.deletions,
            opened_at: self.opened_at.clone(),
            review: ReviewDecision::from_reviews(&self.reviews.items),
            blocked: merge_blocked(&self.mergeable_state),
        }
    }
    /// Keep sections whose GitHub pulse did not change. An explicit refresh
    /// replaces the snapshot instead of calling this.
    pub fn absorb(self, next: Self) -> (Self, SectionRefresh) {
        if next.reference != self.reference {
            return (self, SectionRefresh::none());
        }
        let files =
            next.head_sha != self.head_sha || next.commits.items.len() != self.commits.items.len();
        let checks =
            files || check_fingerprint(&next.checks.items) != check_fingerprint(&self.checks.items);
        let reviews = next.reviews.items.len() != self.reviews.items.len()
            || ReviewDecision::from_reviews(&next.reviews.items) != ReviewDecision::from_reviews(&self.reviews.items);
        let body = next.body != self.body;
        let mut merged = self;
        merged.title = next.title;
        merged.status = next.status;
        merged.author = next.author;
        merged.opened_at = next.opened_at;
        merged.mergeable_state = next.mergeable_state;
        if body {
            merged.body = next.body;
        }
        if files {
            merged.head = next.head;
            merged.head_sha = next.head_sha;
            merged.base = next.base;
            merged.additions = next.additions;
            merged.deletions = next.deletions;
            merged.changed_files = next.changed_files;
            merged.files = next.files;
            merged.commits = next.commits;
        }
        if checks {
            merged.checks = next.checks;
        }
        if reviews {
            merged.reviews = next.reviews;
        }
        (
            merged,
            SectionRefresh {
                files,
                commits: files,
                checks,
                reviews,
                body,
            },
        )
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct SectionRefresh {
    pub files: bool,
    pub commits: bool,
    pub checks: bool,
    pub reviews: bool,
    pub body: bool,
}
impl SectionRefresh {
    pub fn all() -> Self {
        Self {
            files: true,
            commits: true,
            checks: true,
            reviews: true,
            body: true,
        }
    }
    pub fn none() -> Self {
        Self::default()
    }
}

fn check_fingerprint(items: &[PullRequestCheck]) -> String {
    items
        .iter()
        .map(|check| {
            format!(
                "{}|{}|{}",
                check.name,
                check.status,
                check.conclusion.as_deref().unwrap_or("")
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[path = "pull_request_time.rs"]
mod time;
pub use time::{OpenedAgo, OpenedUnit, avatar_url, opened_ago, opened_day};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
pub enum PullRequestAction {
    Load { reference: PullRequestRef },
    Discover { thread_id: String },
    List {
        repository: RepositoryName,
        state: PullRequestListState,
    },
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

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ViewedFile {
    pub path: String,
    pub head: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ViewedStatus {
    Unseen,
    Viewed,
    Stale,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PullRequestReading {
    pub reference: PullRequestRef,
    pub tab: PullRequestTab,
    pub selected_file: Option<String>,
    pub viewed: Vec<ViewedFile>,
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
    pub viewed: Vec<ViewedFile>,
    partial: bool,
    pub sections: SectionRefresh,
    pub hide_viewed: bool,
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
            viewed: Vec::new(),
            partial: false,
            sections: SectionRefresh::all(),
            hide_viewed: false,
        }
    }
    pub fn refresh(&mut self, request_id: String) {
        self.refresh_with(request_id, false);
    }
    pub fn refresh_observed(&mut self, request_id: String) {
        self.refresh_with(request_id, true);
    }
    fn refresh_with(&mut self, request_id: String, partial: bool) {
        self.pending = Some(request_id);
        self.error = None;
        self.partial = partial;
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
        let partial = std::mem::take(&mut self.partial);
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
                if partial {
                    if let Some(previous) = self.snapshot.clone() {
                        let (merged, sections) = previous.absorb(snapshot);
                        snapshot = merged;
                        self.sections = sections;
                    } else {
                        self.sections = SectionRefresh::all();
                    }
                } else {
                    self.sections = SectionRefresh::all();
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
    pub fn mark_viewed(&mut self, path: &str) {
        let Some(head) = self
            .snapshot
            .as_ref()
            .map(|snapshot| snapshot.head_sha.clone())
        else {
            return;
        };
        if head.is_empty() || path.is_empty() {
            return;
        }
        if let Some(mark) = self.viewed.iter_mut().find(|file| file.path == path) {
            mark.head = head;
        } else {
            self.viewed.push(ViewedFile {
                path: path.into(),
                head,
            });
        }
    }
    pub fn unmark_viewed(&mut self, path: &str) {
        self.viewed.retain(|file| file.path != path);
    }
    pub fn viewed_status(&self, path: &str) -> ViewedStatus {
        let Some(mark) = self.viewed.iter().find(|file| file.path == path) else {
            return ViewedStatus::Unseen;
        };
        let current = self
            .snapshot
            .as_ref()
            .map(|snapshot| snapshot.head_sha.as_str());
        if current == Some(mark.head.as_str()) {
            ViewedStatus::Viewed
        } else {
            ViewedStatus::Stale
        }
    }
    pub fn shows_file(&self, path: &str) -> bool {
        !self.hide_viewed || self.viewed_status(path) != ViewedStatus::Viewed
    }
    pub fn reading(&self) -> PullRequestReading {
        PullRequestReading {
            reference: self.reference.clone(),
            tab: self.tab,
            selected_file: self.selected_file.clone(),
            viewed: self.viewed.clone(),
        }
    }
    pub fn restore_reading(&mut self, reading: PullRequestReading) {
        if reading.reference != self.reference {
            return;
        }
        self.tab = reading.tab;
        self.selected_file = reading.selected_file;
        self.viewed = reading.viewed;
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
        assert_eq!(
            present_statuses([
                PullRequestStatus::Merged,
                PullRequestStatus::Open,
                PullRequestStatus::Draft,
                PullRequestStatus::Open,
            ]),
            vec![
                PullRequestStatus::Open,
                PullRequestStatus::Draft,
                PullRequestStatus::Merged,
            ]
        );
    }
    #[test]
    fn read_requests_decode_at_the_boundary() {
        for request in [
            serde_json::json!({"method":"pull_requests","action":"load","request_id":"a","reference":"https://github.com/phodal/pero/pull/164"}),
            serde_json::json!({"method":"pull_requests","action":"discover","request_id":"b","thread_id":"thread"}),
            serde_json::json!({"method":"pull_requests","action":"list","request_id":"c","repository":"Phodal/Pero","state":"open"}),
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
    #[test]
    fn viewed_marks_follow_the_head_they_were_recorded_against() {
        let original = snapshot();
        let mut view = PullRequestView::new(original.reference.clone());
        view.mark_viewed("a.rs");
        assert_eq!(view.viewed_status("a.rs"), ViewedStatus::Unseen);
        view.refresh("first".into());
        view.receive("first", Ok(original.clone()));
        view.mark_viewed("a.rs");
        assert_eq!(view.viewed_status("a.rs"), ViewedStatus::Viewed);
        assert_eq!(view.snapshot.as_ref().unwrap().summary().label(), "#164");
        let mut next = original.clone();
        next.head_sha = "def".into();
        view.refresh("second".into());
        view.receive("second", Ok(next));
        assert_eq!(view.viewed_status("a.rs"), ViewedStatus::Stale);
        assert_eq!(view.tab, PullRequestTab::Changes);
        view.mark_viewed("a.rs");
        assert_eq!(view.viewed_status("a.rs"), ViewedStatus::Viewed);
        view.unmark_viewed("a.rs");
        assert_eq!(view.viewed_status("a.rs"), ViewedStatus::Unseen);
        let reading = view.reading();
        let encoded = serde_json::to_string(&reading).unwrap();
        let restored: PullRequestReading = serde_json::from_str(&encoded).unwrap();
        let mut fresh = PullRequestView::new(view.reference.clone());
        fresh.restore_reading(restored);
        assert_eq!(fresh.tab, view.tab);
        assert_eq!(fresh.selected_file.as_deref(), Some("a.rs"));
        assert!(fresh.viewed.is_empty());
        assert_eq!(ACTIVE_REFRESH.as_secs(), 300);
        assert_eq!(ReviewDecision::observed("CHANGES_REQUESTED"), ReviewDecision::ChangesRequested);
        assert!(merge_blocked("BLOCKED"));
        assert!(!merge_blocked("CLEAN"));
        let mut loaded = snapshot();
        loaded.mergeable_state = "blocked".into();
        assert!(loaded.summary().blocked);
        loaded.mergeable_state = "clean".into();
        assert!(!loaded.summary().blocked);
        view.hide_viewed = true;
        view.mark_viewed("a.rs");
        assert!(!view.shows_file("a.rs"));
        assert!(view.shows_file("missing.rs"));
        assert_eq!(LIST_LIMIT, 30);
        assert_eq!(
            mentions("See https://github.com/Phodal/Pero/pull/164/files and https://github.com/phodal/pero/pull/164.")
                .len(),
            1
        );
        assert!(RepositoryName::parse("../pero").is_none());
        assert_eq!(
            RepositoryName::parse("Phodal/Pero").unwrap().slug(),
            "phodal/pero"
        );
    }
    #[test]
    fn observed_refresh_keeps_sections_whose_pulse_did_not_change() {
        let opened = "2026-11-01T00:00:00Z";
        let now = super::time::parse_rfc3339("2026-11-07T00:00:00Z").unwrap();
        assert_eq!(
            opened_ago(opened, now),
            Some(OpenedAgo {
                count: 6,
                unit: OpenedUnit::Day
            })
        );
        assert_eq!(
            opened_ago(opened, super::time::parse_rfc3339(opened).unwrap() + 30),
            Some(OpenedAgo {
                count: 0,
                unit: OpenedUnit::Minute
            })
        );
        assert_eq!(opened_ago("2026-09-01T00:00:00Z", now), None);
        assert_eq!(opened_day(opened).as_deref(), Some("2026-11-01"));
        assert_eq!(
            avatar_url("phodal").as_deref(),
            Some("https://github.com/phodal.png")
        );
        assert!(avatar_url("../phodal").is_none());
        let mut original = snapshot();
        original.opened_at = opened.into();
        original.reviews.items.push(PullRequestReview {
            author: "ada".into(),
            state: "APPROVED".into(),
            body: "ok".into(),
        });
        let mut same = original.clone();
        same.files.items[0].patch = Some("changed without a new head".into());
        same.body = "rewritten".into();
        let (kept, sections) = original.clone().absorb(same);
        assert!(!sections.files && !sections.reviews && sections.body);
        assert_eq!(
            kept.files.items[0].patch.as_deref(),
            original.files.items[0].patch.as_deref()
        );
        assert_eq!(kept.body, "rewritten");
        let mut reviewed = original.clone();
        reviewed.reviews.items.push(PullRequestReview {
            author: "bea".into(),
            state: "COMMENTED".into(),
            body: "note".into(),
        });
        let (with_review, sections) = original.clone().absorb(reviewed.clone());
        assert!(sections.reviews && !sections.files);
        assert_eq!(with_review.reviews.items.len(), 2);
        let mut moved = original.clone();
        moved.head_sha = "def".into();
        moved.files.items[0].filename = "b.rs".into();
        let (advanced, sections) = original.absorb(moved);
        assert!(sections.files && sections.commits && sections.checks);
        assert_eq!(advanced.head_sha, "def");
        assert_eq!(advanced.files.items[0].filename, "b.rs");
        let mut view = PullRequestView::new(advanced.reference.clone());
        view.refresh("load".into());
        view.receive("load", Ok(advanced.clone()));
        view.refresh_observed("poll".into());
        let mut quiet = advanced.clone();
        quiet.title = "Renamed".into();
        assert!(view.receive("poll", Ok(quiet)));
        assert!(!view.sections.files);
        assert_eq!(view.snapshot.as_ref().unwrap().title, "Renamed");
        assert_eq!(view.snapshot.as_ref().unwrap().head_sha, "def");
        let mut edited = view.snapshot.clone().unwrap();
        edited.files.items[0].filename = "c.rs".into();
        view.refresh("manual".into());
        assert!(view.receive("manual", Ok(edited)));
        assert!(view.sections.files);
        assert_eq!(
            view.snapshot.as_ref().unwrap().files.items[0].filename,
            "c.rs"
        );
    }
}
