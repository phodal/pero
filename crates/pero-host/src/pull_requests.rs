//! GitHub PR shell, shared by Electron and Native through Host JSONL.
use pero_contracts::{HostEvent, pull_request::*};
use pero_runtime::contribution_git::{GitHub, GitHubCli};
use serde::Deserialize;
use std::path::Path;
#[path = "pull_request_discussions.rs"]
mod discussions;

pub fn dispatch(value: serde_json::Value, agents: &crate::agents::Manager) {
    let request_id = value["request_id"].as_str().map(str::to_owned);
    let request: PullRequestRequest = match serde_json::from_value(value) {
        Ok(request) => request,
        Err(error) => {
            let _ = crate::emit(HostEvent::new(
                "pull_request_error",
                request_id,
                error.to_string(),
            ));
            return;
        }
    };
    let workspace = match &request.action {
        PullRequestAction::Load { .. } | PullRequestAction::List { .. }
        | PullRequestAction::Reply { .. } | PullRequestAction::SetResolved { .. }
        | PullRequestAction::AddDiscussion { .. } => {
            Some(agents.workspace().to_owned())
        }
        PullRequestAction::Discover { thread_id } => agents.artifact_workspace(thread_id),
    };
    std::thread::spawn(move || {
        let mut event = HostEvent::new(
            "pull_request_error",
            Some(request.request_id),
            String::new(),
        );
        let result = (|| {
            let workspace = workspace.ok_or("Conversation workspace is unavailable")?;
            match request.action {
                PullRequestAction::Load { reference } => {
                    let snapshot = load(&GitHubCli, &workspace, reference)?;
                    event.kind = "pull_request_loaded".into();
                    event.data = serde_json::to_value(snapshot).expect("PR snapshot");
                }
                PullRequestAction::List { repository, state } => {
                    let items = list(&GitHubCli, &workspace, &repository, state)?;
                    event.kind = "pull_request_listed".into();
                    event.data = serde_json::json!({
                        "repository": repository.slug(),
                        "state": state,
                        "items": items,
                    });
                }
                PullRequestAction::Discover { thread_id } => {
                    event.thread_id = Some(thread_id);
                    let output = GitHubCli
                        .run(&workspace, &["pr", "view", "--json", "url"])
                        .map_err(|error| error.message)?;
                    #[derive(Deserialize)]
                    struct Found {
                        url: PullRequestRef,
                    }
                    let found: Found =
                        serde_json::from_str(&output).map_err(|error| error.to_string())?;
                    event.kind = "pull_request_discovered".into();
                    event.data = serde_json::json!({"reference":found.url});
                }
                PullRequestAction::Reply { reference, discussion_id, body } => {
                    let discussion = discussions::update(&GitHubCli, &workspace, &reference, &discussion_id, discussions::Mutation::Reply(body))?;
                    discussion_event(&mut event, reference, discussion);
                }
                PullRequestAction::SetResolved { reference, discussion_id, resolved } => {
                    let discussion = discussions::update(&GitHubCli, &workspace, &reference, &discussion_id, discussions::Mutation::SetResolved(resolved))?;
                    discussion_event(&mut event, reference, discussion);
                }
                PullRequestAction::AddDiscussion { reference, discussion } => {
                    let discussion = discussions::add(&GitHubCli, &workspace, &reference, discussion)?;
                    discussion_event(&mut event, reference, discussion);
                }
            }
            Ok::<_, String>(())
        })();
        if let Err(error) = result {
            event.text = error;
        }
        let _ = crate::emit(event);
    });
}

fn discussion_event(event: &mut HostEvent, reference: PullRequestRef, discussion: Option<PullRequestDiscussion>) {
    if let Some(discussion) = discussion {
        event.kind = "pull_request_discussion_updated".into();
        event.data = serde_json::to_value(PullRequestDiscussionUpdated { reference, discussion }).expect("discussion update");
    } else {
        event.kind = "pull_request_discussion_published".into();
        event.data = serde_json::json!({"reference":reference});
    }
}

