use super::*;
use std::collections::BTreeMap;

fn id(value: &str) -> Identity {
    value.to_owned().try_into().unwrap()
}
fn version(value: &str) -> Version {
    value.to_owned().try_into().unwrap()
}
fn digest(value: &str) -> ContentDigest {
    ContentDigest::of(&value)
}
fn profile() -> SoftwareProfile {
    SoftwareProfile::observed(ProfileObservation {
        name: id("control-lab"),
        python: PythonVersion {
            major: 3,
            minor: 12,
            patch: 11,
        },
        system: id("Linux"),
        machine: id("x86_64"),
        interpreter_sha256: Some(digest("python")),
        packages: BTreeMap::from([
            (id("control"), Some(version("0.10.2"))),
            (id("numpy"), None),
        ]),
        native: BTreeMap::from([(
            id("ngspice"),
            NativeProgram {
                version: Some(version("ngspice-44")),
                sha256: Some(digest("ngspice")),
                status: NativeStatus::Observed,
            },
        )]),
    })
}
fn binding() -> EnvironmentBinding {
    EnvironmentBinding {
        owner: id("host"),
        incarnation: id("backend-1"),
        observed_at_ms: 100,
        profile: profile(),
    }
}
fn requirements() -> EnvironmentRequirements {
    EnvironmentRequirements::new(
        id("control-lab.python-control"),
        vec![Requirement::Package {
            name: id("control"),
            version: Some(version("0.10.2")),
        }],
        vec![],
    )
    .unwrap()
}
fn snapshot() -> EnvironmentSnapshot {
    EnvironmentSnapshot::capture(
        EnvironmentTemplate::new(id("control-env"), version("1"), requirements()),
        binding(),
        110,
        20,
    )
    .unwrap()
}

#[test]
fn matching_conditions() {
    let cases = [
        (
            "python minor",
            Requirement::Python {
                major: 3,
                minor: 12,
                patch: None,
            },
            true,
        ),
        (
            "python exact mismatch",
            Requirement::Python {
                major: 3,
                minor: 12,
                patch: Some(10),
            },
            false,
        ),
        (
            "package installed",
            Requirement::Package {
                name: id("control"),
                version: None,
            },
            true,
        ),
        (
            "package version",
            Requirement::Package {
                name: id("control"),
                version: Some(version("0.9")),
            },
            false,
        ),
        (
            "metadata missing",
            Requirement::Package {
                name: id("numpy"),
                version: None,
            },
            false,
        ),
        (
            "unobserved package",
            Requirement::Package {
                name: id("torch"),
                version: None,
            },
            false,
        ),
        (
            "native observed",
            Requirement::Native {
                name: id("ngspice"),
                sha256: None,
            },
            true,
        ),
        (
            "native digest",
            Requirement::Native {
                name: id("ngspice"),
                sha256: Some(digest("replacement")),
            },
            false,
        ),
        (
            "exact profile",
            Requirement::Profile {
                digest: profile().id().clone(),
            },
            true,
        ),
        (
            "platform",
            Requirement::Platform {
                system: id("Darwin"),
                machine: id("arm64"),
            },
            false,
        ),
    ];
    for (label, rule, accepted) in cases {
        let requirements =
            EnvironmentRequirements::new(id("method"), vec![rule.clone()], vec![]).unwrap();
        let result = match_profile(&requirements, &binding(), 110, 20);
        if accepted {
            assert!(result.is_ok(), "{label}: {result:?}");
        } else {
            assert_eq!(
                result,
                Err(EnvironmentError::RequirementUnsatisfied(vec![rule])),
                "{label}"
            );
        }
    }
    let preferred = EnvironmentRequirements::new(
        id("method"),
        requirements().required().to_vec(),
        vec![Requirement::Package {
            name: id("numpy"),
            version: None,
        }],
    )
    .unwrap();
    assert_eq!(
        match_profile(&preferred, &binding(), 110, 20)
            .unwrap()
            .preferred_satisfied,
        0
    );
    for (now, age, accepted) in [
        (99, 20, false),
        (120, 20, true),
        (121, 20, false),
        (110, 0, false),
    ] {
        assert_eq!(
            match_profile(&requirements(), &binding(), now, age).is_ok(),
            accepted
        );
    }
    for status in [
        NativeStatus::Missing,
        NativeStatus::Unsupported,
        NativeStatus::ProbeFailed,
    ] {
        let mut observed = profile().observation().clone();
        observed.native.get_mut(&id("ngspice")).unwrap().status = status;
        let mut b = binding();
        b.profile = SoftwareProfile::observed(observed);
        let req = EnvironmentRequirements::new(
            id("circuit"),
            vec![Requirement::Native {
                name: id("ngspice"),
                sha256: None,
            }],
            vec![],
        )
        .unwrap();
        assert!(match_profile(&req, &b, 110, 20).is_err());
    }
}

