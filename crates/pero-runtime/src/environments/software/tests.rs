use super::*;
use crate::environments::{EnvironmentRequirements, Requirement, match_software};

fn id(s: &str) -> Identity {
    s.to_owned().try_into().unwrap()
}
fn version(s: &str) -> Version {
    s.to_owned().try_into().unwrap()
}
fn hash(s: &str) -> ContentDigest {
    ContentDigest::of(&s)
}

#[test]
fn software_requirements_are_component_scoped() {
    let profile = SoftwareProfile::observed(
        ComponentObservation::new(
            id("toolchain"),
            id("Linux"),
            id("aarch64"),
            BTreeMap::from([
                (
                    id("solver"),
                    SoftwareComponent::Native {
                        program: NativeProgram {
                            version: Some(version("44")),
                            sha256: Some(hash("ngspice")),
                            status: NativeStatus::Observed,
                        },
                    },
                ),
                (
                    id("training"),
                    SoftwareComponent::Python {
                        version: PythonVersion {
                            major: 3,
                            minor: 12,
                            patch: 11,
                        },
                        sha256: Some(hash("training-python")),
                        packages: BTreeMap::from([(id("torch"), Some(version("2.6.0")))]),
                    },
                ),
                (
                    id("checker"),
                    SoftwareComponent::Python {
                        version: PythonVersion {
                            major: 3,
                            minor: 12,
                            patch: 11,
                        },
                        sha256: Some(hash("checker-python")),
                        packages: BTreeMap::new(),
                    },
                ),
                (
                    id("manifest-only"),
                    SoftwareComponent::OciImage {
                        index: Some(hash("multi-arch")),
                        manifest: Some(hash("linux-arm")),
                        config: None,
                        os: id("linux"),
                        architecture: id("arm64"),
                    },
                ),
                (
                    id("image"),
                    SoftwareComponent::OciImage {
                        index: Some(hash("multi-arch")),
                        manifest: Some(hash("linux-arm")),
                        config: Some(hash("config")),
                        os: id("linux"),
                        architecture: id("arm64"),
                    },
                ),
            ]),
        )
        .unwrap(),
    );
    let cases = [
        (
            "native exact version",
            "solver",
            ComponentRequirement::Native {
                version: Some(version("44")),
                sha256: None,
            },
            true,
        ),
        (
            "native version mismatch",
            "solver",
            ComponentRequirement::Native {
                version: Some(version("43")),
                sha256: None,
            },
            false,
        ),
        (
            "native file mismatch",
            "solver",
            ComponentRequirement::Native {
                version: None,
                sha256: Some(hash("other")),
            },
            false,
        ),
        (
            "training package",
            "training",
            ComponentRequirement::PythonPackage {
                name: id("torch"),
                version: Some(version("2.6.0")),
            },
            true,
        ),
        (
            "checker cannot borrow training package",
            "checker",
            ComponentRequirement::PythonPackage {
                name: id("torch"),
                version: None,
            },
            false,
        ),
        (
            "native is not interpreter",
            "solver",
            ComponentRequirement::PythonPackage {
                name: id("torch"),
                version: None,
            },
            false,
        ),
        (
            "interpreter pin",
            "training",
            ComponentRequirement::Python {
                version: PythonVersion {
                    major: 3,
                    minor: 12,
                    patch: 11,
                },
                sha256: Some(hash("training-python")),
            },
            true,
        ),
        (
            "other interpreter bytes",
            "training",
            ComponentRequirement::Python {
                version: PythonVersion {
                    major: 3,
                    minor: 12,
                    patch: 11,
                },
                sha256: Some(hash("checker-python")),
            },
            false,
        ),
        (
            "manifest pin",
            "image",
            ComponentRequirement::OciImage {
                identity: ImageIdentity::Manifest(hash("linux-arm")),
            },
            true,
        ),
        (
            "manifest remains usable without config evidence",
            "manifest-only",
            ComponentRequirement::OciImage {
                identity: ImageIdentity::Manifest(hash("linux-arm")),
            },
            true,
        ),
        (
            "unknown config cannot satisfy a config pin",
            "manifest-only",
            ComponentRequirement::OciImage {
                identity: ImageIdentity::Config(hash("linux-arm")),
            },
            false,
        ),
        (
            "config is not manifest",
            "image",
            ComponentRequirement::OciImage {
                identity: ImageIdentity::Manifest(hash("config")),
            },
            false,
        ),
        (
            "index is not manifest",
            "image",
            ComponentRequirement::OciImage {
                identity: ImageIdentity::Index(hash("linux-arm")),
            },
            false,
        ),
        (
            "missing component",
            "absent",
            ComponentRequirement::Native {
                version: None,
                sha256: None,
            },
            false,
        ),
    ];
    for (label, component, condition, expected) in cases {
        let requirements = EnvironmentRequirements::new(
            id("method"),
            vec![Requirement::Component {
                name: id(component),
                condition,
            }],
            vec![],
        )
        .unwrap();
        assert_eq!(
            match_software(&requirements, &profile).is_ok(),
            expected,
            "{label}"
        );
    }
    for rule in [
        Requirement::Python {
            major: 3,
            minor: 12,
            patch: None,
        },
        Requirement::Package {
            name: id("torch"),
            version: None,
        },
    ] {
        assert!(!profile.satisfies(&rule), "V2 must name an interpreter");
    }
    let native = ComponentObservation::new(
        id("native-only"),
        id("Linux"),
        id("aarch64"),
        BTreeMap::from([(
            id("solver"),
            SoftwareComponent::Native {
                program: NativeProgram {
                    version: Some(version("44")),
                    sha256: Some(hash("ngspice")),
                    status: NativeStatus::Observed,
                },
            },
        )]),
    )
    .unwrap();
    let serialized = serde_json::to_value(&native).unwrap();
    assert!(serialized.get("python").is_none());
    let decoded: SoftwareObservation = serde_json::from_value(serialized).unwrap();
    let native = SoftwareProfile::observed(decoded);
    assert!(native.satisfies(&Requirement::Component {
        name: id("solver"),
        condition: ComponentRequirement::Native {
            version: None,
            sha256: None
        }
    }));
    assert!(!native.satisfies(&Requirement::Python {
        major: 3,
        minor: 12,
        patch: None
    }));
}

