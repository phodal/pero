//! Spawn one allowlisted interpreter and record what actually ran.
//!
//! Credentials and `PYTHON*` settings stay in this process. The child receives
//! a short environment allowlist and Python's `-I` isolated mode.

use crate::code_run::{
    self, Book, Effect, Input, OUTPUT_LIMIT, Prepare, Receipt, Reject, Submit, is_rooted,
    valid_ident,
};
use pero_contracts::{CodeCommand, HostEvent};
use std::{
    collections::HashMap,
    fs,
    io::{self, Read, Write},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex, mpsc::Sender},
    thread,
    time::{Duration, Instant},
};

const MAX_REQUEST_ID: usize = 128;
const MAX_ENV_ID: usize = 64;
const PROBE: &str = "\
import hashlib, sys
from pathlib import Path
marker = Path(sys.prefix) / '.pero-packages'
digest = ''
if marker.is_file() and not marker.is_symlink():
    digest = hashlib.sha256(marker.read_bytes()).hexdigest()
print(sys.prefix)
print(digest)
";

pub struct Paths {
    pub settings: Option<PathBuf>,
    pub store: PathBuf,
    pub runs_root: PathBuf,
    pub limit: Duration,
}

pub struct CodeHost {
    paths: Paths,
    book: Mutex<Book>,
    pids: Mutex<HashMap<String, u32>>,
    tx: Sender<HostEvent>,
    durable: bool,
}

