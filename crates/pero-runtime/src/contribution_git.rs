//! Process/filesystem shell for local contributions. No Agent or cloud state lives here.
use crate::contribution::{
    Contribution, ContributionError, ContributionSnapshot, Repository, TaskId,
};
use std::{
    collections::hash_map::DefaultHasher,
    fs,
    hash::{Hash, Hasher},
    path::{Path, PathBuf},
    process::{Command, Output},
};

type Result<T> = std::result::Result<T, ContributionError>;
const REVIEW_LIMIT: usize = 512 * 1024;

// This real seam also permits local Git tests without a GitHub account or writes.
pub trait GitHub {
    fn run(&self, workspace: &Path, args: &[&str]) -> Result<String>;
}
pub struct GitHubCli;
impl GitHub for GitHubCli {
    fn run(&self, workspace: &Path, args: &[&str]) -> Result<String> {
        command("gh", workspace, args)
    }
}
fn output(program: &str, workspace: &Path, args: &[&str]) -> Result<Output> {
    Command::new(program)
        .current_dir(workspace)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GH_PROMPT_DISABLED", "1")
        .output()
        .map_err(|error| {
            ContributionError::new(
                "tool_unavailable",
                format!("Could not start {program}: {error}. Install it and reopen Pero."),
            )
        })
}
fn command(program: &str, workspace: &Path, args: &[&str]) -> Result<String> {
    let result = output(program, workspace, args)?;
    if !result.status.success() {
        let detail = String::from_utf8_lossy(&result.stderr);
        return Err(ContributionError::new(
            "command_failed",
            format!(
                "{program} {} failed: {}",
                args.first().unwrap_or(&""),
                detail.trim().chars().take(1500).collect::<String>()
            ),
        ));
    }
    Ok(String::from_utf8_lossy(&result.stdout)
        .trim_end()
        .to_string())
}
fn git(workspace: &Path, args: &[&str]) -> Result<String> {
    command("git", workspace, args)
}
fn binding_path(workspace: &Path) -> PathBuf {
    workspace.join(".git/pero-contribution.json")
}
fn save(c: &Contribution) -> Result<()> {
    let bytes = serde_json::to_vec_pretty(c)
        .map_err(|error| ContributionError::new("save_failed", error.to_string()))?;
    fs::write(binding_path(&c.workspace), bytes).map_err(|error| {
        ContributionError::new(
            "save_failed",
            format!("Could not save contribution: {error}"),
        )
    })
}
pub fn load(workspace: &Path, task_id: &TaskId) -> Result<Contribution> {
    let workspace = dunce::canonicalize(workspace)
        .map_err(|error| ContributionError::new("workspace_missing", error.to_string()))?;
    let c: Contribution =
        serde_json::from_slice(&fs::read(binding_path(&workspace)).map_err(|_| {
            ContributionError::new(
                "workspace_unknown",
                "Select a workspace prepared by Pero for this task",
            )
        })?)
        .map_err(|_| {
            ContributionError::new(
                "workspace_unknown",
                "The contribution record cannot be read",
            )
        })?;
    if c.workspace != workspace || &c.task_id != task_id || c.branch != c.task_id.branch() {
        return Err(ContributionError::new(
            "workspace_mismatch",
            "This workspace belongs to another contribution",
        ));
    }
    let branch = git(&workspace, &["branch", "--show-current"])?;
    if branch != c.branch {
        return Err(ContributionError::new(
            "branch_changed",
            "Return to the contribution branch before continuing",
        ));
    }
    Ok(c)
}

pub fn prepare(
    task_id: TaskId,
    repository: Repository,
    parent: &Path,
    title: String,
    source_url: String,
    source_revision: String,
) -> Result<Contribution> {
    let parent = dunce::canonicalize(parent).map_err(|_| {
        ContributionError::new(
            "parent_missing",
            "Choose an existing folder for contribution workspaces",
        )
    })?;
    if !parent.is_dir() {
        return Err(ContributionError::new(
            "parent_missing",
            "Choose a folder for contribution workspaces",
        ));
    }
    let workspace = parent.join(format!("pero-{}", task_id.as_str()));
    let mut c = Contribution::new(
        task_id,
        repository,
        workspace.clone(),
        title,
        source_url,
        source_revision,
    )?;
    if workspace.exists() {
        let existing = load(&workspace, &c.task_id)?;
        if existing.repository != c.repository
            || existing.source_url != c.source_url
            || existing.source_revision != c.source_revision
        {
            return Err(ContributionError::new(
                "workspace_mismatch",
                "This folder already belongs to another source. Choose another parent folder.",
            ));
        }
        return Ok(existing);
    }
    git(
        &parent,
        &[
            "clone",
            "--origin",
            "upstream",
            "--single-branch",
            &c.repository.clone_url(),
            &workspace.to_string_lossy(),
        ],
    )?;
    c.base = git(
        &workspace,
        &["symbolic-ref", "--short", "refs/remotes/upstream/HEAD"],
    )?
    .strip_prefix("upstream/")
    .ok_or_else(|| ContributionError::new("base_missing", "The repository has no default branch"))?
    .to_string();
    c.base_head = git(&workspace, &["rev-parse", "HEAD"])?;
    git(&workspace, &["checkout", "-b", &c.branch])?;
    save(&c)?;
    Ok(c)
}

