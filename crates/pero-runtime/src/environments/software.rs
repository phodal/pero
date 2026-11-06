//! Named software components. Legacy observations retain their exact JSON identity.
use super::{
    ContentDigest, EnvironmentError, Identity, NativeProgram, NativeStatus, ProfileObservation,
    PythonVersion, Version,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum SoftwareComponent {
    Python {
        version: PythonVersion,
        sha256: Option<ContentDigest>,
        packages: BTreeMap<Identity, Option<Version>>,
    },
    Native {
        program: NativeProgram,
    },
    OciImage {
        index: Option<ContentDigest>,
        manifest: Option<ContentDigest>,
        config: ContentDigest,
        os: Identity,
        architecture: Identity,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum ComponentSchema {
    #[serde(rename = "pero.software.components.v2")]
    V2,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "ComponentObservationInput")]
pub struct ComponentObservation {
    schema: ComponentSchema,
    name: Identity,
    system: Identity,
    machine: Identity,
    components: BTreeMap<Identity, SoftwareComponent>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ComponentObservationInput {
    schema: ComponentSchema,
    name: Identity,
    system: Identity,
    machine: Identity,
    components: BTreeMap<Identity, SoftwareComponent>,
}
impl TryFrom<ComponentObservationInput> for ComponentObservation {
    type Error = EnvironmentError;
    fn try_from(value: ComponentObservationInput) -> Result<Self, Self::Error> {
        let _ = value.schema;
        Self::new(value.name, value.system, value.machine, value.components)
    }
}
impl ComponentObservation {
    pub fn new(
        name: Identity,
        system: Identity,
        machine: Identity,
        components: BTreeMap<Identity, SoftwareComponent>,
    ) -> Result<Self, EnvironmentError> {
        if components.is_empty() || components.len() > 64 {
            return Err(EnvironmentError::Invalid("software components"));
        }
        Ok(Self {
            schema: ComponentSchema::V2,
            name,
            system,
            machine,
            components,
        })
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum SoftwareObservation {
    Legacy(ProfileObservation),
    Components(ComponentObservation),
}
impl From<ProfileObservation> for SoftwareObservation {
    fn from(value: ProfileObservation) -> Self {
        Self::Legacy(value)
    }
}
impl From<ComponentObservation> for SoftwareObservation {
    fn from(value: ComponentObservation) -> Self {
        Self::Components(value)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "SoftwareProfileInput")]
pub struct SoftwareProfile {
    id: ContentDigest,
    observation: SoftwareObservation,
}
impl SoftwareProfile {
    pub fn observed(observation: impl Into<SoftwareObservation>) -> Self {
        let observation = observation.into();
        Self {
            id: ContentDigest::of(&observation),
            observation,
        }
    }
    pub fn id(&self) -> &ContentDigest {
        &self.id
    }
    pub fn observation(&self) -> &SoftwareObservation {
        &self.observation
    }
}

/// Explicit component selection prevents packages from two interpreters mixing.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum ComponentRequirement {
    Python {
        version: PythonVersion,
        sha256: Option<ContentDigest>,
    },
    PythonPackage {
        name: Identity,
        version: Option<Version>,
    },
    Native {
        version: Option<Version>,
        sha256: Option<ContentDigest>,
    },
    OciImage {
        identity: ImageIdentity,
    },
}

/// Hash namespaces are explicit: a config ID cannot satisfy a manifest pin.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    content = "digest",
    rename_all = "snake_case",
    deny_unknown_fields
)]
pub enum ImageIdentity {
    Index(ContentDigest),
    Manifest(ContentDigest),
    Config(ContentDigest),
}

fn native_matches(
    program: &NativeProgram,
    version: Option<&Version>,
    sha256: Option<&ContentDigest>,
) -> bool {
    program.status == NativeStatus::Observed
        && program.version.is_some()
        && program.sha256.is_some()
        && version.is_none_or(|expected| program.version.as_ref() == Some(expected))
        && sha256.is_none_or(|expected| program.sha256.as_ref() == Some(expected))
}

impl SoftwareProfile {
    pub(super) fn satisfies(&self, rule: &super::Requirement) -> bool {
        use super::Requirement;
        match rule {
            Requirement::Profile { digest } => self.id() == digest,
            Requirement::Platform { system, machine } => match &self.observation {
                SoftwareObservation::Legacy(p) => &p.system == system && &p.machine == machine,
                SoftwareObservation::Components(p) => &p.system == system && &p.machine == machine,
            },
            Requirement::Component { name, condition } => {
                let SoftwareObservation::Components(p) = &self.observation else {
                    return false;
                };
                match (p.components.get(name), condition) {
                    (
                        Some(SoftwareComponent::Python {
                            version, sha256, ..
                        }),
                        ComponentRequirement::Python {
                            version: expected,
                            sha256: hash,
                        },
                    ) => {
                        version == expected
                            && hash
                                .as_ref()
                                .is_none_or(|hash| sha256.as_ref() == Some(hash))
                    }
                    (
                        Some(SoftwareComponent::Python { packages, .. }),
                        ComponentRequirement::PythonPackage { name, version },
                    ) => packages
                        .get(name)
                        .and_then(Option::as_ref)
                        .is_some_and(|actual| version.as_ref().is_none_or(|v| v == actual)),
                    (
                        Some(SoftwareComponent::Native { program }),
                        ComponentRequirement::Native { version, sha256 },
                    ) => native_matches(program, version.as_ref(), sha256.as_ref()),
                    (
                        Some(SoftwareComponent::OciImage {
                            index,
                            manifest,
                            config,
                            ..
                        }),
                        ComponentRequirement::OciImage { identity },
                    ) => match identity {
                        ImageIdentity::Index(hash) => index.as_ref() == Some(hash),
                        ImageIdentity::Manifest(hash) => manifest.as_ref() == Some(hash),
                        ImageIdentity::Config(hash) => config == hash,
                    },
                    _ => false,
                }
            }
            // Legacy implicit-interpreter rules keep their P1 meaning. V2 callers
            // must name a component, even if only one Python is currently present.
            Requirement::Python {
                major,
                minor,
                patch,
            } => match &self.observation {
                SoftwareObservation::Legacy(p) => {
                    p.python.major == *major
                        && p.python.minor == *minor
                        && patch.is_none_or(|v| p.python.patch == v)
                }
                _ => false,
            },
            Requirement::Package { name, version } => match &self.observation {
                SoftwareObservation::Legacy(p) => p
                    .packages
                    .get(name)
                    .and_then(Option::as_ref)
                    .is_some_and(|actual| version.as_ref().is_none_or(|v| v == actual)),
                _ => false,
            },
            Requirement::Native { name, sha256 } => match &self.observation {
                SoftwareObservation::Legacy(p) => p
                    .native
                    .get(name)
                    .is_some_and(|program| native_matches(program, None, sha256.as_ref())),
                _ => false,
            },
        }
    }
}

#[cfg(test)]
mod tests;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SoftwareProfileInput {
    id: ContentDigest,
    observation: SoftwareObservation,
}
impl TryFrom<SoftwareProfileInput> for SoftwareProfile {
    type Error = EnvironmentError;
    fn try_from(value: SoftwareProfileInput) -> Result<Self, Self::Error> {
        let profile = Self::observed(value.observation);
        if profile.id != value.id {
            return Err(EnvironmentError::IdentityChanged);
        }
        Ok(profile)
    }
}
