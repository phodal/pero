use super::*;
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};

fn id(value: &str) -> Identity {
    value.to_owned().try_into().unwrap()
}
fn snapshot(composite: bool) -> EnvironmentSnapshot {
    let legacy: EnvironmentSnapshot =
        serde_json::from_str(include_str!("../software/legacy-snapshot.json")).unwrap();
    if !composite {
        return legacy;
    }
    let profile = legacy.binding().unwrap().profile.clone();
    let capabilities = BTreeSet::from([Capability::Process]);
    let template = ResourceTemplate::new(
        id("method"),
        "1".to_owned().try_into().unwrap(),
        BTreeMap::from([(
            id("compute"),
            ResourceSlot {
                software: EnvironmentRequirements::new(
                    id("method"),
                    vec![Requirement::Profile {
                        digest: profile.id().clone(),
                    }],
                    vec![],
                )
                .unwrap(),
                capabilities: capabilities.clone(),
            },
        )]),
        BTreeSet::new(),
    )
    .unwrap();
    EnvironmentSnapshot::Composite(
        CompositeSnapshot::capture(
            template,
            UseSelection {
                method: id("method"),
                slots: BTreeMap::from([(id("compute"), capabilities.clone())]),
            },
            &BTreeMap::from([(
                id("compute"),
                ResourceBinding {
                    resource: ResourceRef {
                        owner: id("local"),
                        kind: id("process"),
                        scope: id("host"),
                        id: id("resource"),
                    },
                    runtime: id("boot"),
                    observed_at_ms: 10,
                    readiness: Readiness::Ready,
                    profile,
                    capabilities,
                },
            )]),
            10,
            1,
        )
        .unwrap(),
    )
}

#[test]
fn stored_use_reconstructs_each_boundary_without_reissuing_effects() {
    for composite in [false, true] {
        let snapshot = snapshot(composite);
        let request = UseRequest {
            id: id("use"),
            consumer: id("attempt"),
            snapshot,
        };
        let target = match &request.snapshot {
            EnvironmentSnapshot::Composite(s) => s.targets().into_keys().next(),
            _ => None,
        };
        let receipt = OwnerReceipt {
            use_id: request.id.clone(),
            snapshot: request.snapshot.digest(),
            target: target.clone(),
            receipt: ContentDigest::of(&"grant"),
        };
        let (mut record, _) = UseRecord::begin(request.clone()).unwrap();
        let unknown = target
            .clone()
            .map(|target| UseCommand::TargetUnknown { target })
            .unwrap_or(UseCommand::Unknown);
        let events = [
            unknown.clone(),
            UseCommand::End,
            UseCommand::Acquired(receipt.clone()),
            unknown,
            UseCommand::Released {
                stopped: OwnerReceipt {
                    receipt: ContentDigest::of(&"stop"),
                    ..receipt.clone()
                },
                released: OwnerReceipt {
                    receipt: ContentDigest::of(&"release"),
                    ..receipt
                },
            },
        ];
        for event in events {
            let bytes = serde_json::to_vec(&record).unwrap();
            let restored: UseRecord = serde_json::from_slice(&bytes).unwrap();
            assert_eq!(restored, record);
            assert_eq!(restored.state().request(), &request);
            // Repeating Begin after a reply was lost does not dispatch again.
            assert!(
                restored
                    .apply(UseCommand::Begin(request.clone()))
                    .unwrap()
                    .1
                    .is_empty()
            );
            record = restored.apply(event).unwrap().0;
        }
        assert_eq!(record.state().state(), UseState::Released);
        let restored: UseRecord =
            serde_json::from_slice(&serde_json::to_vec(&record).unwrap()).unwrap();
        assert_eq!(restored, record);
    }
}

#[test]
fn stored_evidence_rejects_changed_identity_closure_and_invalid_history() {
    for composite in [false, true] {
        let (record, _) = UseRecord::begin(UseRequest {
            id: id("use"),
            consumer: id("attempt"),
            snapshot: snapshot(composite),
        })
        .unwrap();
        let valid = serde_json::to_value(record).unwrap();
        for fault in [
            "schema",
            "profile",
            "requirements",
            "receipt",
            "empty",
            "derived-state",
            "closure",
        ] {
            if !composite && fault == "closure" {
                continue;
            }
            let mut input = valid.clone();
            let root = "/commands/0/Begin/snapshot";
            let binding = if composite {
                format!("{root}/bindings/compute")
            } else {
                format!("{root}/binding")
            };
            match fault {
                "schema" => input["schema"]=json!("future"),
                "profile" => *input.pointer_mut(&format!("{binding}/profile/id")).unwrap()=json!("0".repeat(64)),
                "requirements" => *input.pointer_mut(&format!("{root}/template/{}",if composite {"slots/compute/software/required"} else {"requirements/required"})).unwrap()=json!([]),
                "receipt" => input["commands"].as_array_mut().unwrap().push(json!({"Acquired":{"use_id":"other","snapshot":"0".repeat(64),"target":null,"receipt":"1".repeat(64)}})),
                "empty" => input["commands"]=json!([]),
                "derived-state" => input["state"]=json!("Active"),
                "closure" => *input.pointer_mut(&format!("{root}/required")).unwrap()=json!({}),
                _ => unreachable!(),
            }
            assert!(
                serde_json::from_value::<UseRecord>(input).is_err(),
                "{composite} {fault}"
            );
        }
        let loaded: UseRecord = serde_json::from_value(valid).unwrap();
        // Serialization retains the original snapshot bytes/hash, including V1.
        let bytes: Value = serde_json::to_value(loaded.state().request().snapshot.clone()).unwrap();
        let expected: Value = serde_json::to_value(snapshot(composite)).unwrap();
        assert_eq!(bytes, expected);
    }
}
