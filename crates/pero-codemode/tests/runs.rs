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
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../target")
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
    let script = fake();
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
    assert_eq!(
        receipt.interpreter,
        fs::canonicalize(fake()).unwrap().to_str().unwrap()
    );
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