#[test]
fn legacy_profile_identity_is_unchanged() {
    // P1 wire fixture. The literal digest is independently computed from its
    // canonical JSON, so changing the new wrapper cannot silently re-sign it.
    let bytes = include_str!("legacy-observation.json");
    let observation: SoftwareObservation = serde_json::from_str(bytes).unwrap();
    let profile = SoftwareProfile::observed(observation);
    assert_eq!(
        profile.id().as_str(),
        "100b9bd9734b6d20e9cc2e327b9a73fed15de10117fa047b95dc54be8e3626f0"
    );
    assert_eq!(
        serde_json::to_value(profile.observation()).unwrap(),
        serde_json::from_str::<serde_json::Value>(bytes).unwrap()
    );
    assert!(profile.satisfies(&Requirement::Package {
        name: id("control"),
        version: Some(version("0.10.2"))
    }));
}

#[test]
fn legacy_snapshot_identity_is_unchanged() {
    use crate::environments::{EnvironmentBinding, EnvironmentSnapshot, EnvironmentTemplate};
    let observation: SoftwareObservation =
        serde_json::from_str(include_str!("legacy-observation.json")).unwrap();
    let profile = SoftwareProfile::observed(observation);
    let requirements = EnvironmentRequirements::new(
        id("legacy-method"),
        vec![Requirement::Profile {
            digest: profile.id().clone(),
        }],
        vec![],
    )
    .unwrap();
    let snapshot = EnvironmentSnapshot::capture(
        EnvironmentTemplate::new(id("legacy-env"), version("1"), requirements),
        EnvironmentBinding {
            owner: id("host"),
            incarnation: id("backend-1"),
            observed_at_ms: 100,
            profile,
        },
        110,
        20,
    )
    .unwrap();
    assert_eq!(
        snapshot.digest().as_str(),
        "0d5265216cf546028c884c04178b1f64a2c1bb8fa2374d5b36265a5574e0e059"
    );
    assert_eq!(
        serde_json::to_value(&snapshot).unwrap(),
        serde_json::from_str::<serde_json::Value>(include_str!("legacy-snapshot.json")).unwrap()
    );
}
