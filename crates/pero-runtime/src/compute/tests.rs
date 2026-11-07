use super::*;
use crate::environments::*;
use std::{
    fs,
    time::{Duration, Instant},
};

fn id(value: &str) -> Identity {
    value.to_owned().try_into().unwrap()
}
fn directory() -> PathBuf {
    let root = std::env::var_os("PERO_TEST_COMPUTE_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);
    fs::create_dir_all(&root).unwrap();
    let path = root.join(format!("pero-compute-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&path).unwrap();
    path.canonicalize().unwrap()
}
fn completed(handle: &mut ProcessHandle) {
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        if let Some(status) = handle.process.try_wait().unwrap() {
            assert!(status.success(), "{status}");
            return;
        }
        assert!(Instant::now() < deadline, "external method did not finish");
        std::thread::sleep(Duration::from_millis(20));
    }
}
#[test]
#[cfg(unix)]
fn local_method_observes_the_selected_binary_and_keeps_attempt_outputs() {
    let dir = directory();
    let mut owner = LocalOwner::adopt(
        "/bin/sh".into(),
        ResourceRef {
            owner: id("host"),
            kind: id("process-space"),
            scope: id("local"),
            id: id("workspace"),
        },
        id("test-boot"),
    )
    .unwrap();
    let invocation = MethodInvocation {
        program: owner.program().to_owned(),
        arguments: vec!["-c".into(), "printf actual > result.txt".into()],
        directory: dir.clone(),
    };
    let observation = owner.observe(20).unwrap();
    assert_eq!(observation.readiness, Readiness::Ready);
    let mut execution = owner.launch(&id("attempt"), &invocation).unwrap();
    completed(&mut execution);
    execution.stop().unwrap();
    assert_eq!(
        fs::read_to_string(dir.join("result.txt")).unwrap(),
        "actual"
    );
    assert!(owner.launch(&id("attempt"), &invocation).is_err());
    drop(execution);
    fs::remove_dir_all(dir).unwrap();
}
#[test]
#[ignore = "requires an explicitly selected live Docker context and image"]
fn docker_method_uses_actual_container_identity_and_cancellation_removes_it() {
    let context = std::env::var("PERO_TEST_DOCKER_CONTEXT").expect("explicit Docker context");
    let image = std::env::var("PERO_TEST_DOCKER_IMAGE").expect("explicit prepared image");
    let docker =
        PathBuf::from(std::env::var("PERO_TEST_DOCKER").unwrap_or_else(|_| "docker".into()));
    let dir = directory();
    for cancel in [false, true] {
        let owner = DockerOwner::resolve(
            docker.clone(),
            context.clone(),
            &image,
            &std::env::var("PERO_TEST_DOCKER_PLATFORM").expect("explicit platform"),
        )
        .unwrap();
        let resource_id = id(&format!("test-{}", uuid::Uuid::new_v4()));
        let mut resource = owner.prepare(&resource_id, &dir).unwrap();
        let observed = resource.observe(10).unwrap();
        assert_eq!(observed.resource.kind, id("container"));
        assert_eq!(observed.readiness, Readiness::Ready);
        let container = resource.container_id().as_str().to_owned();
        let script = if cancel {
            "printf ready > ready; exec sleep 300"
        } else {
            "printf actual > result.txt"
        };
        let invocation = MethodInvocation {
            program: "/bin/sh".into(),
            arguments: vec!["-c".into(), script.into()],
            directory: dir.clone(),
        };
        let mut execution = resource.launch(&id("test-use"), &invocation).unwrap();
        if cancel {
            let deadline = Instant::now() + Duration::from_secs(20);
            while !dir.join("ready").exists() {
                assert!(
                    execution.process.try_wait().unwrap().is_none(),
                    "container method stopped before readiness"
                );
                assert!(
                    Instant::now() < deadline,
                    "container method did not report readiness"
                );
                std::thread::sleep(Duration::from_millis(20));
            }
        } else {
            completed(&mut execution);
            assert_eq!(
                fs::read_to_string(dir.join("result.txt")).unwrap(),
                "actual"
            );
        }
        assert!(resource.launch(&id("test-use"), &invocation).is_err());
        execution.stop().unwrap();
        let output = Command::new(&docker)
            .args([
                "--context",
                &context,
                "ps",
                "--all",
                "--quiet",
                "--no-trunc",
                "--filter",
                &format!("id={container}"),
            ])
            .output()
            .unwrap();
        assert!(output.status.success());
        assert!(
            output.stdout.is_empty(),
            "original container remains after stop"
        );
    }
    fs::remove_dir_all(dir).unwrap();
}

#[test]
#[ignore = "requires an explicitly selected Docker context and validation image with Python"]
fn compose_preserves_member_identity_and_retains_service_data() {
    let context = std::env::var("PERO_TEST_DOCKER_CONTEXT").unwrap();
    let image = std::env::var("PERO_TEST_DOCKER_IMAGE").unwrap();
    let platform = std::env::var("PERO_TEST_DOCKER_PLATFORM").unwrap();
    let dir = directory();
    let recipe = dir.join("recipe.json");
    let selected =
        DockerOwner::resolve("docker".into(), context.clone(), &image, &platform).unwrap();
    let pinned = format!("sha256:{}", selected.image().reference.as_str());
    let config = serde_json::json!({
        "services": {
            "data": {"image":image, "platform":platform,
                "command":["python3","-m","http.server","8000","--directory","/data"],
                "volumes":["results:/data"],
                "healthcheck":{"test":["CMD","python3","-c","import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000')"], "interval":"1s", "timeout":"2s", "retries":10}},
            "client": {"image":image, "platform":platform,
                "command":["sleep","infinity"],
                "depends_on":{"data":{"condition":"service_healthy"}},
                "healthcheck":{"test":["CMD","python3","-c","import urllib.request; urllib.request.urlopen('http://data:8000')"], "interval":"1s", "timeout":"2s", "retries":10}}
        },
        "networks":{"default":{"internal":true}}, "volumes":{"results":{}}
    });
    fs::write(&recipe, serde_json::to_vec_pretty(&config).unwrap()).unwrap();
    let operation = dir.join("operation");
    let deployment =
        ComposeDeployment::prepare("docker".into(), context.clone(), &recipe, &operation).unwrap();
    assert_eq!(deployment.evidence().members.len(), 2);
    assert!(
        deployment
            .evidence()
            .members
            .iter()
            .all(|m| m.running && m.health.as_deref() == Some("healthy"))
    );
    let data = deployment
        .evidence()
        .members
        .iter()
        .find(|m| m.service.as_str() == "data")
        .unwrap();
    let result = command_output(Command::new("docker").args([
        "--context",
        &context,
        "exec",
        data.container.as_str(),
        "python3",
        "-c",
        "from pathlib import Path; Path('/data/result').write_text('service-result')",
    ]))
    .unwrap();
    assert!(result.status.success());
    let client = deployment
        .evidence()
        .members
        .iter()
        .find(|m| m.service.as_str() == "client")
        .unwrap();
    let result = command_output(Command::new("docker").args(["--context", &context, "exec", client.container.as_str(),
        "python3", "-c", "import urllib.request; print(urllib.request.urlopen('http://data:8000/result').read().decode())"])).unwrap();
    assert!(result.status.success());
    assert_eq!(
        String::from_utf8(result.stdout).unwrap().trim(),
        "service-result"
    );
    let mut reopened =
        ComposeDeployment::reopen("docker".into(), context.clone(), operation).unwrap();
    reopened.refresh().unwrap();
    let volume = reopened.evidence().retained_volumes[0].clone();
    reopened.dispose().unwrap();
    reopened.dispose().unwrap(); // Retry after all exact resources were removed.
    let result = command_output(Command::new("docker").args([
        "--context",
        &context,
        "run",
        "--rm",
        "--pull=never",
        "--platform",
        &platform,
        "--network=none",
        "--mount",
        &format!("type=volume,src={volume},dst=/data,readonly"),
        &pinned,
        "cat",
        "/data/result",
    ]))
    .unwrap();
    assert!(result.status.success());
    assert_eq!(String::from_utf8(result.stdout).unwrap(), "service-result");
    // The test explicitly deletes its own fixture data after proving retention.
    assert!(
        command_output(Command::new("docker").args([
            "--context",
            &context,
            "volume",
            "rm",
            &volume
        ]))
        .unwrap()
        .status
        .success()
    );
    fs::remove_dir_all(dir).unwrap();
}

#[test]
#[ignore = "requires an explicit live Slurm site and shared attempt directory"]
#[cfg(unix)]
fn slurm_tracks_submission_allocation_and_confirmed_cancellation() {
    use std::os::unix::fs::PermissionsExt;
    let site = SlurmSite::connect(
        std::env::var("PERO_TEST_SLURM_BIN").unwrap().into(),
        id(&std::env::var("PERO_TEST_SLURM_CLUSTER").unwrap()),
    )
    .unwrap();
    for cancel in [false, true] {
        let dir = directory();
        let payload = dir.join("method.sh");
        fs::write(
            &payload,
            if cancel {
                "#!/bin/sh\nprintf ready > ready\nexec sleep 300\n"
            } else {
                "#!/bin/sh\nprintf batch-result > result\n"
            },
        )
        .unwrap();
        fs::set_permissions(&payload, fs::Permissions::from_mode(0o700)).unwrap();
        let operation = id(dir.file_name().unwrap().to_str().unwrap());
        let constraints = BatchConstraints::new(id("validation"), 1, 32, 60).unwrap();
        let record = dir.join("submission.json");
        let submission = site
            .submit(
                operation.clone(),
                constraints.clone(),
                &payload,
                &dir,
                &record,
            )
            .unwrap();
        assert!(
            site.submit(operation, constraints, &payload, &dir, &record)
                .is_err(),
            "no repeated submission"
        );
        let deadline = Instant::now() + Duration::from_secs(60);
        let mut requested_stop = false;
        let terminal = loop {
            let observation = site.observe(&submission).unwrap();
            if cancel && !requested_stop && dir.join("ready").exists() {
                assert!(observation.start_time.is_some());
                assert!(!observation.nodes.is_empty());
                site.cancel(&submission).unwrap();
                requested_stop = true;
            }
            if observation.stopped() {
                break observation;
            }
            assert!(
                Instant::now() < deadline,
                "original Slurm job has not stopped"
            );
            std::thread::sleep(Duration::from_millis(100));
        };
        assert!(terminal.states.iter().any(|s| s
            == if cancel {
                &BatchState::Cancelled
            } else {
                &BatchState::Completed
            }));
        let allocated = fs::read_to_string(dir.join("allocation.txt")).unwrap();
        assert!(allocated.contains(&format!("job={}", submission.job_id)));
        assert!(allocated.contains(submission.payload.as_str()));
        if !cancel {
            assert_eq!(
                fs::read_to_string(dir.join("result")).unwrap(),
                "batch-result"
            );
        }
        fs::write(
            dir.join("terminal.json"),
            serde_json::to_vec_pretty(&terminal).unwrap(),
        )
        .unwrap();
        eprintln!("Slurm evidence: {}", dir.display());
    }
}
