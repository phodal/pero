use super::*;
use crate::environments::ContentDigest;
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::PathBuf,
    time::{Duration, Instant},
};

fn id(value: &str) -> Identity {
    value.to_owned().try_into().unwrap()
}
#[cfg(unix)]
fn fixture_transport(root: &std::path::Path) -> SshTransport {
    use std::os::unix::fs::PermissionsExt;
    let ssh = root.join("ssh");
    // Trusted test composition runs only the remote shell locally. The opt-in
    // test runs the same lifecycle through authenticated OpenSSH.
    fs::write(
        &ssh,
        "#!/bin/sh\nfor last do :; done\nexec /bin/sh -c \"$last\"\n",
    )
    .unwrap();
    fs::set_permissions(&ssh, fs::Permissions::from_mode(0o700)).unwrap();
    SshTransport::new(ssh, "fixture".into()).unwrap()
}
fn scenario(transport: SshTransport, root: PathBuf) {
    let probe = transport.probe().unwrap();
    assert!(!probe.hostname.is_empty());
    let fast = root.join(format!("fast-{}", uuid::Uuid::new_v4()));
    let fast_op = id("fast-exit");
    transport.stage(&fast, &[]).unwrap();
    transport
        .start(
            &fast,
            &fast_op,
            std::path::Path::new("/usr/bin/true"),
            &[],
            &[],
        )
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let observed = transport.observe(&fast, &fast_op).unwrap();
        if !observed.running {
            assert_eq!(observed.exit_code, Some(0));
            break;
        }
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(10));
    }
    for cancel in [false, true] {
        let operation = id(&format!("ssh-{}", uuid::Uuid::new_v4()));
        let remote = root.join(operation.as_str());
        transport.stage(&remote, &[StagedFile {
            name:"method.py".into(), executable:false,
            bytes: if cancel { b"import time\nprint('ready',flush=True)\ntime.sleep(300)\n".to_vec() }
                else { b"from pathlib import Path\nprint('observed log',flush=True)\nPath('result.txt').write_text('remote result')\n".to_vec() },
        }]).unwrap();
        let staged = transport.collect(&remote, &["method.py".into()]).unwrap();
        let expected = vec![("method.py".into(), staged[0].sha256.clone())];
        assert!(
            transport
                .start(
                    &remote,
                    &operation,
                    std::path::Path::new("python3"),
                    &["method.py".into()],
                    &[("method.py".into(), ContentDigest::of(&"changed bytes"))]
                )
                .is_err()
        );
        let initial = transport
            .start(
                &remote,
                &operation,
                std::path::Path::new("python3"),
                &["method.py".into()],
                &expected,
            )
            .unwrap();
        assert!(initial.pid > 0);
        assert!(
            transport
                .start(
                    &remote,
                    &operation,
                    std::path::Path::new("python3"),
                    &["method.py".into()],
                    &expected,
                )
                .is_err()
        );
        // A fresh Host-side adapter uses only the original operation/path. It
        // neither owns an attached SSH child nor replays scientific work.
        let reopened = transport.clone();
        let deadline = Instant::now() + Duration::from_secs(15);
        let stopped = loop {
            let current = reopened.observe(&remote, &operation).unwrap();
            if !current.running {
                break current;
            }
            if cancel {
                let logs = reopened.collect(&remote, &["stdout.log".into()]).unwrap();
                if logs[0].bytes.starts_with(b"ready") {
                    break reopened.cancel(&remote, &operation).unwrap();
                }
            }
            assert!(
                Instant::now() < deadline,
                "Original remote process did not stop"
            );
            std::thread::sleep(Duration::from_millis(20));
        };
        assert!(!stopped.running);
        assert!(stopped.started_ms > 0);
        assert!(stopped.ended_ms.unwrap() >= stopped.started_ms);
        let repeated = reopened.observe(&remote, &operation).unwrap();
        assert_eq!(repeated.started_ms, stopped.started_ms);
        assert_eq!(repeated.ended_ms, stopped.ended_ms);
        assert_eq!(stopped.stop_requested, cancel);
        assert_eq!(stopped.exit_code, Some(if cancel { 137 } else { 0 }));
        let files = reopened
            .collect(&remote, &["stdout.log".into(), "stderr.log".into()])
            .unwrap();
        assert!(files[1].bytes.is_empty());
        if !cancel {
            let result = reopened.collect(&remote, &["result.txt".into()]).unwrap();
            assert_eq!(result[0].bytes, b"remote result");
            assert_eq!(
                result[0].sha256,
                ContentDigest::try_from(format!("{:x}", Sha256::digest(&result[0].bytes))).unwrap()
            );
        }
        assert!(reopened.collect(&remote, &["absent".into()]).is_err());
        assert!(reopened.observe(&remote, &id("another-operation")).is_err());
    }
}

