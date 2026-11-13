use super::*;
use crate::apps::{definition::AppDefinition, process::AppProcess};
use serde_json::{Value, json};
use std::time::{Duration, Instant};

#[test]
fn remote_requests_admit_only_the_fixed_method_and_typed_references() {
    let cluster = json!({"id":"cluster-test","name":"Loopback","host":"loopback","scheduler":"ssh","account":"","partition":"","workdir":"/tmp/pero"});
    for (samples, repetitions, valid) in [
        (1000, 1, true),
        (10000000, 100000, true),
        (999, 1, false),
        (1000, 0, false),
        (10000001, 1, false),
    ] {
        assert_eq!(serde_json::from_value::<Request>(json!({"operation":"prepare","cluster":cluster,"input":{"samples":samples,"repetitions":repetitions}})).is_ok(),valid);
    }
    for request in [
        json!({"operation":"execute","command":"echo no"}),
        json!({"operation":"prepare","cluster":cluster,"input":{"samples":1000,"repetitions":1,"command":"echo no"}}),
        json!({"operation":"submit","id":"../escape","digest":"a".repeat(64)}),
    ] {
        assert!(serde_json::from_value::<Request>(request).is_err());
    }
}

#[test]
fn remote_presentation_does_not_infer_queued_or_stopped_from_incomplete_owner_facts() {
    let id = identity("attempt".into()).unwrap();
    let cluster = Cluster {
        id: id.clone(),
        name: "site".into(),
        host: "alias".into(),
        account: String::new(),
        partition: "cpu".into(),
        workdir: "/tmp/site".into(),
        scheduler: Scheduler::Slurm,
    };
    let probe = SshProbe {
        hostname: "node".into(),
        system: "Linux".into(),
        architecture: "x86_64".into(),
        python: "3.12.0".into(),
    };
    let constraints = BatchConstraints::new(identity("cpu".into()).unwrap(), 1, 256, 600).unwrap();
    let submission = BatchSubmission {
        operation: id.clone(),
        cluster: id.clone(),
        constraints,
        payload: ContentDigest::of(&"payload"),
        job_id: 1,
        submit_time: 1,
    };
    let mut a = Attempt {
        id: id.clone(),
        cluster,
        input: serde_json::from_value(json!({"samples":1000,"repetitions":1})).unwrap(),
        directory: "/tmp/site/attempt".into(),
        digest: ContentDigest::of(&"plan"),
        snapshot: snapshot(&probe, &id, &id, 1).unwrap(),
        staged: true,
        slurm: None,
        submitted_at: Some(1),
        process: None,
        batch: Some(submission.clone()),
        batch_observation: None,
        cancel_requested: false,
        outputs: vec![],
        collection_error: None,
        error: None,
    };
    for (states, end_time, expected) in [
        (vec![BatchState::Pending], None, "queued"),
        (vec![BatchState::Running], None, "running"),
        (vec![], None, "unknown"),
        (vec![BatchState::Unknown], None, "unknown"),
        (vec![BatchState::Cancelled], None, "unknown"),
        (vec![BatchState::Cancelled], Some(2), "stopped"),
        (vec![BatchState::Completed], Some(2), "completed"),
        (vec![BatchState::Failed], Some(2), "failed"),
    ] {
        a.batch_observation = Some(BatchObservation {
            submission: submission.clone(),
            states,
            nodes: String::new(),
            start_time: None,
            end_time,
        });
        assert_eq!(a.display_state(), expected);
    }
    a.submitted_at = None;
    a.staged = false;
    assert_eq!(a.display_state(), "preparation_failed");
    a.staged = true;
    assert_eq!(a.display_state(), "prepared");
}