pub fn review(c: Contribution, github: &dyn GitHub) -> Result<ContributionSnapshot> {
    let head = git(&c.workspace, &["rev-parse", "HEAD"])?;
    let raw = output(
        "git",
        &c.workspace,
        &["diff", "--no-ext-diff", "--binary", &c.base_head, "--"],
    )?;
    if !raw.status.success() {
        return Err(ContributionError::new(
            "diff_failed",
            "Could not read the contribution diff",
        ));
    }
    let mut bytes = raw.stdout;
    let status = git(&c.workspace, &["status", "--porcelain=v1", "-uall"])?;
    let mut hasher = DefaultHasher::new();
    head.hash(&mut hasher);
    status.hash(&mut hasher);
    bytes.hash(&mut hasher);
    let names = output(
        "git",
        &c.workspace,
        &["ls-files", "--others", "--exclude-standard", "-z"],
    )?;
    for name in names.stdout.split(|b| *b == 0).filter(|b| !b.is_empty()) {
        let name = std::str::from_utf8(name).map_err(|_| {
            ContributionError::new(
                "invalid_filename",
                "A filename is not UTF-8; review it with Git before continuing",
            )
        })?;
        let file = c.workspace.join(name);
        let metadata = fs::symlink_metadata(&file)
            .map_err(|e| ContributionError::new("diff_failed", e.to_string()))?;
        if !metadata.file_type().is_file() || metadata.len() > REVIEW_LIMIT as u64 {
            return Err(ContributionError::new(
                "manual_review",
                "An untracked file is a symlink or exceeds 512 KiB. Review it in Git before creating a PR.",
            ));
        }
        let content =
            fs::read(&file).map_err(|e| ContributionError::new("diff_failed", e.to_string()))?;
        name.hash(&mut hasher);
        content.hash(&mut hasher);
        bytes.extend_from_slice(format!("\ndiff --git a/{name} b/{name}\nnew file\n").as_bytes());
        if content.contains(&0) {
            return Err(ContributionError::new(
                "manual_review",
                "An untracked binary file needs manual Git review before creating a PR.",
            ));
        }
        bytes.extend_from_slice(&content);
    }
    if bytes.len() > REVIEW_LIMIT {
        return Err(ContributionError::new(
            "manual_review",
            "The diff exceeds 512 KiB. Review and commit it with Git before continuing.",
        ));
    }
    let mut changed_files = git(&c.workspace, &["diff", "--name-only", &c.base_head, "--"])?
        .lines()
        .map(str::to_string)
        .collect::<Vec<_>>();
    changed_files.extend(
        names
            .stdout
            .split(|b| *b == 0)
            .filter(|b| !b.is_empty())
            .map(|b| String::from_utf8_lossy(b).to_string()),
    );
    changed_files.sort();
    changed_files.dedup();
    let gh_available = github.run(&c.workspace, &["--version"]).is_ok();
    let gh_authenticated = gh_available
        && github
            .run(
                &c.workspace,
                &["auth", "status", "--hostname", "github.com"],
            )
            .is_ok();
    let status = if c.pr_url.is_some() {
        "published"
    } else {
        "review"
    }
    .into();
    Ok(ContributionSnapshot {
        contribution: c,
        head,
        review_token: format!("{:016x}", hasher.finish()),
        diff: String::from_utf8_lossy(&bytes).into(),
        changed_files,
        status,
        gh_available,
        gh_authenticated,
    })
}

