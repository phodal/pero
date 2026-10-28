use pero_codemode::{CodeMode, CodeNotice, Paths, run::program_digest};
use serde_json::json;
use std::{
    fs,
    path::PathBuf,
    sync::{Arc, mpsc},
    thread,
    time::Duration,
};

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("pero-code-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn prefix() -> &'static str {
    if cfg!(windows) {
        r"C:\science"
    } else {
        "/opt/science"
    }
}

fn fake() -> String {
    fs::canonicalize(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../target"))
        .expect("target directory")
        .join(if cfg!(debug_assertions) {
            "debug"
        } else {
            "release"
        })
        .join(if cfg!(windows) {
            "pero-code-fake.exe"
        } else {
            "pero-code-fake"
        })
        .to_str()
        .expect("utf-8")
        .to_string()
}

fn host(dir: &std::path::Path, limit: Duration) -> (Arc<CodeMode>, mpsc::Receiver<CodeNotice>) {
    host_with(dir, limit, fake())
}

fn host_with(
    dir: &std::path::Path,
    limit: Duration,
    script: String,
) -> (Arc<CodeMode>, mpsc::Receiver<CodeNotice>) {
    fs::write(
        dir.join("settings.json"),
        json!({"code_envs":[{"id":"local","interpreter":script}]}).to_string(),
    )
    .unwrap();
    fs::create_dir_all(dir.join("ws")).unwrap();
    let (tx, rx) = mpsc::channel();
    let mode = CodeMode::open(
        Paths {
            settings: Some(dir.join("settings.json")),
            store: dir.join("runs.json"),
            runs_root: dir.join("programs"),
            limit,
        },
        tx,
    );
    (mode, rx)
}

fn wait(rx: &mpsc::Receiver<CodeNotice>) -> CodeNotice {
    rx.recv_timeout(Duration::from_secs(5)).expect("code event")
}

#[test]
fn a_run_records_the_interpreter_and_replays_without_spawning_again() {
    let dir = scratch("replay");
    let (mode, rx) = host(&dir, Duration::from_secs(5));
    let workspace = dir.join("ws");
    mode.run(
        "run-1".into(),
        "local".into(),
        "print(1)\n".into(),
        workspace.clone(),
    );
    let CodeNotice::Receipt { receipt, .. } = wait(&rx) else {
        panic!("expected a receipt");
    };
    assert_eq!(receipt.stop, pero_codemode::run::Stop::Exit);
    assert_eq!(receipt.exit_code, Some(0));
    assert_eq!(receipt.stdout, "ok\n");
    assert_eq!(receipt.prefix, prefix());
    assert_eq!(receipt.marker_digest, "deadbeef");
    assert!(!receipt.truncated);
    assert_eq!(receipt.program_digest, program_digest("print(1)\n"));
    assert_eq!(receipt.interpreter, fake());
    mode.run(
        "run-1".into(),
        "local".into(),
        "print(1)\n".into(),
        workspace.clone(),
    );
    let CodeNotice::Receipt { receipt: again, .. } = wait(&rx) else {
        panic!("expected a replay");
    };
    assert_eq!(again.program_digest, receipt.program_digest);
    let log = fs::read_to_string(workspace.join("invocations.log")).unwrap();
    assert_eq!(log.lines().count(), 1);
    mode.run(
        "run-1".into(),
        "local".into(),
        "print(2)\n".into(),
        workspace.clone(),
    );
    let CodeNotice::Rejected { reason, .. } = wait(&rx) else {
        panic!("expected a conflict");
    };
    assert_eq!(reason, "conflict");
    assert_eq!(
        fs::read_to_string(workspace.join("invocations.log"))
            .unwrap()
            .lines()
            .count(),
        1
    );
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn failure_cancel_deadline_and_a_busy_workspace_stay_distinct() {
    let dir = scratch("stops");
    let (mode, rx) = host(&dir, Duration::from_secs(5));
    let workspace = dir.join("ws");
    mode.run(
        "missing-env".into(),
        "other".into(),
        "print(1)\n".into(),
        workspace.clone(),
    );
    let CodeNotice::Rejected { reason, .. } = wait(&rx) else {
        panic!("expected unavailable");
    };
    assert_eq!(reason, "unavailable");

    mode.run(
        "bad".into(),
        "local".into(),
        "FAIL\n".into(),
        workspace.clone(),
    );
    let CodeNotice::Receipt { receipt, .. } = wait(&rx) else {
        panic!("expected a failure receipt");
    };
    assert_eq!(receipt.stop, pero_codemode::run::Stop::Exit);
    assert_eq!(receipt.exit_code, Some(3));
    assert_eq!(receipt.stderr, "boom\n");

    mode.run(
        "sleep".into(),
        "local".into(),
        "SLEEP\n".into(),
        workspace.clone(),
    );
    let ready = workspace.join("ready");
    for _ in 0..100 {
        if ready.exists() {
            break;
        }
        thread::sleep(Duration::from_millis(20));
    }
    assert!(ready.exists(), "sleeper did not start");
    mode.run(
        "other".into(),
        "local".into(),
        "print(1)\n".into(),
        workspace.clone(),
    );
    let CodeNotice::Rejected { reason, .. } = wait(&rx) else {
        panic!("expected busy");
    };
    assert_eq!(reason, "busy");
    mode.cancel("sleep".into());
    let CodeNotice::Receipt { receipt, .. } = wait(&rx) else {
        panic!("expected a cancel receipt");
    };
    assert_eq!(receipt.stop, pero_codemode::run::Stop::Cancel);

    let (quick, rx) = host(&dir, Duration::from_millis(200));
    quick.run("late".into(), "local".into(), "SLEEP\n".into(), workspace);
    let CodeNotice::Receipt { receipt, .. } = wait(&rx) else {
        panic!("expected a deadline receipt");
    };
    assert_eq!(receipt.stop, pero_codemode::run::Stop::Deadline);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn a_saved_running_book_is_not_started_again() {
    let dir = scratch("restart");
    let script = fs::canonicalize(fake())
        .unwrap()
        .to_str()
        .unwrap()
        .to_string();
    fs::create_dir_all(dir.join("ws")).unwrap();
    fs::create_dir_all(dir.join("programs")).unwrap();
    let workspace = fs::canonicalize(dir.join("ws")).unwrap();
    let runs_root = fs::canonicalize(dir.join("programs")).unwrap();
    let program = "print(9)\n";
    let (book, _) = pero_codemode::run::apply(
        &pero_codemode::run::Book::default(),
        pero_codemode::run::Input::Submit(pero_codemode::run::Submit {
            request_id: "stuck".into(),
            workspace: workspace.to_str().unwrap().into(),
            runs_root: runs_root.to_str().unwrap().into(),
            env_id: "local".into(),
            interpreter: script.clone(),
            program: program.into(),
            prefix: prefix().into(),
            marker_digest: "deadbeef".into(),
            output_limit: pero_codemode::run::OUTPUT_LIMIT,
        }),
    )
    .unwrap();
    let (book, _) = pero_codemode::run::apply(
        &book,
        pero_codemode::run::Input::Started {
            request_id: "stuck".into(),
        },
    )
    .unwrap();
    fs::write(
        dir.join("runs.json"),
        serde_json::to_vec_pretty(&book).unwrap(),
    )
    .unwrap();
    fs::write(
        dir.join("settings.json"),
        json!({"code_envs":[{"id":"local","interpreter":script}]}).to_string(),
    )
    .unwrap();
    let (tx, rx) = mpsc::channel();
    let mode = CodeMode::open(
        Paths {
            settings: Some(dir.join("settings.json")),
            store: dir.join("runs.json"),
            runs_root,
            limit: Duration::from_secs(5),
        },
        tx,
    );
    mode.run(
        "stuck".into(),
        "local".into(),
        program.into(),
        workspace.clone(),
    );
    let CodeNotice::Receipt { receipt, .. } = wait(&rx) else {
        panic!("expected unknown");
    };
    assert_eq!(receipt.stop, pero_codemode::run::Stop::Unknown);
    assert_eq!(receipt.exit_code, None);
    assert_eq!(receipt.program_digest, program_digest(program));
    assert!(!workspace.join("invocations.log").exists());
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn a_corrupt_store_refuses_runs_and_is_left_alone() {
    let dir = scratch("corrupt");
    fs::write(dir.join("runs.json"), "{ not json").unwrap();
    let (mode, rx) = host(&dir, Duration::from_secs(5));
    mode.run(
        "run-1".into(),
        "local".into(),
        "print(1)\n".into(),
        dir.join("ws"),
    );
    let CodeNotice::Rejected { reason, .. } = wait(&rx) else {
        panic!("expected unavailable");
    };
    assert_eq!(reason, "unavailable");
    assert_eq!(
        fs::read_to_string(dir.join("runs.json")).unwrap(),
        "{ not json"
    );
    assert!(!dir.join("ws/invocations.log").exists());
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn ids_that_name_the_parent_directory_are_refused() {
    let dir = scratch("ids");
    let (mode, rx) = host(&dir, Duration::from_secs(5));
    for id in ["..", ".", "a.", "NUL"] {
        mode.run(id.into(), "local".into(), "print(1)\n".into(), dir.join("ws"));
        let CodeNotice::Rejected { reason, .. } = wait(&rx) else {
            panic!("{id} must be refused");
        };
        assert_eq!(reason, "invalid");
    }
    assert!(!dir.join("ws/invocations.log").exists());
    assert!(!dir.join("program.py").exists());
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn the_store_sits_beside_the_settings_file() {
    if std::env::var_os("PERO_CODE_RUNS_PATH").is_some() {
        return;
    }
    let paths = pero_codemode::paths_from_env(Some(PathBuf::from("/profile/settings.json")));
    assert_eq!(paths.store, PathBuf::from("/profile/code-runs.json"));
}

#[cfg(unix)]
mod real_python {
    use super::*;
    use pero_codemode::run::Stop;

    fn python() -> Option<String> {
        std::env::split_paths(&std::env::var_os("PATH")?)
            .map(|dir| dir.join("python3"))
            .find(|path| path.is_file())
            .and_then(|path| path.to_str().map(str::to_string))
    }

    fn alive(pid: i32) -> bool {
        // SAFETY: signal 0 only checks that the pid exists.
        if unsafe { libc::kill(pid, 0) } != 0 {
            return false;
        }
        // A killed process nobody has reaped yet is not running.
        fs::read_to_string(format!("/proc/{pid}/stat"))
            .map(|stat| !stat.rsplit(')').next().unwrap_or("").trim_start().starts_with('Z'))
            .unwrap_or(true)
    }

    fn gone(pid: i32) -> bool {
        for _ in 0..100 {
            if !alive(pid) {
                return true;
            }
            thread::sleep(Duration::from_millis(20));
        }
        false
    }

    fn pid_of(workspace: &std::path::Path, name: &str) -> i32 {
        for _ in 0..200 {
            if let Ok(text) = fs::read_to_string(workspace.join(name)) {
                if let Ok(pid) = text.trim().parse() {
                    return pid;
                }
            }
            thread::sleep(Duration::from_millis(20));
        }
        panic!("{name} was not written");
    }

    #[test]
    fn a_virtual_environment_keeps_its_own_prefix() {
        let Some(python) = python() else { return };
        let dir = scratch("venv");
        let venv = dir.join("venv");
        let made = std::process::Command::new(&python)
            .args(["-m", "venv", "--without-pip"])
            .arg(&venv)
            .status();
        if !made.is_ok_and(|status| status.success()) {
            return;
        }
        let interpreter = venv.join("bin/python");
        let (mode, rx) = host_with(
            &dir,
            Duration::from_secs(10),
            interpreter.to_str().unwrap().into(),
        );
        mode.run(
            "venv-run".into(),
            "local".into(),
            "import sys\nprint(sys.prefix)\n".into(),
            dir.join("ws"),
        );
        let CodeNotice::Receipt { receipt, .. } = wait(&rx) else {
            panic!("expected a receipt");
        };
        let prefix = fs::canonicalize(&venv).unwrap();
        assert_eq!(receipt.stop, Stop::Exit);
        // macOS reports the same directory through /var or /private/var.
        let same = |text: &str| fs::canonicalize(text.trim()).unwrap() == prefix;
        assert!(same(&receipt.prefix), "prefix {}", receipt.prefix);
        assert!(same(&receipt.stdout), "stdout {}", receipt.stdout);
        assert_eq!(receipt.interpreter, interpreter.to_str().unwrap());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_relative_interpreter_is_not_an_environment() {
        let Some(_) = python() else { return };
        let dir = scratch("relative");
        let (mode, rx) = host_with(&dir, Duration::from_secs(5), "python3".into());
        mode.run(
            "rel".into(),
            "local".into(),
            "print(1)\n".into(),
            dir.join("ws"),
        );
        let CodeNotice::Rejected { reason, .. } = wait(&rx) else {
            panic!("expected unavailable");
        };
        assert_eq!(reason, "unavailable");
        let _ = fs::remove_dir_all(&dir);
    }

    fn spawn(options: &str) -> String {
        format!(
            "import subprocess\n\
             p = subprocess.Popen(['sleep', '60']{options})\n\
             open('child.pid', 'w').write(str(p.pid))\n\
             print('parent done')\n"
        )
    }

    #[test]
    fn a_background_child_is_killed_with_its_run() {
        let Some(python) = python() else { return };
        let dir = scratch("orphan");
        let (mode, rx) = host_with(&dir, Duration::from_secs(10), python);
        let workspace = dir.join("ws");
        let started = std::time::Instant::now();
        mode.run(
            "orphan".into(),
            "local".into(),
            spawn(""),
            workspace.clone(),
        );
        let CodeNotice::Receipt { receipt, .. } = wait(&rx) else {
            panic!("expected a receipt");
        };
        assert!(started.elapsed() < Duration::from_secs(8), "the receipt waited for the child");
        assert_eq!(receipt.stop, Stop::Exit);
        assert_eq!(receipt.stdout, "parent done\n");
        assert!(!receipt.truncated);
        assert!(gone(pid_of(&workspace, "child.pid")), "the child outlived its run");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_child_that_left_the_group_cannot_hold_the_receipt() {
        let Some(python) = python() else { return };
        let dir = scratch("escaped");
        let (mode, rx) = host_with(&dir, Duration::from_secs(10), python);
        let workspace = dir.join("ws");
        let started = std::time::Instant::now();
        mode.run(
            "escaped".into(),
            "local".into(),
            spawn(", start_new_session=True"),
            workspace.clone(),
        );
        let CodeNotice::Receipt { receipt, .. } = wait(&rx) else {
            panic!("expected a receipt");
        };
        assert!(started.elapsed() < Duration::from_secs(8), "the receipt waited for the child");
        assert_eq!(receipt.stop, Stop::Exit);
        assert!(receipt.truncated, "output that was cut must say so");
        let pid = pid_of(&workspace, "child.pid");
        // SAFETY: the test started this process and it is the one it kills.
        unsafe { libc::kill(pid, libc::SIGKILL) };
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn shutdown_stops_the_run_and_a_restart_reads_it_as_unknown() {
        let Some(python) = python() else { return };
        let dir = scratch("shutdown");
        let (mode, rx) = host_with(&dir, Duration::from_secs(30), python.clone());
        let workspace = dir.join("ws");
        let program = "import os, time\nopen('self.pid', 'w').write(str(os.getpid()))\ntime.sleep(60)\n";
        mode.run(
            "long".into(),
            "local".into(),
            program.into(),
            workspace.clone(),
        );
        let pid = pid_of(&workspace, "self.pid");
        mode.shutdown();
        assert!(gone(pid), "the run survived the Host");
        mode.run(
            "late".into(),
            "local".into(),
            "print(1)\n".into(),
            workspace.clone(),
        );
        let CodeNotice::Rejected { reason, .. } = wait(&rx) else {
            panic!("a closing Host must refuse new runs");
        };
        assert_eq!(reason, "unavailable");

        let (again, rx) = host_with(&dir, Duration::from_secs(5), python);
        again.run("long".into(), "local".into(), program.into(), workspace);
        let CodeNotice::Receipt { receipt, .. } = wait(&rx) else {
            panic!("expected the stored receipt");
        };
        assert_eq!(receipt.stop, Stop::Unknown);
        let _ = fs::remove_dir_all(&dir);
    }
}
