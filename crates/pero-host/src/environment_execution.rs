//! Private handoff for an already admitted scientific attempt. No new Run,
//! scheduler, public command API, scientific budget, or acceptance decision.
use crate::environment_uses::EnvironmentUses;
use pero_runtime::{
    compute::{MethodInvocation, ProcessHandle, ProcessOwner},
    environments::*,
};
use std::{
    collections::{BTreeMap, BTreeSet},
    process::ExitStatus,
};

pub(crate) struct ExecutionAdmission {
    pub use_id: Identity,
    pub consumer: Identity,
    pub requirements: EnvironmentRequirements,
}
pub(crate) struct BoundProcess {
    state: EnvironmentUse,
    process: ProcessHandle,
}
impl BoundProcess {
    /// The original method owner must freeze and approve input before calling.
    /// A persisted Begin is never treated as permission to repeat dispatch.
    pub(crate) fn start(
        store: &mut EnvironmentUses,
        owner: &mut impl ProcessOwner,
        admission: ExecutionAdmission,
        invocation: &MethodInvocation,
        now_ms: u64,
    ) -> Result<Self, String> {
        let binding = owner.observe(now_ms)?;
        let slot: Identity = "compute".to_owned().try_into().unwrap();
        let capabilities = BTreeSet::from([Capability::Process]);
        let method = admission.requirements.method().clone();
        let template = ResourceTemplate::new(
            method.clone(),
            "1".to_owned().try_into().unwrap(),
            BTreeMap::from([(
                slot.clone(),
                ResourceSlot {
                    software: admission.requirements,
                    capabilities: capabilities.clone(),
                },
            )]),
            BTreeSet::new(),
        )
        .map_err(|e| e.to_string())?;
        let snapshot = CompositeSnapshot::capture(
            template,
            UseSelection {
                method,
                slots: BTreeMap::from([(slot.clone(), capabilities)]),
            },
            &BTreeMap::from([(slot.clone(), binding)]),
            now_ms,
            1,
        )
        .map_err(|e| e.to_string())?;
        let request = UseRequest {
            id: admission.use_id.clone(),
            consumer: admission.consumer,
            snapshot: EnvironmentSnapshot::Composite(snapshot),
        };
        let (state, effects) = store.apply(&admission.use_id, UseCommand::Begin(request))?;
        let [UseEffect::AcquireTarget(target)] = effects.as_slice() else {
            return Err(
                "Use already exists; reconcile the original execution instead of dispatching again"
                    .into(),
            );
        };
        let actual = match owner.observe(now_ms) {
            Ok(actual) => actual,
            Err(error) => {
                store.apply(
                    &admission.use_id,
                    UseCommand::Refused(receipt(&state, target.digest(), "observation-failed")),
                )?;
                return Err(error);
            }
        };
        let EnvironmentSnapshot::Composite(snapshot) = &state.request().snapshot else {
            unreachable!("composite admission")
        };
        if snapshot
            .refresh(&BTreeMap::from([(slot, actual)]), now_ms, 1)
            .is_err()
        {
            store.apply(
                &admission.use_id,
                UseCommand::Refused(receipt(&state, target.digest(), "resource-changed")),
            )?;
            return Err("Resource changed during admission; execution did not start".into());
        }
        let target_id = target.digest();
        let (state, _) = store.apply(
            &admission.use_id,
            UseCommand::Acquired(receipt(&state, target_id.clone(), "acquired")),
        )?;
        match owner.launch(&admission.use_id, invocation) {
            Ok(process) => Ok(Self { state, process }),
            Err(error) => {
                // No second launch. If an external adapter's dispatch outcome
                // is unknown, retain the original resource for reconciliation.
                store.apply(&admission.use_id, UseCommand::End)?;
                store.apply(
                    &admission.use_id,
                    UseCommand::TargetUnknown { target: target_id },
                )?;
                Err(error)
            }
        }
    }
    pub(crate) fn poll(&mut self) -> Result<Option<ExitStatus>, String> {
        self.process.process.try_wait().map_err(|e| e.to_string())
    }
    /// Invoked for normal completion or cancellation by the original attempt
    /// owner. The exit status stays a separate scientific execution fact.
    pub(crate) fn stop(&mut self, store: &mut EnvironmentUses) -> Result<EnvironmentUse, String> {
        let id = &self.state.request().id;
        let (state, effects) = store.apply(id, UseCommand::End)?;
        if state.state() == UseState::Released {
            self.state = state.clone();
            return Ok(state);
        }
        let [UseEffect::ReleaseTarget(target)] = effects.as_slice() else {
            return Err("Use release needs original-owner reconciliation".into());
        };
        let target = target.digest();
        if let Err(error) = self.process.stop() {
            store.apply(id, UseCommand::TargetUnknown { target })?;
            return Err(error);
        }
        let (released, _) = store.apply(
            id,
            UseCommand::Released {
                stopped: receipt(&state, target.clone(), "stopped"),
                released: receipt(&state, target, "released"),
            },
        )?;
        self.state = released.clone();
        Ok(released)
    }
}
fn receipt(state: &EnvironmentUse, target: ContentDigest, operation: &str) -> OwnerReceipt {
    let request = state.request();
    OwnerReceipt {
        use_id: request.id.clone(),
        snapshot: request.snapshot.digest(),
        target: Some(target.clone()),
        receipt: ContentDigest::of(&(&request.id, &target, operation)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pero_runtime::compute::LocalOwner;
    use std::{
        fs,
        time::{Duration, Instant},
    };
    struct ObservationFailure {
        inner: LocalOwner,
        calls: std::cell::Cell<u32>,
    }
    impl ProcessOwner for ObservationFailure {
        fn observe(&self, now_ms: u64) -> Result<ResourceBinding, String> {
            let calls = self.calls.get();
            self.calls.set(calls + 1);
            if calls > 0 {
                Err("resource observation unavailable".into())
            } else {
                self.inner.observe(now_ms)
            }
        }
        fn launch(&mut self, _: &Identity, _: &MethodInvocation) -> Result<ProcessHandle, String> {
            panic!("An unobserved resource must not launch");
        }
    }
    #[test]
    #[cfg(unix)]
    fn actual_process_is_bound_to_durable_use_and_release_not_relaunch() {
        let root = std::env::temp_dir().join(format!("pero-bound-process-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let mut store = EnvironmentUses::open(&root.join("uses.sqlite")).unwrap();
        let id = |s: &str| Identity::try_from(s.to_owned()).unwrap();
        let mut owner = LocalOwner::adopt(
            "/bin/sh".into(),
            ResourceRef {
                owner: id("host"),
                kind: id("workspace"),
                scope: id("local"),
                id: id("resource"),
            },
            id("boot"),
        )
        .unwrap();
        let profile = owner.observe(10).unwrap().profile;
        let admission = || ExecutionAdmission {
            use_id: id("use"),
            consumer: id("original-attempt"),
            requirements: EnvironmentRequirements::new(
                id("method"),
                vec![Requirement::Profile {
                    digest: profile.id().clone(),
                }],
                vec![],
            )
            .unwrap(),
        };
        let invocation = MethodInvocation {
            program: owner.program().to_owned(),
            arguments: vec!["-c".into(), "printf bound > result".into()],
            directory: root.clone(),
        };
        let mut process =
            BoundProcess::start(&mut store, &mut owner, admission(), &invocation, 10).unwrap();
        assert_eq!(
            store.get(&id("use")).unwrap().unwrap().state().state(),
            UseState::Active
        );
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            if let Some(exit) = process.poll().unwrap() {
                assert!(exit.success());
                break;
            }
            assert!(Instant::now() < deadline);
            std::thread::sleep(Duration::from_millis(10));
        }
        assert_eq!(fs::read_to_string(root.join("result")).unwrap(), "bound");
        assert_eq!(
            process.stop(&mut store).unwrap().state(),
            UseState::Released
        );
        assert_eq!(
            process.stop(&mut store).unwrap().state(),
            UseState::Released
        );
        assert!(BoundProcess::start(&mut store, &mut owner, admission(), &invocation, 10).is_err());
        let mut unavailable = ObservationFailure {
            inner: owner,
            calls: std::cell::Cell::new(0),
        };
        let failed = ExecutionAdmission {
            use_id: id("unavailable-use"),
            ..admission()
        };
        assert!(
            BoundProcess::start(&mut store, &mut unavailable, failed, &invocation, 10).is_err()
        );
        assert_eq!(
            store
                .get(&id("unavailable-use"))
                .unwrap()
                .unwrap()
                .state()
                .state(),
            UseState::Released
        );
        drop(process);
        drop(store);
        assert_eq!(
            EnvironmentUses::open(&root.join("uses.sqlite"))
                .unwrap()
                .get(&id("use"))
                .unwrap()
                .unwrap()
                .state()
                .state(),
            UseState::Released
        );
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    #[ignore = "requires the explicitly prepared scientific Docker image"]
    fn actual_container_solver_keeps_scientific_output_and_durable_use() {
        use pero_runtime::compute::DockerOwner;
        let root = std::path::PathBuf::from(std::env::var("PERO_TEST_COMPUTE_ROOT").unwrap())
            .join(format!("ngspice-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("divider.cir"), "Voltage divider\nV1 input 0 DC 10\nR1 input output 1000\nR2 output 0 1000\n.control\nop\nprint v(output)\nquit\n.endc\n.end\n").unwrap();
        let id = |s: &str| Identity::try_from(s.to_owned()).unwrap();
        let owner = DockerOwner::resolve(
            "docker".into(),
            std::env::var("PERO_TEST_DOCKER_CONTEXT").unwrap(),
            &std::env::var("PERO_TEST_DOCKER_IMAGE").unwrap(),
            &std::env::var("PERO_TEST_DOCKER_PLATFORM").unwrap(),
        )
        .unwrap();
        let mut resource = owner
            .prepare(&id(root.file_name().unwrap().to_str().unwrap()), &root)
            .unwrap();
        let profile = resource.observe(100).unwrap().profile;
        let mut store = EnvironmentUses::open(&root.join("uses.sqlite")).unwrap();
        let mut process = BoundProcess::start(
            &mut store,
            &mut resource,
            ExecutionAdmission {
                use_id: id("solver-use"),
                consumer: id("divider-attempt"),
                requirements: EnvironmentRequirements::new(
                    id("ngspice-divider"),
                    vec![Requirement::Profile {
                        digest: profile.id().clone(),
                    }],
                    vec![],
                )
                .unwrap(),
            },
            &MethodInvocation {
                program: "/usr/bin/ngspice".into(),
                arguments: vec!["-b".into(), "divider.cir".into()],
                directory: root.clone(),
            },
            100,
        )
        .unwrap();
        let deadline = Instant::now() + Duration::from_secs(30);
        loop {
            if let Some(status) = process.poll().unwrap() {
                assert!(status.success());
                break;
            }
            assert!(Instant::now() < deadline);
            std::thread::sleep(Duration::from_millis(20));
        }
        // Independent numerical check of the method output; exit zero alone is insufficient.
        let output = fs::read_to_string(root.join("stdout.log")).unwrap();
        let value: f64 = output
            .lines()
            .find_map(|line| line.strip_prefix("v(output) = "))
            .expect("solver voltage result")
            .trim()
            .parse()
            .unwrap();
        assert!((value - 5.0).abs() < 1e-6, "voltage divider: {value}");
        assert_eq!(
            process.stop(&mut store).unwrap().state(),
            UseState::Released
        );
        let record = store.get(&id("solver-use")).unwrap().unwrap();
        fs::write(
            root.join("use.json"),
            serde_json::to_vec_pretty(&record).unwrap(),
        )
        .unwrap();
        drop(store);
        assert_eq!(
            EnvironmentUses::open(&root.join("uses.sqlite"))
                .unwrap()
                .get(&id("solver-use"))
                .unwrap()
                .unwrap()
                .state()
                .state(),
            UseState::Released
        );
        eprintln!("Scientific evidence: {}", root.display());
    }
}
