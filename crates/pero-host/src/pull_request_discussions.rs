//! GitHub review threads are read with GraphQL; individual comments publish via REST.
use pero_contracts::pull_request::*;
use pero_runtime::contribution_git::GitHub;
use serde::{Deserialize, de::DeserializeOwned};
use std::path::Path;

const COMMENT_FIELDS: &str = "id fullDatabaseId author{login} body url createdAt updatedAt diffHunk commit{oid} originalCommit{oid}";
const THREAD_FIELDS: &str = "id path line originalLine startLine originalStartLine diffSide startDiffSide isOutdated isResolved viewerCanReply viewerCanResolve viewerCanUnresolve";

#[derive(Deserialize)]
struct GraphqlError {
    message: String,
}
#[derive(Deserialize)]
struct GraphqlResponse<T> {
    data: Option<T>,
    #[serde(default)]
    errors: Vec<GraphqlError>,
}
fn graphql<T: DeserializeOwned>(
    github: &impl GitHub,
    workspace: &Path,
    operation: &str,
    query: &str,
    variables: &[(&str, String)],
) -> Result<T, String> {
    let mut args = vec![
        "api".to_owned(),
        "--hostname".into(),
        "github.com".into(),
        "graphql".into(),
        "-f".into(),
        format!("query={query}"),
        "-f".into(),
        format!("operationName={operation}"),
    ];
    for (name, value) in variables {
        args.push(if *name == "number" { "-F" } else { "-f" }.into());
        args.push(format!("{name}={value}"));
    }
    let args: Vec<_> = args.iter().map(String::as_str).collect();
    let response: GraphqlResponse<T> = serde_json::from_str(
        &github
            .run(workspace, &args)
            .map_err(|error| error.message)?,
    )
    .map_err(|error| format!("Invalid GitHub discussion response: {error}"))?;
    if !response.errors.is_empty() {
        return Err(response
            .errors
            .into_iter()
            .map(|error| error.message)
            .collect::<Vec<_>>()
            .join("; "));
    }
    response
        .data
        .ok_or_else(|| "GitHub discussion data is unavailable".into())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PageInfo {
    has_next_page: bool,
    end_cursor: Option<String>,
}
impl PageInfo {
    fn next(self) -> Result<Option<String>, String> {
        if self.has_next_page {
            self.end_cursor
                .map(Some)
                .ok_or_else(|| "GitHub omitted the discussion page cursor".into())
        } else {
            Ok(None)
        }
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Connection<T> {
    nodes: Vec<T>,
    page_info: PageInfo,
}
#[derive(Deserialize)]
struct Author {
    login: String,
}
#[derive(Deserialize)]
struct Commit {
    oid: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApiComment {
    id: String,
    full_database_id: Option<String>,
    author: Option<Author>,
    body: String,
    url: String,
    created_at: String,
    updated_at: String,
    diff_hunk: String,
    commit: Option<Commit>,
    original_commit: Option<Commit>,
}
impl From<ApiComment> for PullRequestDiscussionComment {
    fn from(comment: ApiComment) -> Self {
        Self {
            id: comment.id,
            author: comment
                .author
                .map(|author| author.login)
                .unwrap_or_else(|| "unknown".into()),
            body: comment.body,
            url: comment.url,
            created_at: comment.created_at,
            updated_at: comment.updated_at,
            diff_hunk: comment.diff_hunk,
            commit_sha: comment.commit.map(|commit| commit.oid),
            original_commit_sha: comment.original_commit.map(|commit| commit.oid),
        }
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "UPPERCASE")]
enum ApiSide {
    Left,
    Right,
}
impl From<ApiSide> for DiscussionSide {
    fn from(side: ApiSide) -> Self {
        match side {
            ApiSide::Left => Self::Left,
            ApiSide::Right => Self::Right,
        }
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApiDiscussion {
    id: String,
    path: String,
    line: Option<u32>,
    original_line: Option<u32>,
    start_line: Option<u32>,
    original_start_line: Option<u32>,
    diff_side: ApiSide,
    start_diff_side: Option<ApiSide>,
    is_outdated: bool,
    is_resolved: bool,
    viewer_can_reply: bool,
    viewer_can_resolve: bool,
    viewer_can_unresolve: bool,
    comments: Connection<ApiComment>,
}
impl From<ApiDiscussion> for PullRequestDiscussion {
    fn from(thread: ApiDiscussion) -> Self {
        Self {
            id: thread.id,
            path: thread.path,
            line: thread.line,
            original_line: thread.original_line,
            start_line: thread.start_line,
            original_start_line: thread.original_start_line,
            side: thread.diff_side.into(),
            start_side: thread.start_diff_side.map(Into::into),
            outdated: thread.is_outdated,
            resolved: thread.is_resolved,
            can_reply: thread.viewer_can_reply,
            can_resolve: thread.viewer_can_resolve,
            can_unresolve: thread.viewer_can_unresolve,
            comments: thread.comments.nodes.into_iter().map(Into::into).collect(),
        }
    }
}
#[derive(Deserialize)]
struct PullIdentity {
    url: PullRequestRef,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApiPull {
    url: PullRequestRef,
    review_threads: Connection<ApiDiscussion>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Repository {
    pull_request: Option<ApiPull>,
}
#[derive(Deserialize)]
struct ListData {
    repository: Option<Repository>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ThreadNode {
    #[serde(flatten)]
    thread: ApiDiscussion,
    pull_request: PullIdentity,
}
#[derive(Deserialize)]
struct ThreadData {
    node: Option<ThreadNode>,
}
#[derive(Deserialize)]
struct CommentsNode {
    comments: Connection<ApiComment>,
}
#[derive(Deserialize)]
struct CommentsData {
    node: Option<CommentsNode>,
}

fn complete_comments(
    github: &impl GitHub,
    workspace: &Path,
    thread: &mut ApiDiscussion,
) -> Result<(), String> {
    let mut cursor = thread
        .comments
        .page_info
        .end_cursor
        .clone()
        .filter(|_| thread.comments.page_info.has_next_page);
    if thread.comments.page_info.has_next_page && cursor.is_none() {
        return Err("GitHub omitted the comment page cursor".into());
    }
    let query = format!(
        "query PullRequestDiscussionComments($id:ID!,$endCursor:String){{node(id:$id){{... on PullRequestReviewThread{{comments(first:100,after:$endCursor){{nodes{{{COMMENT_FIELDS}}} pageInfo{{hasNextPage endCursor}}}}}}}}}}"
    );
    while let Some(after) = cursor {
        let data: CommentsData = graphql(
            github,
            workspace,
            "PullRequestDiscussionComments",
            &query,
            &[("id", thread.id.clone()), ("endCursor", after.clone())],
        )?;
        let comments = data
            .node
            .ok_or("GitHub discussion is unavailable")?
            .comments;
        cursor = comments.page_info.next()?;
        if cursor.as_deref() == Some(&after) {
            return Err("GitHub repeated the comment page cursor".into());
        }
        thread.comments.nodes.extend(comments.nodes);
    }
    Ok(())
}

pub(super) fn read(
    github: &impl GitHub,
    workspace: &Path,
    reference: &PullRequestRef,
) -> Result<Vec<PullRequestDiscussion>, String> {
    let query = format!(
        "query PullRequestDiscussions($owner:String!,$name:String!,$number:Int!,$endCursor:String){{repository(owner:$owner,name:$name){{pullRequest(number:$number){{url reviewThreads(first:25,after:$endCursor){{nodes{{{THREAD_FIELDS} comments(first:100){{nodes{{{COMMENT_FIELDS}}} pageInfo{{hasNextPage endCursor}}}}}} pageInfo{{hasNextPage endCursor}}}}}}}}}}"
    );
    let (owner, name) = reference
        .repository()
        .split_once('/')
        .expect("admitted repository");
    let mut variables = vec![
        ("owner", owner.to_owned()),
        ("name", name.to_owned()),
        ("number", reference.number().to_owned()),
    ];
    let mut found = Vec::new();
    loop {
        let data: ListData = graphql(
            github,
            workspace,
            "PullRequestDiscussions",
            &query,
            &variables,
        )?;
        let pull = data
            .repository
            .and_then(|repository| repository.pull_request)
            .ok_or("GitHub pull request discussions are unavailable")?;
        if &pull.url != reference {
            return Err("GitHub returned discussions from a different pull request".into());
        }
        for mut thread in pull.review_threads.nodes {
            complete_comments(github, workspace, &mut thread)?;
            found.push(thread.into());
        }
        match pull.review_threads.page_info.next()? {
            Some(cursor) => {
                if variables
                    .last()
                    .is_some_and(|(key, value)| *key == "endCursor" && value == &cursor)
                {
                    return Err("GitHub repeated the discussion page cursor".into());
                }
                variables.truncate(3);
                variables.push(("endCursor", cursor));
            }
            None => return Ok(found),
        }
    }
}

fn read_one(
    github: &impl GitHub,
    workspace: &Path,
    reference: &PullRequestRef,
    id: &str,
) -> Result<ApiDiscussion, String> {
    let query = format!(
        "query PullRequestDiscussion($id:ID!){{node(id:$id){{... on PullRequestReviewThread{{{THREAD_FIELDS} pullRequest{{url}} comments(first:100){{nodes{{{COMMENT_FIELDS}}} pageInfo{{hasNextPage endCursor}}}}}}}}}}"
    );
    let data: ThreadData = graphql(
        github,
        workspace,
        "PullRequestDiscussion",
        &query,
        &[("id", id.to_owned())],
    )?;
    let mut node = data.node.ok_or("GitHub discussion is unavailable")?;
    if &node.pull_request.url != reference || node.thread.id != id {
        return Err("This discussion belongs to a different pull request".into());
    }
    complete_comments(github, workspace, &mut node.thread)?;
    Ok(node.thread)
}

#[derive(Deserialize)]
struct RestComment {
    node_id: String,
    user: Option<Author>,
    body: String,
    html_url: String,
    created_at: String,
    updated_at: String,
    diff_hunk: String,
    commit_id: Option<String>,
    original_commit_id: Option<String>,
}
impl From<RestComment> for PullRequestDiscussionComment {
    fn from(comment: RestComment) -> Self {
        Self {
            id: comment.node_id,
            author: comment
                .user
                .map(|user| user.login)
                .unwrap_or_else(|| "unknown".into()),
            body: comment.body,
            url: comment.html_url,
            created_at: comment.created_at,
            updated_at: comment.updated_at,
            diff_hunk: comment.diff_hunk,
            commit_sha: comment.commit_id,
            original_commit_sha: comment.original_commit_id,
        }
    }
}
fn publish(
    github: &impl GitHub,
    workspace: &Path,
    path: &str,
    fields: Vec<(&str, String, bool)>,
) -> Result<Option<RestComment>, String> {
    let mut args = vec![
        "api".to_owned(),
        "--hostname".into(),
        "github.com".into(),
        "--method".into(),
        "POST".into(),
        path.into(),
    ];
    for (key, value, typed) in fields {
        args.push(if typed { "-F" } else { "-f" }.into());
        args.push(format!("{key}={value}"));
    }
    let args: Vec<_> = args.iter().map(String::as_str).collect();
    let receipt = github
        .run(workspace, &args)
        .map_err(|error| error.message)?;
    Ok(serde_json::from_str(&receipt).ok())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Resolution {
    id: String,
    is_resolved: bool,
    viewer_can_reply: bool,
    viewer_can_resolve: bool,
    viewer_can_unresolve: bool,
}
#[derive(Deserialize)]
struct ResolvedThread {
    thread: Resolution,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResolutionData {
    resolve_review_thread: Option<ResolvedThread>,
    unresolve_review_thread: Option<ResolvedThread>,
}

pub(super) enum Mutation {
    Reply(DiscussionBody),
    SetResolved(bool),
}
pub(super) fn update(
    github: &impl GitHub,
    workspace: &Path,
    reference: &PullRequestRef,
    id: &str,
    mutation: Mutation,
) -> Result<Option<PullRequestDiscussion>, String> {
    let raw = read_one(github, workspace, reference, id)?;
    let root_id = raw
        .comments
        .nodes
        .first()
        .and_then(|comment| comment.full_database_id.as_ref())
        .and_then(|id| id.parse::<u64>().ok());
    let mut discussion: PullRequestDiscussion = raw.into();
    let effect = match mutation {
        Mutation::Reply(body) => discussion.reply(body)?,
        Mutation::SetResolved(resolved) => discussion.set_resolved(resolved)?,
    };
    match effect {
        DiscussionEffect::Reply { body, .. } => {
            let root_id = root_id.ok_or("GitHub did not return the root comment identity")?;
            let Some(comment) = publish(
                github,
                workspace,
                &format!("{}/comments/{root_id}/replies", reference.api_path()),
                vec![("body", body.into(), false)],
            )?
            else {
                return Ok(None);
            };
            discussion.comments.push(comment.into());
        }
        DiscussionEffect::SetResolved { resolved, .. } => {
            let (operation, field) = if resolved {
                ("ResolvePullRequestDiscussion", "resolveReviewThread")
            } else {
                ("UnresolvePullRequestDiscussion", "unresolveReviewThread")
            };
            let query = format!(
                "mutation {operation}($id:ID!){{{field}(input:{{threadId:$id}}){{thread{{id isResolved viewerCanReply viewerCanResolve viewerCanUnresolve}}}}}}"
            );
            let data: ResolutionData = graphql(
                github,
                workspace,
                operation,
                &query,
                &[("id", id.to_owned())],
            )?;
            let state = data
                .resolve_review_thread
                .or(data.unresolve_review_thread)
                .ok_or("GitHub did not return the updated discussion")?
                .thread;
            if state.id != discussion.id {
                return Err("GitHub returned a different discussion".into());
            }
            discussion.resolved = state.is_resolved;
            discussion.can_reply = state.viewer_can_reply;
            discussion.can_resolve = state.viewer_can_resolve;
            discussion.can_unresolve = state.viewer_can_unresolve;
        }
        DiscussionEffect::Unchanged => {}
    }
    Ok(Some(discussion))
}

/// None means GitHub accepted the new comment, but its thread needs a refresh.
pub(super) fn add(
    github: &impl GitHub,
    workspace: &Path,
    reference: &PullRequestRef,
    new: NewPullRequestDiscussion,
) -> Result<Option<PullRequestDiscussion>, String> {
    let pull: super::ApiPull =
        serde_json::from_str(&super::api(github, workspace, &reference.api_path(), None)?)
            .map_err(|error| format!("Invalid GitHub pull request: {error}"))?;
    new.admit(&pull.head.sha)?;
    let side = |side| match side {
        DiscussionSide::Left => "LEFT",
        DiscussionSide::Right => "RIGHT",
    };
    let mut fields = vec![
        ("body", new.body.into(), false),
        ("commit_id", new.head_sha, false),
        ("path", new.path, false),
        ("side", side(new.side).into(), false),
        ("line", new.line.to_string(), true),
    ];
    if let Some(start) = new.start_line {
        fields.push(("start_line", start.to_string(), true));
    }
    if let Some(start) = new.start_side {
        fields.push(("start_side", side(start).into(), false));
    }
    let Some(comment) = publish(
        github,
        workspace,
        &format!("{}/comments", reference.api_path()),
        fields,
    )?
    else {
        return Ok(None);
    };
    // A successful POST must never be offered as a retry when only the readback fails.
    Ok(read(github, workspace, reference).ok().and_then(|threads| {
        threads.into_iter().find(|thread| {
            thread
                .comments
                .iter()
                .any(|item| item.id == comment.node_id)
        })
    }))
}