#[derive(Deserialize)]
struct ApiAuthor {
    login: String,
}
#[derive(Deserialize)]
struct ApiBranch {
    #[serde(rename = "ref")]
    name: String,
    sha: String,
}
#[derive(Deserialize)]
struct ApiPull {
    title: String,
    body: Option<String>,
    state: String,
    draft: bool,
    merged: bool,
    user: ApiAuthor,
    base: ApiBranch,
    head: ApiBranch,
    additions: u64,
    deletions: u64,
    changed_files: u64,
    #[serde(default, rename = "created_at")]
    created_at: String,
    #[serde(default, rename = "mergeable_state")]
    mergeable_state: String,
}
fn api(
    github: &impl GitHub,
    workspace: &Path,
    path: &str,
    query: Option<&str>,
) -> Result<String, String> {
    let mut args = vec!["api", "--hostname", "github.com", "--method", "GET", path];
    if let Some(query) = query {
        args.extend(["--paginate", "--jq", query]);
    }
    github.run(workspace, &args).map_err(|error| error.message)
}
fn section<T: serde::de::DeserializeOwned>(
    github: &impl GitHub,
    workspace: &Path,
    path: &str,
    query: &str,
) -> PullRequestSection<T> {
    match api(github, workspace, path, Some(query)).and_then(|text| {
        serde_json::Deserializer::from_str(&text).into_iter::<Vec<T>>().collect::<Result<Vec<_>,_>>().map(|pages|pages.into_iter().flatten().collect()).map_err(|error| format!("Invalid GitHub response: {error}"))
    }) {
        Ok(items) => PullRequestSection { items, error: None },
        Err(error) => PullRequestSection {
            items: vec![],
            error: Some(error),
        },
    }
}
#[derive(Deserialize)]
struct ListedAuthor {
    login: String,
}
#[derive(Deserialize)]
struct ListedPull {
    number: u64,
    title: String,
    url: Option<String>,
    author: Option<ListedAuthor>,
    #[serde(rename = "isDraft")]
    is_draft: bool,
    state: String,
    additions: u64,
    deletions: u64,
    #[serde(default, rename = "createdAt")]
    created_at: String,
    #[serde(default, rename = "reviewDecision")]
    review_decision: String,
    #[serde(default, rename = "mergeStateStatus")]
    merge_state: String,
}
fn list(
    github: &impl GitHub,
    workspace: &Path,
    repository: &RepositoryName,
    state: PullRequestListState,
) -> Result<Vec<PullRequestSummary>, String> {
    let limit = LIST_LIMIT.to_string();
    let output = github
        .run(
            workspace,
            &[
                "pr",
                "list",
                "--repo",
                repository.slug(),
                "--state",
                state.argument(),
                "--limit",
                &limit,
                "--json",
                "number,title,url,author,isDraft,state,additions,deletions,createdAt,reviewDecision,mergeStateStatus",
            ],
        )
        .map_err(|error| error.message)?;
    let rows: Vec<ListedPull> = serde_json::from_str(&output)
        .map_err(|error| format!("Invalid GitHub pull request list: {error}"))?;
    rows.into_iter()
        .map(|row| listed_summary(repository, row))
        .collect()
}
fn listed_summary(
    repository: &RepositoryName,
    row: ListedPull,
) -> Result<PullRequestSummary, String> {
    let reference = match row.url {
        Some(url) => PullRequestRef::try_from(url)?,
        None => PullRequestRef::try_from(format!(
            "https://github.com/{}/pull/{}",
            repository.slug(),
            row.number
        ))?,
    };
    if reference.repository() != repository.slug() || reference.number() != row.number.to_string() {
        return Err("GitHub returned a pull request from another repository".into());
    }
    let status = match row.state.to_ascii_uppercase().as_str() {
        "MERGED" => PullRequestStatus::observed("closed", false, true)?,
        "CLOSED" => PullRequestStatus::observed("closed", false, false)?,
        "OPEN" => PullRequestStatus::observed("open", row.is_draft, false)?,
        _ => return Err("Unrecognized GitHub pull request state".into()),
    };
    Ok(PullRequestSummary {
        reference,
        title: row.title,
        status,
        author: row.author.map(|author| author.login).unwrap_or_default(),
        additions: row.additions,
        deletions: row.deletions,
        opened_at: row.created_at,
        review: ReviewDecision::observed(&row.review_decision),
        blocked: merge_blocked(&row.merge_state),
    })
}
fn load(
    github: &impl GitHub,
    workspace: &Path,
    reference: PullRequestRef,
) -> Result<PullRequestSnapshot, String> {
    let path = reference.api_path();
    let pull: ApiPull = serde_json::from_str(&api(github, workspace, &path, None)?)
        .map_err(|error| format!("Invalid GitHub pull request: {error}"))?;
    let status = PullRequestStatus::observed(&pull.state, pull.draft, pull.merged)?;
    let files = section(
        github,
        workspace,
        &format!("{path}/files?per_page=100"),
        "[.[]|{filename,previous_filename:(.previous_filename // null),status,additions,deletions,patch:(.patch // null)}]",
    );
    let commits = section(
        github,
        workspace,
        &format!("{path}/commits?per_page=100"),
        "[.[]|{sha,message:.commit.message,author:(.author.login // .commit.author.name // \"unknown\")}]",
    );
    let mut checks = section(
        github,
        workspace,
        &format!(
            "repos/{}/commits/{}/check-runs?per_page=100",
            reference.repository(),
            pull.head.sha
        ),
        "[.check_runs[]|{name,status,conclusion:(.conclusion // null),url:(.html_url // null)}]",
    );
    let statuses = section(
        github,
        workspace,
        &format!(
            "repos/{}/commits/{}/statuses?per_page=100",
            reference.repository(),
            pull.head.sha
        ),
        "[.[]|{name:.context,status:.state,conclusion:null,url:(.target_url // null)}]",
    );
    checks.items.extend(statuses.items);
    if let Some(error) = statuses.error {
        checks.error = Some(error);
    }
    let mut reviews = section(
        github,
        workspace,
        &format!("{path}/reviews?per_page=100"),
        "[.[]|{author:(.user.login // \"unknown\"),state,body:(.body // \"\")}]",
    );
    let comments = section(
        github,
        workspace,
        &format!(
            "repos/{}/issues/{}/comments?per_page=100",
            reference.repository(),
            reference.number()
        ),
        "[.[]|{author:(.user.login // \"unknown\"),state:\"COMMENTED\",body:(.body // \"\")}]",
    );
    reviews.items.extend(comments.items);
    if let Some(error) = comments.error {
        reviews.error = Some(error);
    }
    let discussions = match discussions::read(github, workspace, &reference) {
        Ok(items) => PullRequestSection { items, error: None },
        Err(error) => PullRequestSection { items: vec![], error: Some(error) },
    };
    Ok(PullRequestSnapshot {
        reference,
        title: pull.title,
        body: pull.body.unwrap_or_default(),
        status,
        author: pull.user.login,
        base: pull.base.name,
        head: pull.head.name,
        head_sha: pull.head.sha,
        base_sha: pull.base.sha,
        additions: pull.additions,
        deletions: pull.deletions,
        changed_files: pull.changed_files,
        opened_at: pull.created_at,
        mergeable_state: pull.mergeable_state,
        files,
        commits,
        checks,
        reviews,
        discussions,
    })
}
