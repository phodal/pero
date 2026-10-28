//! Spawn one allowlisted interpreter and record what actually ran.
//!
//! Credentials and `PYTHON*` settings stay in this process. The child receives
//! a short environment allowlist and Python's `-I` isolated mode.

use crate::process::{self, Tree};
use crate::run::{self, Book, Effect, Input, OUTPUT_LIMIT, Receipt, Reject, Submit, valid_ident};
use std::{
    collections::HashMap,
    fs,
    io::{self, Read, Write},
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Sender},
    },
    thread,
    time::{Duration, Instant},
};

const MAX_ENV_ID: usize = 64;
/// How long the receipt waits for the output pipes after the leader is gone.
/// A descendant that left the process group can hold a pipe open; its output
/// is then cut and the receipt says so.
const DRAIN_GRACE: Duration = Duration::from_secs(2);

pub struct Paths {
    pub settings: Option<PathBuf>,
    pub store: PathBuf,
    pub runs_root: PathBuf,
    pub limit: Duration,
}

#[derive(Debug, PartialEq, Eq)]
pub enum CodeNotice {
    Receipt {
        id: String,
        receipt: Receipt,
    },
    Rejected {
        id: Option<String>,
        reason: &'static str,
    },
}

pub struct CodeMode {
    paths: Paths,
    book: Mutex<Book>,
    trees: Mutex<HashMap<String, Arc<Tree>>>,
    tx: Sender<CodeNotice>,
    durable: bool,
    closing: AtomicBool,
}

pub fn paths_from_env(settings: Option<PathBuf>) -> Paths {
    let store = std::env::var_os("PERO_CODE_RUNS_PATH").map_or_else(
        || match settings.as_deref().and_then(Path::parent) {
            // Beside the settings file, so a packaged app keeps runs in its profile.
            Some(profile) if !profile.as_os_str().is_empty() => profile.join("code-runs.json"),
            _ => std::env::current_dir()
                .unwrap_or_else(|_| PathBuf::from("."))
                .join("target/code-runs.json"),
        },
        PathBuf::from,
    );
    let runs_root = std::env::var_os("PERO_CODE_RUNS_DIR").map_or_else(
        || {
            store
                .parent()
                .unwrap_or_else(|| Path::new("."))
                .join("code-programs")
        },
        PathBuf::from,
    );
    Paths {
        settings,
        store,
        runs_root,
        limit: Duration::from_secs(30),
    }
}

impl CodeMode {
    pub fn open(paths: Paths, tx: Sender<CodeNotice>) -> Arc<Self> {
        let parents = paths
            .store
            .parent()
            .is_none_or(|parent| fs::create_dir_all(parent).is_ok());
        let created = parents && fs::create_dir_all(&paths.runs_root).is_ok();
        let (book, durable) = if created {
            match load(&paths.store) {
                Some(book) => {
                    let book = run::settle(book);
                    if save(&paths.store, &book).is_ok() {
                        (book, true)
                    } else {
                        (Book::default(), false)
                    }
                }
                None => (Book::default(), false),
            }
        } else {
            (Book::default(), false)
        };
        Arc::new(Self {
            paths,
            book: Mutex::new(book),
            trees: Mutex::new(HashMap::new()),
            tx,
            durable,
            closing: AtomicBool::new(false),
        })
    }

    pub fn run(self: &Arc<Self>, id: String, env_id: String, program: String, workspace: PathBuf) {
        let known = {
            let book = self.book.lock().expect("code runs");
            book.contains(&id)
                .then(|| run::replay(&book, &id, &program))
        };
        if let Some(result) = known {
            match result {
                Ok(Effect::Receipt(receipt)) => self.publish_receipt(&id, &receipt),
                Err(reject) => self.reject(Some(id), reject.text()),
                Ok(_) => {}
            }
            return;
        }
        // Probing the interpreter can take seconds. The Host loop must keep
        // reading, including a `cancel_code` for another run.
        let mode = Arc::clone(self);
        thread::spawn(move || mode.launch(id, env_id, program, workspace));
    }