#[test]
#[cfg(unix)]
fn ssh_operations_keep_identity_outputs_and_confirmed_stop_through_the_transport_seam() {
    let root = std::env::temp_dir().join(format!("pero-ssh-seam-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&root).unwrap();
    scenario(fixture_transport(&root), root.clone());
    fs::remove_dir_all(root).unwrap();
}

#[test]
#[ignore = "requires an explicitly configured OpenSSH loopback or authorized site"]
fn ssh_live_method_logs_collection_and_cancellation() {
    let ssh = std::env::var("PERO_TEST_SSH").unwrap_or_else(|_| "/usr/bin/ssh".into());
    let host = std::env::var("PERO_TEST_SSH_HOST").expect("explicit SSH host/alias");
    let directory =
        std::env::var("PERO_TEST_SSH_DIRECTORY").expect("explicit disposable remote directory");
    scenario(
        SshTransport::new(ssh.into(), host).unwrap(),
        directory.into(),
    );
}

#[test]
#[cfg(unix)]
fn slurm_over_ssh_preserves_queue_errors_original_identity_and_cancel_observation() {
    use crate::{
        compute::{SlurmInvocation, SlurmSite},
        environments::{BatchConstraints, BatchState},
    };
    use std::os::unix::fs::PermissionsExt;
    let root = std::env::temp_dir().join(format!("pero-slurm-seam-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&root).unwrap();
    let transport = fixture_transport(&root);
    let binary = r#"#!/usr/bin/python3
import json, sys
from pathlib import Path
root = Path(__file__).parent
kind = Path(__file__).name
meta = {'slurm': {'cluster': 'fixture-cluster'}}
state = root / 'state.json'
if kind == 'sbatch':
    assert '--no-requeue' in sys.argv
    account = sys.argv[sys.argv.index('--account')+1]
    assert account == 'science-account'
    marker = sys.argv[sys.argv.index('--comment')+1]
    job = {'job_id':731,'cluster':'fixture-cluster','comment':marker,
        'submit_time': {'set':True,'infinite':False,'number':100},
        'start_time': {'set':False,'infinite':False,'number':0},
        'end_time': {'set':False,'infinite':False,'number':0},
        'job_state':['PENDING'],'nodes':''}
    state.write_text(json.dumps(job))
    print('731;fixture-cluster')
elif kind == 'scancel':
    job = json.loads(state.read_text())
    job['job_state'] = ['CANCELLED']
    job['end_time'] = {'set':True,'infinite':False,'number':200}
    state.write_text(json.dumps(job))
elif 'ping' in sys.argv:
    print(json.dumps({'meta':meta}))
else:
    if (root/'unavailable').exists(): sys.exit(1)
    jobs = [] if (root/'missing').exists() else [json.loads(state.read_text())]
    print(json.dumps({'meta':meta,'jobs':jobs}))
"#;
    for name in ["scontrol", "sbatch", "scancel"] {
        let path = root.join(name);
        fs::write(&path, binary).unwrap();
        fs::set_permissions(path, fs::Permissions::from_mode(0o700)).unwrap();
    }
    let site = SlurmSite::probe_ssh(transport, root.clone()).unwrap();
    assert_eq!(site.cluster(), &id("fixture-cluster"));
    let record = root.join("submission.json");
    let executions = root.join("executions");
    let submit = || {
        site.submit_staged(
            SlurmInvocation {
                operation: id("attempt"),
                constraints: BatchConstraints::new(id("short"), 1, 32, 60).unwrap(),
                payload: ContentDigest::of(&"fixed payload"),
                entry: &root.join("method.sh"),
                directory: &root,
                account: Some(&id("science-account")),
            },
            &record,
            &executions,
        )
    };
    let submission = submit().unwrap();
    assert!(submit().is_err(), "exclusive intent blocks repeated sbatch");
    let queued = site.observe(&executions, &submission).unwrap();
    assert_eq!(queued.states, vec![BatchState::Pending]);
    assert!(!queued.stopped());
    fs::write(root.join("unavailable"), "").unwrap();
    assert!(site.observe(&executions, &submission).is_err());
    fs::remove_file(root.join("unavailable")).unwrap();
    fs::write(root.join("missing"), "").unwrap();
    assert!(
        site.observe(&executions, &submission).is_err(),
        "missing queue row is unknown"
    );
    fs::remove_file(root.join("missing")).unwrap();
    let cancelled = site.cancel(&executions, &submission).unwrap();
    assert!(cancelled.stopped());
    assert_eq!(cancelled.states, vec![BatchState::Cancelled]);
    let mut reused = submission.clone();
    reused.submit_time = 101;
    assert!(site.observe(&executions, &reused).is_err());
    assert_eq!(
        fs::read_dir(&executions).unwrap().count(),
        1,
        "one receipt updated"
    );
    fs::remove_dir_all(root).unwrap();
}
