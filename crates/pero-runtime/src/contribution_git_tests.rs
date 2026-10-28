use super::*;
use std::sync::Mutex;

struct Fixture {
    root: PathBuf,
    contribution: Contribution,
    github: FakeGitHub,
}
struct FakeGitHub {
    remote: PathBuf,
    url: Mutex<String>,
    authenticated: bool,
}
impl GitHub for FakeGitHub {
    fn run(&self, workspace: &Path, args: &[&str]) -> Result<String> {
        match args {
            ["--version"] => Ok("gh fixture".into()),
            ["auth", "status", ..] if self.authenticated => Ok(String::new()),
            ["auth", "status", ..] => Err(ContributionError::new("auth_required", "Sign in")),
            ["api", "user", ..] => Ok("contributor".into()),
            ["pr", "list", ..] => {
                // Match gh's supported branch filter: owner:branch is only accepted by pr create.
                let branch = args.windows(2).find(|pair| pair[0] == "--head").unwrap()[1];
                if branch.contains(':') {
                    return Err(ContributionError::new(
                        "invalid_head",
                        "gh pr list does not support owner:branch",
                    ));
                }
                Ok(self.url.lock().unwrap().clone())
            }
            ["repo", "fork", "--remote", "--remote-name", "origin"] => {
                if git(workspace, &["remote", "get-url", "origin"]).is_err() {
                    git(
                        workspace,
                        &["remote", "add", "origin", self.remote.to_str().unwrap()],
                    )?;
                }
                Ok(String::new())
            }
            ["pr", "create", ..] => {
                let url = "https://github.com/upstream/project/pull/42".to_string();
                *self.url.lock().unwrap() = url.clone();
                Ok(url)
            }
            _ => Err(ContributionError::new(
                "fixture_unknown",
                format!("Unexpected gh arguments: {args:?}"),
            )),
        }
    }
}
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("pero-contribution-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let root = dunce::canonicalize(root).unwrap();
        let workspace = root.join("pero-task_test");
        let remote = root.join("fork.git");
        fs::create_dir(&workspace).unwrap();
        fs::create_dir(&remote).unwrap();
        git(&remote, &["init", "--bare"]).unwrap();
        git(&workspace, &["init", "-b", "main"]).unwrap();
        git(&workspace, &["config", "user.name", "Test Contributor"]).unwrap();
        git(&workspace, &["config", "commit.gpgsign", "false"]).unwrap();
        git(
            &workspace,
            &["config", "user.email", "contributor@example.invalid"],
        )
        .unwrap();
        fs::write(workspace.join("tracked.txt"), "original\n").unwrap();
        git(&workspace, &["add", "."]).unwrap();
        git(&workspace, &["commit", "-m", "Initial"]).unwrap();
        let mut c = Contribution::new(
            TaskId::try_from("task_test".to_string()).unwrap(),
            Repository::try_from("upstream/project".to_string()).unwrap(),
            workspace,
            "Fix contribution".into(),
            "https://github.com/upstream/project/issues/9".into(),
            "revision-1".into(),
        )
        .unwrap();
        c.base = "main".into();
        c.base_head = git(&c.workspace, &["rev-parse", "HEAD"]).unwrap();
        git(&c.workspace, &["checkout", "-b", &c.branch]).unwrap();
        save(&c).unwrap();
        Self {
            root,
            contribution: c,
            github: FakeGitHub {
                remote,
                url: Mutex::new(String::new()),
                authenticated: true,
            },
        }
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

#[test]
fn reviewed_tree_covers_staged_unstaged_and_new_files() {
    for stage in [false, true] {
        let f = Fixture::new();
        fs::write(f.contribution.workspace.join("tracked.txt"), "updated\n").unwrap();
        fs::write(f.contribution.workspace.join("new.txt"), "new content\n").unwrap();
        if stage {
            git(&f.contribution.workspace, &["add", "."]).unwrap();
        }
        let snapshot = review(f.contribution.clone(), &f.github).unwrap();
        assert_eq!(snapshot.changed_files, vec!["new.txt", "tracked.txt"]);
        assert!(snapshot.diff.contains("updated"));
        assert!(snapshot.diff.contains("new content"));
        fs::write(f.contribution.workspace.join("new.txt"), "unreviewed\n").unwrap();
        let error = publish(f.contribution.clone(), &snapshot.review_token, &f.github).unwrap_err();
        assert_eq!(error.code, "review_changed");
        assert_eq!(
            git(&f.contribution.workspace, &["rev-parse", "HEAD"]).unwrap(),
            f.contribution.base_head
        );
    }
}

#[test]
fn publication_preserves_reviewed_tree_and_reconciles_one_pull_request() {
    let f = Fixture::new();
    fs::write(f.contribution.workspace.join("new.txt"), "finished work\n").unwrap();
    let snapshot = review(f.contribution.clone(), &f.github).unwrap();
    let published = publish(f.contribution.clone(), &snapshot.review_token, &f.github).unwrap();
    assert_eq!(
        published.contribution.pr_url.as_deref(),
        Some("https://github.com/upstream/project/pull/42")
    );
    assert_eq!(published.status, "published");
    assert_ne!(published.head, f.contribution.base_head);
    assert_eq!(
        git(
            &f.github.remote,
            &["show", &format!("{}:new.txt", f.contribution.branch)]
        )
        .unwrap(),
        "finished work"
    );
    assert!(
        git(&f.contribution.workspace, &["status", "--porcelain"])
            .unwrap()
            .is_empty()
    );
    let loaded = load(&f.contribution.workspace, &f.contribution.task_id).unwrap();
    let again = publish(loaded, &published.review_token, &f.github).unwrap();
    assert_eq!(again.contribution.pr_url, published.contribution.pr_url);
    assert_eq!(again.head, published.head);
    fs::write(f.contribution.workspace.join("new.txt"), "follow-up\n").unwrap();
    let followup = review(again.contribution, &f.github).unwrap();
    let updated = publish(followup.contribution, &followup.review_token, &f.github).unwrap();
    assert_eq!(updated.contribution.pr_url, published.contribution.pr_url);
    assert_eq!(
        git(
            &f.github.remote,
            &["show", &format!("{}:new.txt", f.contribution.branch)]
        )
        .unwrap(),
        "follow-up"
    );
}

#[test]
fn setup_and_review_failures_keep_local_work() {
    for scenario in ["no_changes", "github_auth_required", "manual_review"] {
        let mut f = Fixture::new();
        if scenario != "no_changes" {
            fs::write(f.contribution.workspace.join("new.txt"), "keep this work").unwrap();
        }
        if scenario == "github_auth_required" {
            f.github.authenticated = false;
        }
        if scenario == "manual_review" {
            fs::write(f.contribution.workspace.join("binary.bin"), [0, 1, 2]).unwrap();
            assert_eq!(
                review(f.contribution.clone(), &f.github).unwrap_err().code,
                scenario
            );
        } else {
            let snapshot = review(f.contribution.clone(), &f.github).unwrap();
            assert_eq!(
                publish(f.contribution.clone(), &snapshot.review_token, &f.github)
                    .unwrap_err()
                    .code,
                scenario
            );
        }
        assert_eq!(
            git(&f.contribution.workspace, &["rev-parse", "HEAD"]).unwrap(),
            f.contribution.base_head
        );
        if scenario != "no_changes" {
            assert_eq!(
                fs::read_to_string(f.contribution.workspace.join("new.txt")).unwrap(),
                "keep this work"
            );
        }
    }
}

#[test]
fn prepared_workspace_resumes_without_overwriting_changes() {
    let f = Fixture::new();
    fs::write(f.contribution.workspace.join("new.txt"), "unfinished work").unwrap();
    let resumed = prepare(
        f.contribution.task_id.clone(),
        f.contribution.repository.clone(),
        &f.root,
        f.contribution.title.clone(),
        f.contribution.source_url.clone(),
        f.contribution.source_revision.clone(),
    )
    .unwrap();
    assert_eq!(resumed.workspace, f.contribution.workspace);
    assert_eq!(
        prepare(
            f.contribution.task_id.clone(),
            f.contribution.repository.clone(),
            &f.root,
            f.contribution.title.clone(),
            f.contribution.source_url.clone(),
            "new-revision".into()
        )
        .unwrap_err()
        .code,
        "workspace_mismatch"
    );
    assert_eq!(
        fs::read_to_string(resumed.workspace.join("new.txt")).unwrap(),
        "unfinished work"
    );
    git(&f.contribution.workspace, &["checkout", "main"]).unwrap();
    assert_eq!(
        load(&f.contribution.workspace, &f.contribution.task_id)
            .unwrap_err()
            .code,
        "branch_changed"
    );
}
