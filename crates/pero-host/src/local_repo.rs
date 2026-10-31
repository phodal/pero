//! Read-only local Git for the Insights brief, copied from Point's
//! `readLocalRepo` and `ResolveDirectory`. This module runs git. The session
//! fold does not.

use std::{
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

use pero_contracts::{HostEvent, workbench::RepositoryIdentity};
use serde::Serialize;

const READ_BUDGET: Duration = Duration::from_secs(5);
const MAX_DIRTY: usize = 50;
const MAX_COMMITS: usize = 10;
const MAX_RECENT: usize = 5;
const MAX_UPSTREAM_PATHS: usize = 200;

#[derive(Clone, Debug, Serialize)]
struct CommitView {
    hash: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    author: String,
    subject: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    at: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RepoView {
    repository: String,
    root: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    branch: String,
    #[serde(rename = "unpushedCommits")]
    unpushed_commits: i64,
    #[serde(rename = "behindUpstream")]
    behind_upstream: i64,
    #[serde(rename = "uncommittedFiles", skip_serializing_if = "Vec::is_empty")]
    uncommitted_files: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    unpushed: Vec<CommitView>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    incoming: Vec<CommitView>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    recent: Vec<CommitView>,
    #[serde(skip_serializing_if = "String::is_empty")]
    error: String,
}

#[derive(Clone, Debug, Serialize)]
struct SessionRef {
    id: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    title: String,
}

#[derive(Clone, Debug, Serialize)]
struct ConflictView {
    path: String,
    repository: String,
    sessions: Vec<SessionRef>,
}

enum GitError {
    Failed,
    Timeout,
}

/// Repositories for the current workspace. A directory that is not a checkout
/// is omitted; an unread repository is not reported as clean.
pub fn read_directories(dirs: &[PathBuf]) -> Vec<serde_json::Value> {
    let mut seen = Vec::new();
    let mut repos = Vec::new();
    for dir in dirs {
        let Some(repo) = read_directory(dir) else {
            continue;
        };
        if seen.iter().any(|root: &String| root == &repo.root) {
            continue;
        }
        seen.push(repo.root.clone());
        repos.push(repo);
    }
    repos
        .into_iter()
        .filter_map(|repo| serde_json::to_value(repo).ok())
        .collect()
}

/// Uncommitted files named by two sessions. Point limits this to the last six
/// hours; these events have no timestamp, so the whole journal is the window.
pub fn conflicts(repositories: &[serde_json::Value], events: &[HostEvent]) -> Vec<serde_json::Value> {
    let dirty = dirty_paths(repositories);
    if dirty.is_empty() {
        return Vec::new();
    }
    let mut cwd = std::collections::HashMap::<String, String>::new();
    for event in events {
        if event.kind != "session_created" {
            continue;
        }
        let Some(thread) = event.thread_id.clone() else { continue };
        if let Some(workspace) = event.data.get("workspace").and_then(|value| value.as_str()) {
            cwd.insert(thread, workspace.to_string());
        }
    }
    let mut touched = std::collections::BTreeMap::<String, Vec<String>>::new();
    for event in events {
        if event.kind != "session_update" || event.data.get("sessionUpdate").and_then(|value| value.as_str()) != Some("tool_call") {
            continue;
        }
        let Some(thread) = event.thread_id.clone() else { continue };
        let text = event.data.get("rawInput").map(|value| value.to_string()).unwrap_or_default();
        let workspace = cwd.get(&thread).map(String::as_str).unwrap_or("");
        for path in path_tokens(&text) {
            let candidate = if Path::new(&path).is_absolute() {
                PathBuf::from(&path)
            } else if workspace.is_empty() {
                continue;
            } else {
                Path::new(workspace).join(&path)
            };
            let Some((_, _)) = dirty.iter().find(|(absolute, _)| absolute == &candidate) else { continue };
            let sessions = touched.entry(candidate.display().to_string()).or_default();
            if !sessions.contains(&thread) {
                sessions.push(thread.clone());
            }
        }
    }
    let mut out = Vec::new();
    for (path, sessions) in touched {
        if sessions.len() < 2 {
            continue;
        }
        let repository = dirty
            .iter()
            .find(|(absolute, _)| absolute.display().to_string() == path)
            .map(|(_, repository)| repository.clone())
            .unwrap_or_default();
        let view = ConflictView {
            path,
            repository,
            sessions: sessions.into_iter().map(|id| SessionRef { id, title: String::new() }).collect(),
        };
        if let Ok(value) = serde_json::to_value(view) {
            out.push(value);
        }
    }
    out
}

fn dirty_paths(repositories: &[serde_json::Value]) -> Vec<(PathBuf, String)> {
    let mut dirty = Vec::new();
    for repo in repositories {
        let root = repo.get("root").and_then(|value| value.as_str()).unwrap_or("");
        let repository = repo.get("repository").and_then(|value| value.as_str()).unwrap_or("").to_string();
        let Some(files) = repo.get("uncommittedFiles").and_then(|value| value.as_array()) else { continue };
        for file in files {
            let Some(relative) = file.as_str() else { continue };
            dirty.push((Path::new(root).join(relative), repository.clone()));
        }
    }
    dirty
}

fn path_tokens(text: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let take = |token: &str, tokens: &mut Vec<String>| {
        let token = token.replace("\\/", "/");
        if token.contains('.') && token.split('.').next_back().is_some_and(|suffix| (1..=8).contains(&suffix.len()) && suffix.chars().all(|c| c.is_ascii_alphanumeric())) {
            tokens.push(token);
        }
    };
    for ch in text.chars() {
        if ch.is_ascii_alphanumeric() || matches!(ch, '_' | '.' | '/' | '@' | '-') {
            current.push(ch);
        } else {
            if !current.is_empty() {
                take(&current, &mut tokens);
                current.clear();
            }
        }
    }
    if !current.is_empty() {
        take(&current, &mut tokens);
    }
    tokens
}

fn read_directory(dir: &Path) -> Option<RepoView> {
    let deadline = Instant::now() + READ_BUDGET;
    let root = git(dir, &["rev-parse", "--show-toplevel"], deadline).ok()?;
    let root = root.trim().to_string();
    if root.is_empty() {
        return None;
    }
    let root_path = PathBuf::from(&root);
    let mut repo = RepoView {
        repository: String::new(),
        root: root.clone(),
        branch: git(&root_path, &["symbolic-ref", "--quiet", "--short", "HEAD"], deadline).unwrap_or_default().trim().to_string(),
        unpushed_commits: 0,
        behind_upstream: 0,
        uncommitted_files: Vec::new(),
        unpushed: Vec::new(),
        incoming: Vec::new(),
        recent: Vec::new(),
        error: String::new(),
    };
    if let Ok(head) = git(&root_path, &["rev-parse", "--verify", "--quiet", "HEAD"], deadline) {
        let _ = head;
    }
    if let Ok(remote) = git(&root_path, &["remote", "get-url", "origin"], deadline) {
        if let Some(identity) = RepositoryIdentity::from_git_remote(remote.trim()) {
            repo.repository = format!("{}/{}/{}", identity.host, identity.owner, identity.name);
        }
    }
    if repo.repository.is_empty() {
        if let Ok(roots) = git(&root_path, &["rev-list", "--max-parents=0", "HEAD"], deadline) {
            if let Some(commit) = roots.lines().next_back().and_then(|line| line.split_whitespace().next_back()) {
                repo.repository = format!("local:{commit}");
            }
        }
    }
    if repo.repository.is_empty() {
        return None;
    }
    match git(&root_path, &["status", "--porcelain=v1", "-z", "--untracked-files=normal"], deadline) {
        Ok(status) => parse_status(&status, &mut repo),
        Err(GitError::Timeout) => repo.error = "读取超时".into(),
        Err(GitError::Failed) => repo.error = "git status 失败".into(),
    }
    repo.recent = commits(&root_path, &["-n", "5", "HEAD"], deadline, MAX_RECENT);
    let upstream = git(&root_path, &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], deadline);
    if upstream.is_err() {
        if matches!(upstream, Err(GitError::Timeout)) && repo.error.is_empty() {
            repo.error = "读取超时".into();
        }
        return Some(repo);
    }
    if let Ok(counts) = git(&root_path, &["rev-list", "--left-right", "--count", "HEAD...@{u}"], deadline) {
        let mut fields = counts.split_whitespace();
        repo.unpushed_commits = fields.next().and_then(|value| value.parse().ok()).unwrap_or(0);
        repo.behind_upstream = fields.next().and_then(|value| value.parse().ok()).unwrap_or(0);
    }
    if repo.unpushed_commits > 0 {
        repo.unpushed = commits(&root_path, &["@{u}..HEAD"], deadline, MAX_COMMITS);
    }
    if repo.behind_upstream > 0 {
        repo.incoming = commits(&root_path, &["HEAD..@{u}"], deadline, MAX_COMMITS);
        if let Ok(changed) = git(&root_path, &["diff", "--name-only", "-z", "HEAD...@{u}"], deadline) {
            let _ = changed.split('\0').filter(|path| !path.is_empty()).take(MAX_UPSTREAM_PATHS).count();
        }
    }
    if deadline.saturating_duration_since(Instant::now()).is_zero() && repo.error.is_empty() {
        repo.error = "读取超时".into();
    }
    Some(repo)
}

fn parse_status(status: &str, repo: &mut RepoView) {
    let entries: Vec<&str> = status.split('\0').collect();
    let mut index = 0;
    while index < entries.len() {
        let entry = entries[index];
        index += 1;
        if entry.len() < 4 {
            continue;
        }
        if repo.uncommitted_files.len() < MAX_DIRTY {
            repo.uncommitted_files.push(entry[3..].to_string());
        }
        if entry.as_bytes()[0] == b'R' || entry.as_bytes()[0] == b'C' {
            index += 1;
        }
    }
}

fn commits(root: &Path, range: &[&str], deadline: Instant, limit: usize) -> Vec<CommitView> {
    let mut args = vec!["log", "--no-merges", "-n", "10", "--format=%H%x1f%an%x1f%aI%x1f%s"];
    args.extend_from_slice(range);
    let Ok(output) = git(root, &args, deadline) else { return Vec::new() };
    output
        .lines()
        .filter_map(|line| {
            let mut fields = line.splitn(4, '\u{1f}');
            Some(CommitView {
                hash: fields.next()?.to_string(),
                author: fields.next().unwrap_or("").to_string(),
                at: fields.next().unwrap_or("").to_string(),
                subject: fields.next().unwrap_or("").to_string(),
            })
        })
        .take(limit)
        .collect()
}

fn git(root: &Path, args: &[&str], deadline: Instant) -> Result<String, GitError> {
    let remaining = deadline.saturating_duration_since(Instant::now());
    if remaining.is_zero() {
        return Err(GitError::Timeout);
    }
    let mut child = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| GitError::Failed)?;
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => {
                let output = child.wait_with_output().map_err(|_| GitError::Failed)?;
                if output.status.success() {
                    return Ok(String::from_utf8_lossy(&output.stdout).into_owned());
                }
                return Err(GitError::Failed);
            }
            Ok(None) if started.elapsed() >= remaining => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(GitError::Timeout);
            }
            Ok(None) => thread::sleep(Duration::from_millis(20)),
            Err(_) => return Err(GitError::Failed),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn git_ok(dir: &Path, args: &[&str]) {
        let status = Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(args)
            .env("GIT_AUTHOR_NAME", "Pero")
            .env("GIT_AUTHOR_EMAIL", "pero@example.com")
            .env("GIT_COMMITTER_NAME", "Pero")
            .env("GIT_COMMITTER_EMAIL", "pero@example.com")
            .env("GIT_TERMINAL_PROMPT", "0")
            .status()
            .unwrap();
        assert!(status.success(), "{args:?}");
    }

    #[test]
    fn a_checkout_reports_uncommitted_files_and_unpushed_commits() {
        let nonce = std::process::id();
        let root = std::env::temp_dir().join(format!("pero-local-repo-{nonce}"));
        let origin = root.join("origin");
        let work = root.join("work");
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&origin).unwrap();
        git_ok(&origin, &["init", "--bare", "--quiet"]);
        git_ok(&root, &["clone", "--quiet", origin.to_str().unwrap(), "work"]);
        std::fs::write(work.join("kept.rs"), "fn kept() {}\n").unwrap();
        git_ok(&work, &["add", "kept.rs"]);
        git_ok(&work, &["commit", "-m", "keep the file"]);
        git_ok(&work, &["push", "--quiet", "origin", "HEAD"]);
        std::fs::write(work.join("next.rs"), "fn next() {}\n").unwrap();
        git_ok(&work, &["add", "next.rs"]);
        git_ok(&work, &["commit", "-m", "leave this unpushed"]);
        std::fs::write(work.join("dirty.rs"), "fn dirty() {}\n").unwrap();

        let repos = read_directories(&[work.clone()]);
        assert_eq!(repos.len(), 1);
        let repo = &repos[0];
        assert!(repo["uncommittedFiles"].as_array().unwrap().iter().any(|path| path == "dirty.rs"));
        assert_eq!(repo["unpushedCommits"], 1);
        assert_eq!(repo["unpushed"][0]["subject"], "leave this unpushed");
        assert!(repo["recent"].as_array().unwrap().len() >= 1);
        assert!(read_directories(&[root.join("missing")]).is_empty());
        let _ = std::fs::remove_dir_all(&root);
    }
}
