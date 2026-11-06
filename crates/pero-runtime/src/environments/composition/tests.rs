use super::*;

pub(crate) fn id(s: &str) -> Identity {
    s.to_owned().try_into().unwrap()
}
pub(crate) fn hash(s: &str) -> ContentDigest {
    ContentDigest::of(&s)
}
fn version(s: &str) -> Version {
    s.to_owned().try_into().unwrap()
}

/// One VM provides process and desktop; a separate database serves the process.
pub(crate) fn fixture() -> (
    ResourceTemplate,
    UseSelection,
    BTreeMap<Identity, ResourceBinding>,
) {
    let profile = SoftwareProfile::observed(
        ComponentObservation::new(
            id("solver-image"),
            id("Linux"),
            id("x86_64"),
            BTreeMap::from([(
                id("image"),
                SoftwareComponent::OciImage {
                    index: None,
                    manifest: Some(hash("manifest")),
                    config: hash("config"),
                    os: id("linux"),
                    architecture: id("amd64"),
                },
            )]),
        )
        .unwrap(),
    );
    let software = EnvironmentRequirements::new(
        id("simulation"),
        vec![Requirement::Profile {
            digest: profile.id().clone(),
        }],
        vec![],
    )
    .unwrap();
    let capabilities = BTreeSet::from([
        Capability::Process,
        Capability::DesktopObserve,
        Capability::DesktopInput,
    ]);
    let compute = ResourceBinding {
        resource: ResourceRef {
            owner: id("host"),
            kind: id("vm"),
            scope: id("local"),
            id: id("vm-1"),
        },
        runtime: id("boot-1"),
        observed_at_ms: 100,
        readiness: Readiness::Ready,
        profile: profile.clone(),
        capabilities: capabilities.clone(),
    };
    let database = ResourceBinding {
        resource: ResourceRef {
            owner: id("docker"),
            kind: id("container"),
            scope: id("local"),
            id: id("db-1"),
        },
        runtime: id("start-1"),
        observed_at_ms: 100,
        readiness: Readiness::Ready,
        profile,
        capabilities: BTreeSet::from([Capability::Sql]),
    };
    let slots = BTreeMap::from([
        (
            id("compute"),
            ResourceSlot {
                software: software.clone(),
                capabilities: capabilities.clone(),
            },
        ),
        (
            id("desktop"),
            ResourceSlot {
                software: software.clone(),
                capabilities,
            },
        ),
        (
            id("database"),
            ResourceSlot {
                software,
                capabilities: BTreeSet::from([Capability::Sql]),
            },
        ),
    ]);
    let links = BTreeSet::from([ResourceLink {
        from: SlotCapability {
            slot: id("compute"),
            capability: Capability::Process,
        },
        to: SlotCapability {
            slot: id("database"),
            capability: Capability::Sql,
        },
    }]);
    let template = ResourceTemplate::new(id("simulation-env"), version("1"), slots, links).unwrap();
    let selection = UseSelection {
        method: id("simulation"),
        slots: BTreeMap::from([(id("compute"), BTreeSet::from([Capability::Process]))]),
    };
    (
        template,
        selection,
        BTreeMap::from([
            (id("compute"), compute.clone()),
            (id("desktop"), compute),
            (id("database"), database),
        ]),
    )
}