pub fn paths_from_env(settings: Option<PathBuf>) -> Paths {
    let store = std::env::var_os("PERO_CODE_RUNS_PATH").map_or_else(
        || {
            std::env::current_dir()
                .unwrap_or_else(|_| PathBuf::from("."))
                .join("target/code-runs.json")
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

impl CodeHost {
    pub fn open(paths: Paths, tx: Sender<HostEvent>) -> Arc<Self> {
        let parents = paths
            .store
            .parent()
            .is_none_or(|parent| fs::create_dir_all(parent).is_ok());
        let created = parents && fs::create_dir_all(&paths.runs_root).is_ok();
        let (book, durable) = if created {
            match load(&paths.store) {
                Some(book) => {
                    let book = code_run::settle(book);
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
            pids: Mutex::new(HashMap::new()),
            tx,
            durable,
        })
    }

    pub fn handle(self: &Arc<Self>, value: serde_json::Value, workspace: PathBuf) {
        let id = value
            .get("id")
            .and_then(|id| id.as_str())
            .filter(|id| valid_ident(id, MAX_REQUEST_ID))
            .map(str::to_string);
        let command = match serde_json::from_value::<CodeCommand>(value) {
            Ok(command) => command,
            Err(_) => {
                self.fail(id, "invalid");
                return;
            }
        };
        match command {
            CodeCommand::CancelCode { id } => self.cancel(id),
            CodeCommand::RunCode {
                id,
                env_id,
                program,
            } => self.start(id, env_id, program, workspace),
        }
    }

    fn start(self: &Arc<Self>, id: String, env_id: String, program: String, workspace: PathBuf) {
        let known = {
            let book = self.book.lock().expect("code runs");
            book.contains(&id)
                .then(|| code_run::replay(&book, &id, &program))
        };
        if let Some(result) = known {
            match result {
                Ok(Effect::Receipt(receipt)) => self.publish_receipt(&id, &receipt),
                Err(reject) => self.fail(Some(id), reject.text()),
                Ok(_) => {}
            }
            return;
        }
        #[cfg(unix)]
        self.launch(id, env_id, program, workspace);
        #[cfg(not(unix))]
        {
            let _ = (env_id, program, workspace);
            self.fail(Some(id), "unavailable");
        }
    }

    fn cancel(self: &Arc<Self>, id: String) {
        match self.transition(Input::Cancel {
            request_id: id.clone(),
        }) {
            Ok(Effect::Kill { request_id }) => self.kill(&request_id),
            Ok(Effect::Receipt(receipt)) => self.publish_receipt(&id, &receipt),
            Ok(_) => {}
            Err(reason) => self.fail(Some(id), reason),
        }
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
            Err(reason) => self.fail(Some(id), reason),
        }
    }

    fn transition(&self, input: Input) -> Result<Effect, &'static str> {
        if !self.durable {
            return Err("unavailable");
        }
        let mut book = self.book.lock().expect("code runs");
        let (next, effect) = code_run::apply(&book, input).map_err(Reject::text)?;
        save(&self.paths.store, &next).map_err(|_| "unavailable")?;
        *book = next;
        Ok(effect)
    }

    #[cfg(unix)]
    fn launch(self: &Arc<Self>, id: String, env_id: String, program: String, workspace: PathBuf) {
        let Some(interpreter) = self.interpreter(&env_id) else {
            self.fail(Some(id), "unavailable");
            return;
        };
        let Some(workspace) = fs::canonicalize(workspace)
            .ok()
            .filter(|path| path.is_dir())
        else {
            self.fail(Some(id), "invalid");
            return;
        };
        let Ok(runs_root) = fs::canonicalize(&self.paths.runs_root) else {
            self.fail(Some(id), "unavailable");
            return;
        };
        let Some((prefix, marker_digest)) = probe(&interpreter) else {
            self.fail(Some(id), "unavailable");
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
            self.fail(Some(id), "invalid");
            return;
        };
        let mut book = self.book.lock().expect("code runs");
        let (next, effect) = match code_run::apply(&book, Input::Submit(submit)) {
            Ok(ready) => ready,
            Err(reject) => {
                drop(book);
                self.fail(Some(id), reject.text());
                return;
            }
        };
        if save(&self.paths.store, &next).is_err() {
            drop(book);
            self.fail(Some(id), "unavailable");
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
        let child = match spawn_program(&spec) {
            Ok(child) => child,
            Err(_) => {
                self.interrupt(&mut book, &id);
                return;
            }
        };
        let pid = child.id();
        self.pids.lock().expect("pids").insert(id.clone(), pid);
        match code_run::apply(
            &book,
            Input::Started {
                request_id: id.clone(),
            },
        ) {
            Ok((next, _)) if save(&self.paths.store, &next).is_ok() => *book = next,
            _ => {
                drop(book);
                kill_group(pid);
                self.reply(Input::Interrupt { request_id: id });
                return;
            }
        }
        drop(book);
        let host = Arc::clone(self);
        let limit = self.paths.limit;
        let output_limit = spec.output_limit;
        let request_id = spec.request_id.clone();
        thread::spawn(move || host.supervise(child, request_id, limit, output_limit));
    }

    fn interrupt(&self, book: &mut Book, id: &str) {
        if let Ok((next, effect)) = code_run::apply(
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

    #[cfg(unix)]
    fn supervise(
        self: &Arc<Self>,
        mut child: Child,
        id: String,
        limit: Duration,
        output_limit: usize,
    ) {
        let pid = child.id();
        let mut group = Group { pid, live: true };
        let stdout_pipe = child.stdout.take();
        let stderr_pipe = child.stderr.take();
        let stdout = thread::spawn(move || read_capped(stdout_pipe, output_limit));
        let stderr = thread::spawn(move || read_capped(stderr_pipe, output_limit));
        let deadline = Instant::now() + limit;
        let status = loop {
            match child.try_wait() {
                Ok(Some(status)) => break Some(status),
                Ok(None) if Instant::now() >= deadline => {
                    let _ = self.transition(Input::Deadline {
                        request_id: id.clone(),
                    });
                    kill_group(pid);
                    group.live = false;
                    break child.wait().ok();
                }
                Ok(None) => thread::sleep(Duration::from_millis(20)),
                Err(_) => break None,
            }
        };
        group.live = false;
        let (stdout, stdout_cut) = stdout.join().unwrap_or_default();
        let (stderr, stderr_cut) = stderr.join().unwrap_or_default();
        self.pids.lock().expect("pids").remove(&id);
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
            let interpreter = fs::canonicalize(entry.get("interpreter")?.as_str()?).ok()?;
            interpreter.is_file().then_some(interpreter)
        })
    }

    fn kill(&self, id: &str) {
        if let Some(pid) = self.pids.lock().expect("pids").get(id).copied() {
            kill_group(pid);
        }
    }

    fn publish_receipt(&self, id: &str, receipt: &Receipt) {
        let mut event = HostEvent::new(
            "code_run",
            Some(id.to_string()),
            match receipt.stop {
                code_run::Stop::Exit => "exit",
                code_run::Stop::Cancel => "cancel",
                code_run::Stop::Deadline => "deadline",
                code_run::Stop::Unknown => "unknown",
            }
            .into(),
        );
        event.data = serde_json::to_value(receipt).unwrap_or(serde_json::Value::Null);
        let _ = self.tx.send(event);
    }

    fn fail(&self, id: Option<String>, reason: &str) {
        let _ = self.tx.send(HostEvent::new("error", id, reason.into()));
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

#[cfg(unix)]
fn spawn_program(spec: &Prepare) -> io::Result<Child> {
    use std::os::unix::process::CommandExt;
    let mut command = Command::new(&spec.interpreter);
    command
        .arg("-I")
        .arg(&spec.program_path)
        .current_dir(&spec.cwd)
        .env_clear()
        .envs(kept_env())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .process_group(0);
    command.spawn()
}

#[cfg(unix)]
fn probe(interpreter: &Path) -> Option<(String, String)> {
    use std::os::unix::process::CommandExt;
    let mut command = Command::new(interpreter);
    command
        .arg("-I")
        .arg("-c")
        .arg(PROBE)
        .env_clear()
        .envs(kept_env())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .process_group(0);
    let mut child = command.spawn().ok()?;
    let pid = child.id();
    let deadline = Instant::now() + Duration::from_secs(5);
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() >= deadline => {
                kill_group(pid);
                let _ = child.wait();
                return None;
            }
            Ok(None) => thread::sleep(Duration::from_millis(20)),
            Err(_) => return None,
        }
    };
    if !status.success() {
        return None;
    }
    let mut output = String::new();
    child.stdout.take()?.read_to_string(&mut output).ok()?;
    if output.len() > 8192 {
        return None;
    }
    let mut lines = output.lines();
    let prefix = lines.next()?.trim();
    let marker = lines.next().unwrap_or("").trim();
    if !is_rooted(prefix)
        || prefix.len() > 4096
        || marker.len() > 64
        || !marker.bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return None;
    }
    Some((prefix.to_string(), marker.to_string()))
}

fn kept_env() -> Vec<(String, String)> {
    [
        "PATH",
        "HOME",
        "TMPDIR",
        "TEMP",
        "TMP",
        "LANG",
        "LC_ALL",
        "LC_CTYPE",
        "USER",
        "LOGNAME",
        "SYSTEMROOT",
        "WINDIR",
    ]
    .into_iter()
    .filter_map(|key| {
        let value = std::env::var(key).ok()?;
        (value.len() <= 32_768 && !value.contains('\0') && !value.is_empty())
            .then(|| (key.to_string(), value))
    })
    .collect()
}

fn read_capped(mut pipe: Option<impl Read + Send>, limit: usize) -> (String, bool) {
    let Some(pipe) = pipe.as_mut() else {
        return (String::new(), false);
    };
    let mut kept = Vec::new();
    let mut extra = false;
    let mut buffer = [0u8; 8192];
    loop {
        match pipe.read(&mut buffer) {
            Ok(0) => break,
            Ok(size) => {
                if kept.len() >= limit {
                    extra = true;
                } else {
                    let take = size.min(limit - kept.len());
                    kept.extend_from_slice(&buffer[..take]);
                    extra |= take < size;
                }
            }
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            Err(_) => break,
        }
    }
    (String::from_utf8_lossy(&kept).into_owned(), extra)
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

#[cfg(unix)]
fn kill_group(pid: u32) {
    if pid <= 1 {
        return;
    }
    unsafe {
        libc::kill(-(pid as i32), libc::SIGKILL);
        libc::kill(pid as i32, libc::SIGKILL);
    }
}

#[cfg(not(unix))]
fn kill_group(_pid: u32) {}

struct Group {
    pid: u32,
    live: bool,
}
impl Drop for Group {
    fn drop(&mut self) {
        if self.live {
            kill_group(self.pid);
        }
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use crate::code_run::{apply, program_digest};
    use serde_json::json;
    use std::sync::mpsc;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("pero-code-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn interpreter(dir: &Path) -> (PathBuf, PathBuf, PathBuf) {
        let script = dir.join("python");
        let log = dir.join("log");
        let ready = dir.join("ready");
        let body = "#!/bin/sh
if [ \"$1\" = \"-I\" ] && [ \"$2\" = \"-c\" ]; then
  printf '%s\\n' /opt/science deadbeef
  exit 0
fi
printf '%s\\n' \"$2\" >> \"__LOG__\"
if grep -q SLEEP \"$2\"; then
  : > \"__READY__\"
  sleep 30
fi
if grep -q FAIL \"$2\"; then
  echo boom >&2
  exit 3
fi
echo ok
exit 0
"
        .replace("__LOG__", &log.display().to_string())
        .replace("__READY__", &ready.display().to_string());
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o755);
        options
            .open(&script)
            .unwrap()
            .write_all(body.as_bytes())
            .unwrap();
        (script, log, ready)
    }

    fn host(
        dir: &Path,
        script: &Path,
        limit: Duration,
    ) -> (Arc<CodeHost>, mpsc::Receiver<HostEvent>) {
        fs::write(
            dir.join("settings.json"),
            json!({"code_envs":[{"id":"local","interpreter":script}]}).to_string(),
        )
        .unwrap();
        fs::create_dir_all(dir.join("ws")).unwrap();
        let (tx, rx) = mpsc::channel();
        let code = CodeHost::open(
            Paths {
                settings: Some(dir.join("settings.json")),
                store: dir.join("runs.json"),
                runs_root: dir.join("programs"),
                limit,
            },
            tx,
        );
        (code, rx)
    }

    fn command(id: &str, program: &str) -> serde_json::Value {
        json!({"action":"run_code","id":id,"env_id":"local","program":program})
    }

    fn wait(rx: &mpsc::Receiver<HostEvent>) -> HostEvent {
        rx.recv_timeout(Duration::from_secs(5)).expect("code event")
    }

    #[test]
    fn a_run_records_the_interpreter_and_replays_without_spawning_again() {
        let dir = scratch("replay");
        let (script, log, _) = interpreter(&dir);
        let (code, rx) = host(&dir, &script, Duration::from_secs(5));
        code.handle(command("run-1", "print(1)\n"), dir.join("ws"));
        let event = wait(&rx);
        assert_eq!(event.kind, "code_run");
        assert_eq!(event.text, "exit");
        assert_eq!(event.data["stop"], "exit");
        assert_eq!(event.data["exit_code"], 0);
        assert_eq!(event.data["stdout"], "ok\n");
        assert_eq!(event.data["prefix"], "/opt/science");
        assert_eq!(event.data["marker_digest"], "deadbeef");
        assert_eq!(event.data["truncated"], false);
        assert_eq!(event.data["program_digest"], program_digest("print(1)\n"));
        assert_eq!(
            event.data["interpreter"],
            fs::canonicalize(&script).unwrap().to_str().unwrap()
        );
        code.handle(command("run-1", "print(1)\n"), dir.join("ws"));
        let again = wait(&rx);
        assert_eq!(again.data["program_digest"], event.data["program_digest"]);
        assert_eq!(fs::read_to_string(&log).unwrap().lines().count(), 1);
        code.handle(command("run-1", "print(2)\n"), dir.join("ws"));
        let conflict = wait(&rx);
        assert_eq!(conflict.kind, "error");
        assert_eq!(conflict.text, "conflict");
        assert_eq!(fs::read_to_string(&log).unwrap().lines().count(), 1);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn failure_cancel_deadline_and_restart_stay_distinct() {
        let dir = scratch("stops");
        let (script, log, ready) = interpreter(&dir);
        let (code, rx) = host(&dir, &script, Duration::from_secs(5));
        code.handle(
            command("missing-env", "print(1)\n").tap_env("other"),
            dir.join("ws"),
        );
        // unavailable before the helper: no env id match
        let missing = wait(&rx);
        assert_eq!(missing.text, "unavailable");

        code.handle(command("bad", "FAIL\n"), dir.join("ws"));
        let failed = wait(&rx);
        assert_eq!(failed.data["stop"], "exit");
        assert_eq!(failed.data["exit_code"], 3);
        assert_eq!(failed.data["stderr"], "boom\n");

        code.handle(command("sleep", "SLEEP\n"), dir.join("ws"));
        for _ in 0..100 {
            if ready.exists() {
                break;
            }
            thread::sleep(Duration::from_millis(20));
        }
        assert!(ready.exists(), "sleeper did not start");
        code.handle(command("other", "print(1)\n"), dir.join("ws"));
        let busy = wait(&rx);
        assert_eq!(busy.text, "busy");
        code.handle(json!({"action":"cancel_code","id":"sleep"}), dir.join("ws"));
        let cancelled = wait(&rx);
        assert_eq!(cancelled.text, "cancel");
        assert_eq!(cancelled.data["stop"], "cancel");

        let (quick, rx) = host(&dir, &script, Duration::from_millis(200));
        quick.handle(command("late", "SLEEP\n"), dir.join("ws"));
        let late = wait(&rx);
        assert_eq!(late.text, "deadline");
        let _ = (log, fs::remove_dir_all(&dir));
    }

    #[test]
    fn an_interrupted_request_is_not_started_again() {
        let dir = scratch("restart");
        let (script, log, _) = interpreter(&dir);
        let workspace = fs::canonicalize(dir.join("ws")).unwrap_or_else(|_| {
            fs::create_dir_all(dir.join("ws")).unwrap();
            fs::canonicalize(dir.join("ws")).unwrap()
        });
        fs::create_dir_all(dir.join("programs")).unwrap();
        let runs_root = fs::canonicalize(dir.join("programs")).unwrap();
        let program = "print(9)\n";
        let (book, _) = apply(
            &Book::default(),
            Input::Submit(Submit {
                request_id: "stuck".into(),
                workspace: workspace.to_str().unwrap().into(),
                runs_root: runs_root.to_str().unwrap().into(),
                env_id: "local".into(),
                interpreter: script.to_str().unwrap().into(),
                program: program.into(),
                prefix: "/opt/science".into(),
                marker_digest: "deadbeef".into(),
                output_limit: OUTPUT_LIMIT,
            }),
        )
        .unwrap();
        let (book, _) = apply(
            &book,
            Input::Started {
                request_id: "stuck".into(),
            },
        )
        .unwrap();
        save(&dir.join("runs.json"), &book).unwrap();
        fs::write(
            dir.join("settings.json"),
            json!({"code_envs":[{"id":"local","interpreter":script}]}).to_string(),
        )
        .unwrap();
        let (tx, rx) = mpsc::channel();
        let code = CodeHost::open(
            Paths {
                settings: Some(dir.join("settings.json")),
                store: dir.join("runs.json"),
                runs_root: dir.join("programs"),
                limit: Duration::from_secs(5),
            },
            tx,
        );
        code.handle(command("stuck", program), workspace);
        let event = wait(&rx);
        assert_eq!(event.text, "unknown");
        assert_eq!(event.data["exit_code"], serde_json::Value::Null);
        assert_eq!(event.data["program_digest"], program_digest(program));
        assert!(!log.exists());
        assert_eq!(event.data["stop"], "unknown");
        let _ = fs::remove_dir_all(&dir);
    }

    trait Env {
        fn tap_env(self, env_id: &str) -> Self;
    }
    impl Env for serde_json::Value {
        fn tap_env(mut self, env_id: &str) -> Self {
            self["env_id"] = env_id.into();
            self
        }
    }
}
