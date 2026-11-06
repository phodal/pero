use super::*;
use crate::environments::composition::tests::{fixture, hash, id};

fn request() -> UseRequest {
    let (template, selection, observations) = fixture();
    UseRequest {
        id: id("use-1"),
        consumer: id("attempt-1"),
        snapshot: EnvironmentSnapshot::Composite(
            CompositeSnapshot::capture(template, selection, &observations, 110, 20).unwrap(),
        ),
    }
}
fn receipt(request: &UseRequest, target: &ContentDigest, fact: &str) -> OwnerReceipt {
    OwnerReceipt {
        use_id: request.id.clone(),
        snapshot: request.snapshot.digest(),
        target: Some(target.clone()),
        receipt: hash(fact),
    }
}
fn released(request: &UseRequest, target: &ContentDigest) -> UseCommand {
    UseCommand::Released {
        stopped: receipt(request, target, "stopped"),
        released: receipt(request, target, "released"),
    }
}

#[test]
fn composite_use_waits_for_every_owner_and_never_replays_unknown_effects() {
    let request = request();
    let (initial, effect) = apply_use(None, UseCommand::Begin(request.clone())).unwrap();
    let [UseEffect::AcquireTarget(first)] = effect.as_slice() else {
        panic!("one reserved acquire")
    };
    let first = first.digest();
    let EnvironmentSnapshot::Composite(snapshot) = &request.snapshot else {
        unreachable!()
    };
    let second = snapshot
        .targets()
        .into_keys()
        .find(|t| t != &first)
        .unwrap();
    let grant_first = UseCommand::Acquired(receipt(&request, &first, "grant-first"));
    let grant_second = UseCommand::Acquired(receipt(&request, &second, "grant-second"));
    let cases = [
        (
            "all owners must grant",
            vec![grant_first.clone()],
            UseState::Acquiring,
            1,
            0,
        ),
        (
            "active",
            vec![grant_first.clone(), grant_second.clone()],
            UseState::Active,
            1,
            0,
        ),
        (
            "normal release",
            vec![
                grant_first.clone(),
                grant_second.clone(),
                UseCommand::End,
                released(&request, &first),
                released(&request, &second),
            ],
            UseState::Released,
            1,
            2,
        ),
        (
            "second refuses; first must release",
            vec![
                grant_first.clone(),
                UseCommand::Refused(receipt(&request, &second, "refused")),
            ],
            UseState::Releasing,
            1,
            1,
        ),
        (
            "partial refusal settles",
            vec![
                grant_first.clone(),
                UseCommand::Refused(receipt(&request, &second, "refused")),
                released(&request, &first),
            ],
            UseState::Released,
            1,
            1,
        ),
        (
            "cancel before first reply; never acquire second",
            vec![
                UseCommand::End,
                grant_first.clone(),
                released(&request, &first),
            ],
            UseState::Released,
            0,
            1,
        ),
        (
            "unknown acquire remains occupied",
            vec![
                grant_first.clone(),
                UseCommand::TargetUnknown {
                    target: second.clone(),
                },
                UseCommand::End,
                released(&request, &first),
            ],
            UseState::UnknownAcquire,
            1,
            1,
        ),
        (
            "late grant is released without activation",
            vec![
                grant_first.clone(),
                UseCommand::TargetUnknown {
                    target: second.clone(),
                },
                UseCommand::End,
                released(&request, &first),
                grant_second.clone(),
            ],
            UseState::Releasing,
            1,
            2,
        ),
        (
            "unknown release is not success",
            vec![
                grant_first.clone(),
                grant_second.clone(),
                UseCommand::End,
                UseCommand::TargetUnknown {
                    target: first.clone(),
                },
                released(&request, &second),
            ],
            UseState::UnknownRelease,
            1,
            2,
        ),
        (
            "original release reconciles",
            vec![
                grant_first.clone(),
                grant_second.clone(),
                UseCommand::End,
                UseCommand::TargetUnknown {
                    target: first.clone(),
                },
                released(&request, &second),
                released(&request, &first),
            ],
            UseState::Released,
            1,
            2,
        ),
        (
            "repeated facts do not reacquire or release twice",
            vec![
                grant_first.clone(),
                grant_first.clone(),
                grant_second.clone(),
                UseCommand::End,
                UseCommand::End,
                released(&request, &first),
                released(&request, &first),
                released(&request, &second),
                grant_second.clone(),
            ],
            UseState::Released,
            1,
            2,
        ),
    ];
    for (label, commands, expected, acquisitions, releases) in cases {
        let mut state = initial.clone();
        let (mut acquired, mut released_count) = (0, 0);
        for command in commands {
            let (next, effects) = apply_use(Some(&state), command).unwrap();
            for effect in effects {
                match effect {
                    UseEffect::AcquireTarget(_) => acquired += 1,
                    UseEffect::ReleaseTarget(_) => released_count += 1,
                    _ => panic!("composite effects must identify their resource"),
                }
            }
            state = next;
        }
        assert_eq!(state.state(), expected, "{label}");
        assert_eq!(
            (acquired, released_count),
            (acquisitions, releases),
            "{label}"
        );
        assert_eq!(state.request(), &request);
        assert!(
            apply_use(Some(&state), UseCommand::Begin(request.clone()))
                .unwrap()
                .1
                .is_empty()
        );
    }
    // Unknown effects are observations of a previously reserved effect, not a
    // way to invent pending operations on untouched targets.
    for command in [
        grant_second,
        UseCommand::TargetUnknown { target: second },
        UseCommand::Unknown,
        released(&request, &first),
    ] {
        assert!(apply_use(Some(&initial), command).is_err());
    }
    let valid = receipt(&request, &first, "grant");
    for invalid in [
        OwnerReceipt {
            target: None,
            ..valid.clone()
        },
        OwnerReceipt {
            target: Some(hash("other resource")),
            ..valid.clone()
        },
        OwnerReceipt {
            use_id: id("other-use"),
            ..valid.clone()
        },
        OwnerReceipt {
            snapshot: hash("other-snapshot"),
            ..valid.clone()
        },
    ] {
        assert!(apply_use(Some(&initial), UseCommand::Acquired(invalid)).is_err());
    }
    let (active_first, _) = apply_use(Some(&initial), UseCommand::Acquired(valid.clone())).unwrap();
    assert!(
        apply_use(
            Some(&active_first),
            UseCommand::Acquired(OwnerReceipt {
                receipt: hash("different grant"),
                ..valid
            })
        )
        .is_err()
    );
}