    /// Stop every active run before the Host exits.
    ///
    /// The runs are recorded as unknown first, so a restart does not read a
    /// killed process as a normal exit. A run that starts later is refused.
    pub fn shutdown(&self) {
        self.closing.store(true, Ordering::SeqCst);
        {
            let mut book = self.book.lock().expect("code runs");
            let next = run::settle(book.clone());
            if self.durable && save(&self.paths.store, &next).is_ok() {
                *book = next;
            }
        }
        let live: Vec<Arc<Tree>> = self
            .trees
            .lock()
            .expect("trees")
            .values()
            .cloned()
            .collect();
        for tree in live {
            tree.kill();
        }
    }

    pub fn cancel(&self, id: String) {
        match self.transition(Input::Cancel {
            request_id: id.clone(),
        }) {
            Ok(Effect::Kill { request_id }) => self.kill(&request_id),
            Ok(Effect::Receipt(receipt)) => self.publish_receipt(&id, &receipt),
            Ok(_) => {}
            Err(reason) => self.reject(Some(id), reason),
        }
    }

    pub fn reject(&self, id: Option<String>, reason: &'static str) {
        let _ = self.tx.send(CodeNotice::Rejected { id, reason });
    }

    fn launch(self: &Arc<Self>, id: String, env_id: String, program: String, workspace: PathBuf) {
        // Without a readable store the receipt cannot be kept, and `save` would
        // replace the receipts that are already there.
        if !self.durable || self.closing.load(Ordering::SeqCst) {
            self.reject(Some(id), "unavailable");
            return;
        }
        let Some(interpreter) = self.interpreter(&env_id) else {
            self.reject(Some(id), "unavailable");
            return;
        };
        let Some(workspace) = fs::canonicalize(workspace)
            .ok()
            .filter(|path| path.is_dir())
        else {
            self.reject(Some(id), "invalid");
            return;
        };
        let Ok(runs_root) = fs::canonicalize(&self.paths.runs_root) else {
            self.reject(Some(id), "unavailable");
            return;
        };
        let Some((prefix, marker_digest)) = process::probe(&interpreter) else {
            self.reject(Some(id), "unavailable");
            return;
        };
        let Some(submit) = submit_paths(
            &id,
            &env_id,
            &program,
            &workspace,
            &runs_root,
            &interpreter,
            &prefix,
            &marker_digest,
        ) else {
            self.reject(Some(id), "invalid");
            return;
        };
        let mut book = self.book.lock().expect("code runs");
        if self.closing.load(Ordering::SeqCst) {
            drop(book);
            self.reject(Some(id), "unavailable");
            return;
        }
        let (next, effect) = match run::apply(&book, Input::Submit(submit)) {
            Ok(ready) => ready,
            Err(reject) => {
                drop(book);
                self.reject(Some(id), reject.text());
                return;
            }
        };
        if save(&self.paths.store, &next).is_err() {
            drop(book);
            self.reject(Some(id), "unavailable");
            return;
        }
        *book = next;
        let Effect::Prepare(spec) = effect else {
            if let Effect::Receipt(receipt) = effect {
                self.publish_receipt(&id, &receipt);
            }
            return;
        };
        if write_program(&spec.program_path, &spec.program).is_err() {
            self.interrupt(&mut book, &id);
            return;
        }
        let spawned = match process::spawn_program(&spec) {
            Ok(spawned) => spawned,
            Err(_) => {
                self.interrupt(&mut book, &id);
                return;
            }
        };
        let tree = Arc::clone(&spawned.tree);
        self.trees.lock().expect("trees").insert(id.clone(), tree);
        match run::apply(
            &book,
            Input::Started {
                request_id: id.clone(),
            },
        ) {
            Ok((next, _)) if save(&self.paths.store, &next).is_ok() => *book = next,
            _ => {
                drop(book);
                if let Some(tree) = self.trees.lock().expect("trees").remove(&id) {
                    tree.kill();
                }
                self.reply(Input::Interrupt { request_id: id });
                return;
            }
        }
        drop(book);
        let mode = Arc::clone(self);
        let limit = self.paths.limit;
        let output_limit = spec.output_limit;
        let request_id = spec.request_id.clone();
        thread::spawn(move || mode.supervise(spawned, request_id, limit, output_limit));
    }

