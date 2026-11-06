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
