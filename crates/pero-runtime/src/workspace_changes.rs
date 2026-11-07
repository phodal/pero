//! Private git snapshots around an ACP prompt; no user index, refs or worktree writes.
use pero_contracts::workspace_changes::{ChangeScope, FileComparison, WorkspaceChanges};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, Instant},
};
const OUTPUT_LIMIT: u64 = 8 * 1024 * 1024;
const PATCH_LIMIT: usize = 2 * 1024 * 1024;

#[derive(Clone)]
pub struct ChangesStore {
    directory: PathBuf,
}
#[derive(Deserialize, Serialize)]
struct Record {
    summary: WorkspaceChanges,
    root: PathBuf,
    objects: PathBuf,
    before: String,
    after: String,
}
pub struct TurnCapture {
    directory: PathBuf,
    root: PathBuf,
    objects: PathBuf,
    before: String,
}
impl ChangesStore {
    pub fn new(settings: &Path) -> Self {
        Self {
            directory: settings.with_extension("changes"),
        }
    }
    fn thread(&self, thread: &str) -> PathBuf {
        self.directory
            .join(format!("{:x}", Sha256::digest(thread.as_bytes())))
    }
    pub fn begin(&self, thread: &str, workspace: &Path) -> Result<Option<TurnCapture>, String> {
        let directory = self.thread(thread).join(uuid::Uuid::new_v4().to_string());
        std::fs::create_dir_all(directory.parent().unwrap().join("objects"))
            .map_err(|e| e.to_string())?;
        std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
        let found = match run_git(
            workspace,
            &directory,
            None,
            &[
                "rev-parse",
                "--show-toplevel",
                "--path-format=absolute",
                "--git-path",
                "objects",
            ],
        ) {
            Ok(found) => found,
            Err(error) if error.contains("not a git repository") => {
                let _ = std::fs::remove_dir_all(&directory);
                return Ok(None);
            }
            Err(error) => {
                let _ = std::fs::remove_dir_all(&directory);
                return Err(error);
            }
        };
        let mut lines = found.lines();
        let root = PathBuf::from(lines.next().ok_or("Missing git workspace")?);
        let objects = PathBuf::from(lines.next().ok_or("Missing git object directory")?);
        let mut capture = TurnCapture {
            directory,
            root,
            objects,
            before: String::new(),
        };
        capture.before = capture.snapshot()?;
        Ok(Some(capture))
    }
    pub fn list(&self, thread: &str) -> Result<Vec<WorkspaceChanges>, String> {
        let directory = self.thread(thread);
        if !directory.exists() {
            return Ok(vec![]);
        }
        let mut changes = Vec::new();
        for entry in std::fs::read_dir(directory).map_err(|e| e.to_string())? {
            let path = entry.map_err(|e| e.to_string())?.path().join("record.json");
            if !path.is_file() {
                continue;
            }
            changes.push(read_record(&path)?.summary);
        }
        changes.sort_by(|a, b| (a.created_at, &a.id).cmp(&(b.created_at, &b.id)));
        Ok(changes)
    }
    pub fn current(
        &self,
        thread: &str,
        workspace: &Path,
        now: u64,
    ) -> Result<WorkspaceChanges, String> {
        let _lease = crate::workspace_lease::WorkspaceLease::acquire(workspace)?;
        let mut capture = self
            .begin(thread, workspace)?
            .ok_or("Current workspace review requires a Git repository")?;
        capture.before = capture.git(&["rev-parse", "HEAD^{tree}"])?.trim().into();
        capture.finish(ChangeScope::Worktree, now)
    }
    pub fn read(&self, thread: &str, id: &str, index: usize) -> Result<FileComparison, String> {
        let directory = self.thread(thread).join(id);
        let record = read_record(&directory.join("record.json"))?;
        let file = record
            .summary
            .files
            .get(index)
            .ok_or("Changed file is unavailable")?;
        if file.binary {
            return Ok(FileComparison::Binary);
        }
        let capture = TurnCapture {
            directory,
            root: record.root,
            objects: record.objects,
            before: record.before,
        };
        let mut args = vec![
            "diff-tree",
            "--no-commit-id",
            "-r",
            "-M",
            "--no-ext-diff",
            "--no-textconv",
            "--unified=3",
            "-p",
            &capture.before,
            &record.after,
            "--",
        ];
        let path = format!(":(literal){}", file.path);
        let old_path = file.old_path.as_ref().map(|old| format!(":(literal){old}"));
        args.push(&path);
        if let Some(old) = &old_path {
            args.push(old);
        }
        match capture.git(&args) {
            Ok(patch) if patch.len() <= PATCH_LIMIT => Ok(FileComparison::Text { patch }),
            Ok(_) => Ok(FileComparison::Oversized),
            Err(error) if error == "Git output exceeded the comparison limit" => {
                Ok(FileComparison::Oversized)
            }
            Err(error) => Err(error),
        }
    }
}
fn read_record(path: &Path) -> Result<Record, String> {
    serde_json::from_slice(&std::fs::read(path).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())
}
impl TurnCapture {
    fn git(&self, args: &[&str]) -> Result<String, String> {
        run_git(&self.root, &self.directory, Some(&self.objects), args)
    }
    fn snapshot(&self) -> Result<String, String> {
        let index = self.directory.join("index");
        if index.exists() {
            std::fs::remove_file(&index).map_err(|e| e.to_string())?;
        }
        // Seed tracked paths, including tracked files matching ignore rules, from the real index.
        let source =
            PathBuf::from(self.git(&["rev-parse", "--absolute-git-dir"])?.trim()).join("index");
        if source.is_file() {
            std::fs::copy(&source, &index).map_err(|e| e.to_string())?;
        }
        // A literal exclude of the ignored worker lock makes Git 2.54 reject the
        // snapshot (`addIgnoredFile`). A one-character glob still keeps the lock
        // out of the private index, including when the file is tracked.
        let mut paths = vec!["add", "--all", "--", ".", ":(exclude).pero-worker.loc*"];
        let exclude = self
            .directory
            .parent()
            .and_then(Path::parent)
            .and_then(|path| path.strip_prefix(&self.root).ok())
            .map(|path| format!(":(exclude){}", path.to_string_lossy()));
        if let Some(exclude) = &exclude {
            paths.push(exclude);
        }
        self.git(&paths)?;
        Ok(self.git(&["write-tree"])?.trim().into())
    }
    pub fn finish(self, scope: ChangeScope, now: u64) -> Result<WorkspaceChanges, String> {
        let after = self.snapshot()?;
        let output = self.git(&[
            "diff-tree",
            "--no-commit-id",
            "-r",
            "-M",
            "-z",
            "--numstat",
            &self.before,
            &after,
        ])?;
        let id = self
            .directory
            .file_name()
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let summary = WorkspaceChanges::from_numstat(id, scope, &output, now)?;
        let record = Record {
            summary: summary.clone(),
            root: self.root.clone(),
            objects: self.objects.clone(),
            before: self.before.clone(),
            after,
        };
        std::fs::write(
            self.directory.join("record.json"),
            serde_json::to_vec(&record).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        Ok(summary)
    }
}
fn run_git(
    root: &Path,
    directory: &Path,
    alternate: Option<&Path>,
    args: &[&str],
) -> Result<String, String> {
    let stdout_path = directory.join("stdout");
    let stderr_path = directory.join("stderr");
    let stdout = std::fs::File::create(&stdout_path).map_err(|e| e.to_string())?;
    let stderr = std::fs::File::create(&stderr_path).map_err(|e| e.to_string())?;
    let mut command = Command::new("git");
    command
        .current_dir(root)
        .args(["-c", "core.splitIndex=false", "-c", "core.fsmonitor=false"])
        .args(args)
        .env("GIT_LITERAL_PATHSPECS", "0")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("LC_ALL", "C")
        .stdin(Stdio::null())
        .stdout(stdout)
        .stderr(stderr);
    if let Some(alternate) = alternate {
        command
            .env("GIT_ALTERNATE_OBJECT_DIRECTORIES", alternate)
            .env("GIT_INDEX_FILE", directory.join("index"))
            .env(
                "GIT_OBJECT_DIRECTORY",
                directory.parent().unwrap().join("objects"),
            );
    }
    let mut child = command
        .spawn()
        .map_err(|e| format!("Git could not start: {e}"))?;
    let started = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            break status;
        }
        if started.elapsed() > Duration::from_secs(30) {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Git comparison timed out".into());
        }
        std::thread::sleep(Duration::from_millis(20));
    };
    if !status.success() {
        let error = std::fs::read_to_string(stderr_path).unwrap_or_default();
        return Err(format!(
            "Workspace comparison failed: {}",
            error.chars().take(1000).collect::<String>()
        ));
    }
    let mut bytes = Vec::new();
    std::fs::File::open(stdout_path)
        .map_err(|e| e.to_string())?
        .take(OUTPUT_LIMIT + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > OUTPUT_LIMIT {
        return Err("Git output exceeded the comparison limit".into());
    }
    String::from_utf8(bytes)
        .map_err(|_| "Git comparison contains unsupported non-UTF-8 data".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn git(root: &Path, args: &[&str]) {
        assert!(
            Command::new("git")
                .current_dir(root)
                .args(args)
                .status()
                .unwrap()
                .success()
        );
    }
    #[test]
    fn snapshots_keep_dirty_baseline_and_user_index_while_recording_net_effects() {
        let root = std::env::temp_dir().join(format!("pero-changes-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        git(&root, &["init", "-q"]);
        std::fs::write(root.join("old.txt"), "first\nsecond\n").unwrap();
        std::fs::write(root.join("deleted.txt"), "remove me\n").unwrap();
        std::fs::write(root.join("move.txt"), "rename without editing\n").unwrap();
        git(&root, &["add", "."]);
        git(
            &root,
            &[
                "-c",
                "user.name=Fixture",
                "-c",
                "user.email=fixture@example.test",
                "commit",
                "-qm",
                "base",
            ],
        );
        std::fs::write(root.join("old.txt"), "first\nbaseline dirty\n").unwrap();
        std::fs::write(root.join("already.txt"), "pre-existing untracked\n").unwrap();
        std::fs::write(root.join(".gitignore"), ".pero-worker.lock\n").unwrap();
        std::fs::write(root.join(".pero-worker.lock"), "lease\n").unwrap();
        let index = std::fs::read(root.join(".git/index")).unwrap();
        let profile =
            std::env::temp_dir().join(format!("pero-changes-profile-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&profile).unwrap();
        let store = ChangesStore::new(&profile.join("settings.json"));
        let capture = store.begin("thread", &root).unwrap().unwrap();
        std::fs::write(root.join("old.txt"), "first\nnew line\n").unwrap();
        std::fs::write(root.join("added.txt"), "created\n").unwrap();
        std::fs::write(root.join("temporary.txt"), "gone").unwrap();
        std::fs::remove_file(root.join("temporary.txt")).unwrap();
        std::fs::remove_file(root.join("deleted.txt")).unwrap();
        std::fs::rename(root.join("move.txt"), root.join("renamed.txt")).unwrap();
        std::fs::write(root.join("binary.bin"), [0, 1, 2, 3]).unwrap();
        let summary = capture.finish(ChangeScope::Turn, 42).unwrap();
        assert_eq!((summary.total, summary.added, summary.deleted), (5, 2, 2));
        assert_eq!(std::fs::read(root.join(".git/index")).unwrap(), index);
        let restored = ChangesStore::new(&profile.join("settings.json"));
        assert_eq!(restored.list("thread").unwrap(), vec![summary.clone()]);
        assert!(
            !summary.files.iter().any(|file| {
                file.path == "already.txt"
                    || file.path == "temporary.txt"
                    || file.path == ".pero-worker.lock"
            })
        );
        assert!(
            summary
                .files
                .iter()
                .any(|file| file.path == "renamed.txt"
                    && file.old_path.as_deref() == Some("move.txt"))
        );
        let binary = summary.files.iter().position(|file| file.binary).unwrap();
        assert!(matches!(
            restored.read("thread", &summary.id, binary).unwrap(),
            FileComparison::Binary
        ));
        let index = summary
            .files
            .iter()
            .position(|file| file.path == "old.txt")
            .unwrap();
        let patch = restored.read("thread", &summary.id, index).unwrap();
        let FileComparison::Text { patch } = patch else {
            panic!("text diff expected")
        };
        assert!(patch.contains("-baseline dirty"));
        assert!(!patch.contains("-second"));
        assert!(restored.list("other").unwrap().is_empty());
        let current = restored.current("thread", &root, 43).unwrap();
        assert_eq!(current.scope, ChangeScope::Worktree);
        assert!(current.files.iter().any(|file| file.path == "already.txt"));
        assert!(
            !current
                .files
                .iter()
                .any(|file| file.path == ".pero-worker.lock")
        );
        let unchanged = restored
            .begin("thread", &root)
            .unwrap()
            .unwrap()
            .finish(ChangeScope::Turn, 44)
            .unwrap();
        assert_eq!(unchanged.total, 0);
        std::fs::remove_dir_all(root).unwrap();
        std::fs::remove_dir_all(profile).unwrap();
    }
}