#[test]
fn selection_requires_only_its_capability_dependencies() {
    let (template, selection, observations) = fixture();
    let cases = [
        (
            "process requires database",
            selection.clone(),
            "database",
            false,
        ),
        (
            "process ignores absent desktop",
            selection.clone(),
            "desktop",
            true,
        ),
        (
            "observing desktop does not acquire database",
            UseSelection {
                method: id("view"),
                slots: BTreeMap::from([(
                    id("desktop"),
                    BTreeSet::from([Capability::DesktopObserve]),
                )]),
            },
            "database",
            true,
        ),
        (
            "unknown slot",
            UseSelection {
                method: id("bad"),
                slots: BTreeMap::from([(id("absent"), BTreeSet::from([Capability::Process]))]),
            },
            "desktop",
            false,
        ),
        (
            "unsupported requested operation",
            UseSelection {
                method: id("bad"),
                slots: BTreeMap::from([(id("desktop"), BTreeSet::from([Capability::Batch]))]),
            },
            "database",
            false,
        ),
        (
            "empty operations",
            UseSelection {
                method: id("bad"),
                slots: BTreeMap::from([(id("compute"), BTreeSet::new())]),
            },
            "desktop",
            false,
        ),
    ];
    for (label, choice, absent, expected) in cases {
        let mut inputs = observations.clone();
        inputs.remove(&id(absent));
        let result = CompositeSnapshot::capture(template.clone(), choice, &inputs, 110, 20);
        assert_eq!(result.is_ok(), expected, "{label}: {result:?}");
    }
    let captured =
        CompositeSnapshot::capture(template.clone(), selection.clone(), &observations, 110, 20)
            .unwrap();
    assert_eq!(captured.required().len(), 2);
    assert_eq!(captured.targets().len(), 2);
    assert!(
        captured
            .targets()
            .values()
            .all(|t| !t.capabilities.contains(&Capability::DesktopInput))
    );

    // Both capabilities on one resource acquire that resource once.
    let mut both = selection;
    both.slots
        .insert(id("desktop"), BTreeSet::from([Capability::DesktopObserve]));
    let snapshot =
        CompositeSnapshot::capture(template.clone(), both.clone(), &observations, 110, 20).unwrap();
    assert_eq!(snapshot.bindings().len(), 3);
    assert_eq!(snapshot.targets().len(), 2);
    let vm = snapshot
        .targets()
        .into_values()
        .find(|t| t.resource.id == id("vm-1"))
        .unwrap();
    assert_eq!(
        vm.capabilities,
        BTreeSet::from([Capability::Process, Capability::DesktopObserve])
    );
    let mut conflicting = observations.clone();
    conflicting.get_mut(&id("desktop")).unwrap().runtime = id("boot-2");
    assert_eq!(
        CompositeSnapshot::capture(template, both, &conflicting, 110, 20),
        Err(EnvironmentError::IdentityChanged)
    );
}

#[test]
fn observations_cannot_replace_an_existing_execution() {
    let (template, selection, observations) = fixture();
    let original =
        CompositeSnapshot::capture(template.clone(), selection.clone(), &observations, 110, 20)
            .unwrap();
    let digest = original.digest();
    for change in [
        "owner",
        "scope",
        "resource",
        "boot",
        "software",
        "capability",
        "unknown",
        "not-ready",
        "stale",
        "future",
    ] {
        let mut updated = observations.clone();
        let binding = updated.get_mut(&id("compute")).unwrap();
        match change {
            "owner" => binding.resource.owner = id("other-host"),
            "scope" => binding.resource.scope = id("other-scope"),
            "resource" => binding.resource.id = id("replacement-vm"),
            "boot" => binding.runtime = id("boot-2"),
            "software" => {
                binding.profile = SoftwareProfile::observed(
                    ComponentObservation::new(
                        id("different"),
                        id("Linux"),
                        id("x86_64"),
                        BTreeMap::from([(
                            id("image"),
                            SoftwareComponent::OciImage {
                                index: None,
                                manifest: None,
                                config: hash("new-image"),
                                os: id("linux"),
                                architecture: id("amd64"),
                            },
                        )]),
                    )
                    .unwrap(),
                )
            }
            "capability" => {
                binding.capabilities.remove(&Capability::Process);
            }
            "unknown" => binding.readiness = Readiness::Unknown,
            "not-ready" => binding.readiness = Readiness::NotReady,
            "stale" => binding.observed_at_ms = 1,
            "future" => binding.observed_at_ms = 121,
            _ => unreachable!(),
        }
        assert!(original.refresh(&updated, 120, 20).is_err(), "{change}");
        assert_eq!(original.digest(), digest);
    }
    let mut refreshed = observations;
    for binding in refreshed.values_mut() {
        binding.observed_at_ms = 115;
    }
    let next = original.refresh(&refreshed, 120, 20).unwrap();
    assert_ne!(next.digest(), digest);
    assert_eq!(original.digest(), digest);
    assert_eq!(
        serde_json::to_value(&next).unwrap()["schema"],
        "pero.environment.snapshot.v2"
    );
}

#[test]
fn service_cycles_are_dependencies_not_workflow_schedules() {
    let (mut template, selection, observations) = fixture();
    template.links.insert(ResourceLink {
        from: SlotCapability {
            slot: id("database"),
            capability: Capability::Sql,
        },
        to: SlotCapability {
            slot: id("compute"),
            capability: Capability::Process,
        },
    });
    let result =
        CompositeSnapshot::capture(template.clone(), selection, &observations, 110, 20).unwrap();
    assert_eq!(result.bindings().len(), 2);
    for bad in [
        SlotCapability {
            slot: id("absent"),
            capability: Capability::Sql,
        },
        SlotCapability {
            slot: id("database"),
            capability: Capability::DesktopInput,
        },
    ] {
        assert!(
            ResourceTemplate::new(
                id("bad"),
                version("1"),
                template.slots.clone(),
                BTreeSet::from([ResourceLink {
                    from: SlotCapability {
                        slot: id("compute"),
                        capability: Capability::Process
                    },
                    to: bad
                }])
            )
            .is_err()
        );
    }
}