#[test]
fn binding_identity_and_historical_observations() {
    let historical = snapshot();
    let original_digest = historical.digest();
    let instance = EnvironmentInstance::new(id("local"), historical.clone());
    let mut newer = binding();
    newer.observed_at_ms = 115;
    let refreshed = instance.refresh(newer, 120, 20).unwrap();
    assert_ne!(refreshed.snapshot().digest(), original_digest);
    assert_eq!(historical.digest(), original_digest);
    for change in ["owner", "incarnation", "software"] {
        let mut changed = binding();
        match change {
            "owner" => changed.owner = id("different-host"),
            "incarnation" => changed.incarnation = id("backend-2"),
            _ => {
                let mut obs = changed.profile.observation().clone();
                obs.python.patch = 12;
                changed.profile = SoftwareProfile::observed(obs);
            }
        }
        assert_eq!(
            instance.refresh(changed, 110, 20),
            Err(EnvironmentError::IdentityChanged)
        );
    }
    // Canonical identity does not depend on JSON member order. Also pinned by Python's probe test.
    assert_eq!(
        ContentDigest::of(&serde_json::json!({"b":2,"a":1})),
        "43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777"
            .to_owned()
            .try_into()
            .unwrap()
    );
}

#[test]
fn use_lifecycle() {
    let request = UseRequest {
        id: id("use-1"),
        consumer: id("attempt-1"),
        snapshot: snapshot(),
    };
    let receipt = OwnerReceipt {
        use_id: request.id.clone(),
        snapshot: request.snapshot.digest(),
        receipt: digest("grant"),
    };
    let released = OwnerReceipt {
        receipt: digest("release"),
        ..receipt.clone()
    };
    let release = UseCommand::Released {
        stopped: OwnerReceipt {
            receipt: digest("stopped"),
            ..receipt.clone()
        },
        released: released.clone(),
    };
    let cases = vec![
        (
            "normal",
            vec![
                UseCommand::Acquired(receipt.clone()),
                UseCommand::End,
                release.clone(),
            ],
            UseState::Released,
            vec![UseEffect::Acquire, UseEffect::Release],
        ),
        (
            "cancel before grant",
            vec![
                UseCommand::End,
                UseCommand::Acquired(receipt.clone()),
                release.clone(),
            ],
            UseState::Released,
            vec![UseEffect::Acquire, UseEffect::Release],
        ),
        (
            "unknown acquisition cancelled",
            vec![
                UseCommand::Unknown,
                UseCommand::End,
                UseCommand::Acquired(receipt.clone()),
            ],
            UseState::Releasing,
            vec![UseEffect::Acquire, UseEffect::Release],
        ),
        (
            "repeat grant and end",
            vec![
                UseCommand::Acquired(receipt.clone()),
                UseCommand::Acquired(receipt.clone()),
                UseCommand::End,
                UseCommand::End,
                UseCommand::Acquired(receipt.clone()),
            ],
            UseState::Releasing,
            vec![UseEffect::Acquire, UseEffect::Release],
        ),
        (
            "unknown release",
            vec![
                UseCommand::Acquired(receipt.clone()),
                UseCommand::End,
                UseCommand::Unknown,
            ],
            UseState::UnknownRelease,
            vec![UseEffect::Acquire, UseEffect::Release],
        ),
        (
            "reconciled release",
            vec![
                UseCommand::Acquired(receipt.clone()),
                UseCommand::End,
                UseCommand::Unknown,
                release.clone(),
                release,
            ],
            UseState::Released,
            vec![UseEffect::Acquire, UseEffect::Release],
        ),
        (
            "confirmed not started",
            vec![UseCommand::End, UseCommand::Refused(released)],
            UseState::Released,
            vec![UseEffect::Acquire],
        ),
        (
            "unknown remains pending",
            vec![UseCommand::Unknown, UseCommand::End, UseCommand::Unknown],
            UseState::UnknownAcquire,
            vec![UseEffect::Acquire],
        ),
    ];
    for (label, commands, expected, effects) in cases {
        let (mut state, mut actual) = apply_use(None, UseCommand::Begin(request.clone())).unwrap();
        for command in commands {
            let (next, effect) = apply_use(Some(&state), command).unwrap();
            state = next;
            actual.extend(effect);
        }
        assert_eq!(state.state(), expected, "{label}");
        assert_eq!(actual, effects, "{label}");
        assert_eq!(state.request(), &request);
        assert!(
            apply_use(
                Some(&state),
                UseCommand::Begin(UseRequest {
                    consumer: id("another-attempt"),
                    ..request.clone()
                })
            )
            .is_err()
        );
        assert_eq!(
            apply_use(Some(&state), UseCommand::Begin(request.clone()))
                .unwrap()
                .1,
            vec![]
        );
    }
    let (state, _) = apply_use(None, UseCommand::Begin(request)).unwrap();
    assert!(
        apply_use(
            Some(&state),
            UseCommand::Acquired(OwnerReceipt {
                use_id: id("other-use"),
                ..receipt.clone()
            })
        )
        .is_err()
    );
    assert!(
        apply_use(
            Some(&state),
            UseCommand::Acquired(OwnerReceipt {
                snapshot: digest("other-snapshot"),
                ..receipt
            })
        )
        .is_err()
    );
    let refusal = OwnerReceipt {
        use_id: state.request().id.clone(),
        snapshot: state.request().snapshot.digest(),
        receipt: digest("not-started"),
    };
    let (refused, _) = apply_use(Some(&state), UseCommand::Refused(refusal.clone())).unwrap();
    assert!(
        apply_use(Some(&refused), UseCommand::Refused(refusal))
            .unwrap()
            .1
            .is_empty()
    );
}