    fn interrupt(&self, book: &mut Book, id: &str) {
        if let Ok((next, effect)) = run::apply(
            book,
            Input::Interrupt {
                request_id: id.to_string(),
            },
        ) {
            if save(&self.paths.store, &next).is_ok() {
                *book = next;
            }
            if let Effect::Receipt(receipt) = effect {
                self.publish_receipt(id, &receipt);
            }
        }
    }

    fn supervise(
        self: &Arc<Self>,
        mut spawned: process::Spawned,
        id: String,
        limit: Duration,
        output_limit: usize,
    ) {
        let tree = Arc::clone(&spawned.tree);
        let stdout = Capture::start(spawned.child.stdout.take(), output_limit);
        let stderr = Capture::start(spawned.child.stderr.take(), output_limit);
        let deadline = Instant::now() + limit;
        let status = loop {
            // The leader is a zombie here: its pid is still ours, so the group
            // can be killed before the leader is reaped.
            if tree.leader_exited() {
                tree.kill();
                break spawned.child.wait().ok();
            }
            match spawned.child.try_wait() {
                Ok(Some(status)) => {
                    tree.sweep_reaped();
                    break Some(status);
                }
                Ok(None) if Instant::now() >= deadline => {
                    let _ = self.transition(Input::Deadline {
                        request_id: id.clone(),
                    });
                    tree.kill();
                    break spawned.child.wait().ok();
                }
                Ok(None) => thread::sleep(Duration::from_millis(20)),
                Err(_) => {
                    tree.kill();
                    let _ = spawned.child.wait();
                    break None;
                }
            }
        };
        tree.disarm();
        let drain = Instant::now() + DRAIN_GRACE;
        let (stdout, stdout_cut) = stdout.finish(drain);
        let (stderr, stderr_cut) = stderr.finish(drain);
        self.trees.lock().expect("trees").remove(&id);
        let input = match status {
            Some(status) => Input::Finish {
                request_id: id.clone(),
                exit_code: status.code(),
                stdout,
                stderr,
                streams_truncated: stdout_cut || stderr_cut,
            },
            None => Input::Interrupt {
                request_id: id.clone(),
            },
        };
        if let Ok(Effect::Receipt(receipt)) = self.transition(input) {
            self.publish_receipt(&id, &receipt);
        }
    }

    fn interpreter(&self, id: &str) -> Option<PathBuf> {
        if !valid_ident(id, MAX_ENV_ID) {
            return None;
        }
        let path = self.paths.settings.as_ref()?;
        let value: serde_json::Value = serde_json::from_slice(&fs::read(path).ok()?).ok()?;
        let entries = value.get("code_envs")?.as_array()?;
        entries.iter().find_map(|entry| {
            let entry_id = entry.get("id")?.as_str()?;
            if entry_id != id || !valid_ident(entry_id, MAX_ENV_ID) {
                return None;
            }
            // Do not resolve symlinks: `venv/bin/python` is a link to the base
            // interpreter, and only the link path selects the environment.
            let interpreter = PathBuf::from(entry.get("interpreter")?.as_str()?);
            (run::is_rooted(interpreter.to_str()?) && interpreter.is_file()).then_some(interpreter)
        })
    }

    fn kill(&self, id: &str) {
        if let Some(tree) = self.trees.lock().expect("trees").get(id).cloned() {
            tree.kill();
        }
    }

    fn publish_receipt(&self, id: &str, receipt: &Receipt) {
        let _ = self.tx.send(CodeNotice::Receipt {
            id: id.to_string(),
            receipt: receipt.clone(),
        });
    }