pub fn publish(
    mut c: Contribution,
    review_token: &str,
    github: &dyn GitHub,
) -> Result<ContributionSnapshot> {
    let current = review(c.clone(), github)?;
    c.review_matches(review_token, &current.review_token)?;
    if !current.gh_available {
        return Err(ContributionError::new(
            "github_cli_missing",
            "Install GitHub CLI (gh), run gh auth login, then retry creating the PR.",
        ));
    }
    if !current.gh_authenticated {
        return Err(ContributionError::new(
            "github_auth_required",
            "Run gh auth login --hostname github.com in a terminal, then retry creating the PR.",
        ));
    }
    // Query first, including on retry after an unknown create response. A failed read is never treated as absence.
    let login = github.run(&c.workspace, &["api", "user", "--jq", ".login"])?;
    if login.is_empty()
        || !login
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
    {
        return Err(ContributionError::new(
            "github_identity",
            "Could not confirm the GitHub CLI account",
        ));
    }
    let head_ref = format!("{login}:{}", c.branch);
    let existing = github.run(
        &c.workspace,
        &[
            "pr",
            "list",
            "--repo",
            c.repository.as_str(),
            "--head",
            &c.branch,
            "--author",
            &login,
            "--state",
            "open",
            "--json",
            "url",
            "--jq",
            ".[0].url // empty",
        ],
    )?;
    if !existing.is_empty() && !c.repository.pull_request_url(&existing) {
        return Err(ContributionError::new(
            "invalid_pr",
            "GitHub returned an unexpected pull request URL",
        ));
    }
    if existing.is_empty() && c.pr_url.is_some() {
        return Err(ContributionError::new(
            "pr_unavailable",
            "The saved PR is no longer visible. Check it on GitHub before retrying.",
        ));
    }
    if current.changed_files.is_empty() {
        return Err(ContributionError::new(
            "no_changes",
            "There are no changes to submit. Ask the Agent to finish the task first.",
        ));
    }
    for key in ["user.name", "user.email"] {
        if git(&c.workspace, &["config", "--get", key])
            .unwrap_or_default()
            .is_empty()
        {
            return Err(ContributionError::new(
                "git_identity_required",
                "Set git config --global user.name and user.email, then retry creating the PR.",
            ));
        }
    }
    git(&c.workspace, &["add", "--all", "--", "."])?;
    if !git(&c.workspace, &["diff", "--cached", "--name-only"])?.is_empty() {
        let message = format!(
            "feat: {}\n\nSource: {}\n\nCo-authored-by: Pero Agent <agent@openpero.com>",
            c.title, c.source_url
        );
        git(&c.workspace, &["commit", "-m", &message])?;
    }
    if login.eq_ignore_ascii_case(c.repository.owner()) {
        // The upstream owner's own repository already is the publication target.
        if git(&c.workspace, &["remote", "get-url", "origin"]).is_err() {
            git(
                &c.workspace,
                &["remote", "add", "origin", &c.repository.clone_url()],
            )?;
        }
    } else {
        // gh only adds a remote when forking its current repository, without a repository argument.
        // Pin that current repository locally so an existing origin cannot change the fork target on retry.
        git(
            &c.workspace,
            &["config", "remote.upstream.gh-resolved", "base"],
        )?;
        github.run(
            &c.workspace,
            &["repo", "fork", "--remote", "--remote-name", "origin"],
        )?;
    }
    // Scope the existing gh credential helper to this push; do not change global Git settings.
    git(
        &c.workspace,
        &[
            "-c",
            "credential.helper=",
            "-c",
            "credential.https://github.com.helper=!gh auth git-credential",
            "push",
            "--set-upstream",
            "origin",
            &c.branch,
        ],
    )?;
    if !existing.is_empty() {
        c.pr_url = Some(existing);
        save(&c)?;
        return review(c, github);
    }
    let body = format!(
        "{}\n\nSource: {}\n\nPrepared with Pero for task `{}`.\n\nPlease review the changes and test results before merging.",
        c.title,
        c.source_url,
        c.task_id.as_str()
    );
    let body_path = c.workspace.join(".git/pero-pr-body.md");
    fs::write(&body_path, body)
        .map_err(|e| ContributionError::new("save_failed", e.to_string()))?;
    let url = github.run(
        &c.workspace,
        &[
            "pr",
            "create",
            "--repo",
            c.repository.as_str(),
            "--base",
            &c.base,
            "--head",
            &head_ref,
            "--draft",
            "--title",
            &c.title,
            "--body-file",
            &body_path.to_string_lossy(),
        ],
    )?;
    if !c.repository.pull_request_url(&url) {
        return Err(ContributionError::new(
            "publication_unknown",
            "PR creation may have completed. Retry to reconcile the existing PR before creating another.",
        ));
    }
    c.pr_url = Some(url);
    save(&c)?;
    review(c, github)
}

#[cfg(test)]
#[path = "contribution_git_tests.rs"]
mod tests;