/// Actual App HTTP → private Host → authenticated OpenSSH → remote Python.
/// Opt-in because the operator supplies the existing/disposable SSH configuration.
#[test]
#[ignore = "requires PERO_TEST_SSH, PERO_TEST_SSH_HOST and PERO_TEST_SSH_DIRECTORY"]
fn app_remote_loopback_run_collect_restart_and_cancel() {
    let ssh = std::env::var("PERO_TEST_SSH").expect("ssh wrapper");
    assert_eq!(
        std::env::var("PERO_COMPUTE_SSH").expect("Host ssh selection"),
        ssh
    );
    let host = std::env::var("PERO_TEST_SSH_HOST").unwrap();
    let workdir = std::env::var("PERO_TEST_SSH_DIRECTORY").unwrap();
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .unwrap();
    let app_root = root.join("apps/compute");
    let data = root
        .join("test-results/compute/host-loopback")
        .join(uuid::Uuid::new_v4().to_string());
    fs::create_dir_all(&data).unwrap();
    let definition = AppDefinition::parse(&fs::read(app_root.join("app.json")).unwrap()).unwrap();
    let start = || AppProcess::start(&definition, &app_root, &data, None).unwrap();
    let mut app = start();
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(90))
        .build()
        .unwrap();
    let post = |app: &mut AppProcess, path: &str, value: Value| {
        let access = app.access().unwrap();
        client
            .post(format!("{}{path}", access.url))
            .header("X-Pero-App-Token", access.token)
            .header("Content-Type", "application/json")
            .body(value.to_string())
            .send()
            .unwrap()
    };
    let remote = |app: &mut AppProcess, value: Value| {
        let response = post(app, "/api/remote", value);
        let status = response.status();
        let body: Value = serde_json::from_str(&response.text().unwrap()).unwrap();
        assert!(status.is_success(), "{status}: {body}");
        body
    };
    let saved: Value = serde_json::from_str(&post(
        &mut app,
        "/api/clusters",
        json!({"name":"Authenticated loopback","host":host,"scheduler":"ssh","workdir":workdir}),
    ).text().unwrap()).unwrap();
    let cluster = saved["selectedClusterId"].clone();
    let probe = remote(&mut app, json!({"operation":"probe","clusterId":cluster}));
    assert!(probe["probe"]["python"].as_str().unwrap().starts_with('3'));
    let prepared = remote(
        &mut app,
        json!({"operation":"prepare","clusterId":cluster,"samples":10000,"repetitions":1}),
    );
    let a = prepared["attempts"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["state"] == "prepared")
        .unwrap();
    let (id, digest) = (a["id"].clone(), a["digest"].clone());
    assert_eq!(a["useState"], "NotAcquired");
    let denied = post(
        &mut app,
        "/api/remote",
        json!({"operation":"submit","id":id,"digest":"0".repeat(64)}),
    );
    assert_eq!(denied.status().as_u16(), 502);
    remote(
        &mut app,
        json!({"operation":"submit","id":id,"digest":digest}),
    );
    let mut last = Value::Null;
    let deadline = Instant::now() + Duration::from_secs(30);
    while Instant::now() < deadline {
        last = remote(&mut app, json!({"operation":"observe","id":id}));
        let a = last["attempts"]
            .as_array()
            .unwrap()
            .iter()
            .find(|a| a["id"] == id)
            .unwrap();
        if a["state"] == "completed" {
            break;
        }
    }
    let a = last["attempts"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["id"] == id)
        .unwrap();
    assert_eq!(a["state"], "completed");
    assert_eq!(a["useState"], "Released");
    assert!(
        a["logs"]["stdout"]
            .as_str()
            .unwrap()
            .contains("result.json written")
    );
    let collected = remote(&mut app, json!({"operation":"collect","id":id}));
    let a = collected["attempts"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["id"] == id)
        .unwrap();
    let result = a["outputs"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["path"] == "result.json")
        .unwrap();
    let artifact = remote(
        &mut app,
        json!({"operation":"artifact","id":id,"digest":result["sha256"]}),
    );
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(artifact["base64"].as_str().unwrap())
        .unwrap();
    let result: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(result["checkPassed"], true);
    assert_eq!(result["scientificAcceptance"], "unreviewed");
    fs::write(
        data.join("run-evidence.json"),
        serde_json::to_vec_pretty(&collected).unwrap(),
    )
    .unwrap();
    let remote_path = a["directory"].as_str().unwrap();
    fs::write(
        Path::new(remote_path).join("result.json"),
        "remote changed after collection",
    )
    .unwrap();
    let again = remote(&mut app, json!({"operation":"collect","id":id}));
    assert_eq!(
        again["attempts"]
            .as_array()
            .unwrap()
            .iter()
            .find(|v| v["id"] == id)
            .unwrap()["outputs"],
        a["outputs"]
    );
    let download_again = remote(
        &mut app,
        json!({"operation":"artifact","id":id,"digest":a["outputs"].as_array().unwrap().iter().find(|v|v["path"]=="result.json").unwrap()["sha256"]}),
    );
    assert_eq!(download_again["base64"], artifact["base64"]);
    let repeated = post(
        &mut app,
        "/api/remote",
        json!({"operation":"submit","id":id,"digest":digest}),
    );
    assert_eq!(repeated.status().as_u16(), 502);
    let prepared = remote(
        &mut app,
        json!({"operation":"prepare","clusterId":cluster,"samples":1000000,"repetitions":100000}),
    );
    let a = prepared["attempts"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["state"] == "prepared")
        .unwrap();
    let (long_id, long_digest) = (a["id"].clone(), a["digest"].clone());
    remote(
        &mut app,
        json!({"operation":"submit","id":long_id,"digest":long_digest}),
    );
    drop(app); // SSH lifetime and Host lifetime do not own the remote work.
    let mut app = start();
    let observed = remote(&mut app, json!({"operation":"observe","id":long_id}));
    assert_eq!(
        observed["attempts"]
            .as_array()
            .unwrap()
            .iter()
            .find(|a| a["id"] == long_id)
            .unwrap()["state"],
        "running"
    );
    let canceled = remote(&mut app, json!({"operation":"cancel","id":long_id}));
    let a = canceled["attempts"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["id"] == long_id)
        .unwrap();
    assert_eq!(a["state"], "stopped");
    assert_eq!(a["useState"], "Released");
    let canceled_directory = PathBuf::from(a["directory"].as_str().unwrap());
    fs::remove_file(canceled_directory.join("stderr.log")).unwrap();
    let partial = remote(&mut app, json!({"operation":"collect","id":long_id}));
    let partial_attempt = partial["attempts"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["id"] == long_id)
        .unwrap();
    assert!(
        partial_attempt["error"]
            .as_str()
            .unwrap()
            .contains("Partial evidence")
    );
    let original_outputs = partial_attempt["outputs"].as_array().unwrap();
    assert!(!original_outputs.is_empty());
    fs::write(canceled_directory.join("stderr.log"), "recovered log").unwrap();
    let canceled = remote(&mut app, json!({"operation":"collect","id":long_id}));
    let complete = canceled["attempts"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["id"] == long_id)
        .unwrap();
    assert!(complete["error"].is_null());
    for output in original_outputs {
        assert!(complete["outputs"].as_array().unwrap().contains(output));
    }
    fs::write(
        data.join("cancel-evidence.json"),
        serde_json::to_vec_pretty(&canceled).unwrap(),
    )
    .unwrap();
}

/// Development browser acceptance retains the actual Host capability while the
/// browser harness supplies only the standard App iframe/proxy boundary.
#[test]
#[ignore = "manual browser acceptance; stop with test-results/compute/ui-host-stop"]
fn serve_remote_compute_for_browser_acceptance() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .unwrap();
    let captures = root.join("test-results/compute");
    fs::create_dir_all(&captures).unwrap();
    let ready = captures.join("ui-host-access.json");
    let stop = captures.join("ui-host-stop");
    let _ = fs::remove_file(&stop);
    let owner = RemoteCompute::start("compute", &captures.join("host-browser"))
        .unwrap()
        .unwrap();
    fs::write(
        &ready,
        json!({"address":owner.address,"token":owner.token}).to_string(),
    )
    .unwrap();
    println!("Remote Host browser capability ready (private access file)");
    let deadline = Instant::now() + Duration::from_secs(300);
    while !stop.exists() && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(50));
    }
    fs::remove_file(ready).unwrap();
    let _ = fs::remove_file(stop);
    drop(owner);
}