    fn reply(&self, input: Input) {
        let id = match &input {
            Input::Submit(submit) => submit.request_id.clone(),
            Input::Cancel { request_id }
            | Input::Deadline { request_id }
            | Input::Interrupt { request_id }
            | Input::Started { request_id }
            | Input::Finish { request_id, .. } => request_id.clone(),
        };
        match self.transition(input) {
            Ok(Effect::Receipt(receipt)) => self.publish_receipt(&id, &receipt),
            Ok(Effect::Kill { request_id }) => self.kill(&request_id),
            Ok(_) => {}
            Err(reason) => self.reject(Some(id), reason),
        }
    }

    fn transition(&self, input: Input) -> Result<Effect, &'static str> {
        if !self.durable {
            return Err("unavailable");
        }
        let mut book = self.book.lock().expect("code runs");
        let (next, effect) = run::apply(&book, input).map_err(Reject::text)?;
        save(&self.paths.store, &next).map_err(|_| "unavailable")?;
        *book = next;
        Ok(effect)
    }
}

fn submit_paths(
    id: &str,
    env_id: &str,
    program: &str,
    workspace: &Path,
    runs_root: &Path,
    interpreter: &Path,
    prefix: &str,
    marker_digest: &str,
) -> Option<Submit> {
    Some(Submit {
        request_id: id.to_string(),
        workspace: workspace.to_str()?.to_string(),
        runs_root: runs_root.to_str()?.to_string(),
        env_id: env_id.to_string(),
        interpreter: interpreter.to_str()?.to_string(),
        program: program.to_string(),
        prefix: prefix.to_string(),
        marker_digest: marker_digest.to_string(),
        output_limit: OUTPUT_LIMIT,
    })
}

/// Output of one pipe, kept up to a limit. The pipe is drained to its end so a
/// chatty program never blocks on a full pipe, but only the first bytes are kept.
struct Capture {
    kept: Arc<Mutex<(Vec<u8>, bool)>>,
    done: mpsc::Receiver<()>,
}

impl Capture {
    fn start(pipe: Option<impl Read + Send + 'static>, limit: usize) -> Self {
        let kept = Arc::new(Mutex::new((Vec::new(), false)));
        let (finished, done) = mpsc::channel();
        let sink = Arc::clone(&kept);
        thread::spawn(move || {
            if let Some(mut pipe) = pipe {
                let mut buffer = [0u8; 8192];
                loop {
                    match pipe.read(&mut buffer) {
                        Ok(0) => break,
                        Ok(size) => {
                            let mut kept = sink.lock().expect("capture");
                            let room = limit.saturating_sub(kept.0.len());
                            let take = size.min(room);
                            kept.0.extend_from_slice(&buffer[..take]);
                            kept.1 |= take < size;
                        }
                        Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
                        Err(_) => break,
                    }
                }
            }
            let _ = finished.send(());
        });
        Self { kept, done }
    }

    /// Wait for the end of the pipe until `until`. A pipe that is still open is
    /// cut and reported as truncated.
    fn finish(self, until: Instant) -> (String, bool) {
        let ended = self
            .done
            .recv_timeout(until.saturating_duration_since(Instant::now()))
            .is_ok();
        let kept = self.kept.lock().expect("capture");
        (
            String::from_utf8_lossy(&kept.0).into_owned(),
            kept.1 || !ended,
        )
    }
}

fn write_program(path: &Path, program: &str) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
        set_private(parent, 0o700);
    }
    let temporary = path.with_extension("py.tmp");
    fs::write(&temporary, program)?;
    set_private(&temporary, 0o600);
    fs::rename(temporary, path)
}

fn load(path: &Path) -> Option<Book> {
    if !path.exists() {
        return Some(Book::default());
    }
    serde_json::from_slice(&fs::read(path).ok()?).ok()
}

fn save(path: &Path, book: &Book) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let pending = path.with_extension(format!(
        "{}.{}.pending",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    ));
    let result = (|| {
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&pending)?;
        file.write_all(&serde_json::to_vec_pretty(book)?)?;
        file.sync_all()
    })();
    if result.is_err() {
        let _ = fs::remove_file(&pending);
        return result;
    }
    fs::rename(pending, path)
}

fn set_private(path: &Path, mode: u32) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(mode));
    }
    #[cfg(not(unix))]
    let _ = (path, mode);
}
