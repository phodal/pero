use serde::{Deserialize, Serialize};
use sha2::{Digest as _, Sha256};
use std::collections::BTreeMap;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum EnvironmentError {
    Invalid(&'static str),
    RequirementUnsatisfied(Vec<Requirement>),
    ObservationMissing,
    IdentityChanged,
    UseConflict,
}
impl std::fmt::Display for EnvironmentError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{self:?}")
    }
}
impl std::error::Error for EnvironmentError {}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct Identity(String);
impl TryFrom<String> for Identity {
    type Error = EnvironmentError;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        if value.is_empty()
            || value.len() > 128
            || !value
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"-_.:".contains(&b))
        {
            return Err(EnvironmentError::Invalid("identity"));
        }
        Ok(Self(value))
    }
}
impl From<Identity> for String {
    fn from(value: Identity) -> Self {
        value.0
    }
}
impl Identity {
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct Version(String);
impl TryFrom<String> for Version {
    type Error = EnvironmentError;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        if value.trim().is_empty() || value.len() > 256 || value.chars().any(char::is_control) {
            return Err(EnvironmentError::Invalid("version"));
        }
        Ok(Self(value))
    }
}
impl From<Version> for String {
    fn from(value: Version) -> Self {
        value.0
    }
}

/// Canonical JSON: sorted object keys, compact UTF-8, integers/strings only here.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct ContentDigest(String);
impl TryFrom<String> for ContentDigest {
    type Error = EnvironmentError;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        if value.len() != 64
            || !value
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        {
            return Err(EnvironmentError::Invalid("sha256"));
        }
        Ok(Self(value))
    }
}
impl From<ContentDigest> for String {
    fn from(value: ContentDigest) -> Self {
        value.0
    }
}
impl ContentDigest {
    pub fn of(value: &impl Serialize) -> Self {
        fn canonical(value: serde_json::Value, out: &mut Vec<u8>) {
            match value {
                serde_json::Value::Object(map) => {
                    out.push(b'{');
                    for (i, (key, value)) in map
                        .into_iter()
                        .collect::<BTreeMap<_, _>>()
                        .into_iter()
                        .enumerate()
                    {
                        if i != 0 {
                            out.push(b',');
                        }
                        out.extend(serde_json::to_vec(&key).expect("JSON string"));
                        out.push(b':');
                        canonical(value, out);
                    }
                    out.push(b'}');
                }
                serde_json::Value::Array(values) => {
                    out.push(b'[');
                    for (i, value) in values.into_iter().enumerate() {
                        if i != 0 {
                            out.push(b',');
                        }
                        canonical(value, out);
                    }
                    out.push(b']');
                }
                value => out.extend(serde_json::to_vec(&value).expect("JSON value")),
            }
        }
        let mut bytes = Vec::new();
        canonical(
            serde_json::to_value(value).expect("Environment values serialize"),
            &mut bytes,
        );
        Self(format!("{:x}", Sha256::digest(bytes)))
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PythonVersion {
    pub major: u16,
    pub minor: u16,
    pub patch: u16,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NativeStatus {
    Observed,
    Missing,
    ProbeFailed,
    Unsupported,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NativeProgram {
    pub version: Option<Version>,
    pub sha256: Option<ContentDigest>,
    pub status: NativeStatus,
}

/// A metadata observation is neither importability nor execution authorization.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProfileObservation {
    pub name: Identity,
    pub python: PythonVersion,
    pub system: Identity,
    pub machine: Identity,
    pub interpreter_sha256: Option<ContentDigest>,
    pub packages: BTreeMap<Identity, Option<Version>>,
    pub native: BTreeMap<Identity, NativeProgram>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct SoftwareProfile {
    id: ContentDigest,
    observation: ProfileObservation,
}
impl SoftwareProfile {
    pub fn observed(observation: ProfileObservation) -> Self {
        Self {
            id: ContentDigest::of(&observation),
            observation,
        }
    }
    pub fn id(&self) -> &ContentDigest {
        &self.id
    }
    pub fn observation(&self) -> &ProfileObservation {
        &self.observation
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Requirement {
    Profile {
        digest: ContentDigest,
    },
    Python {
        major: u16,
        minor: u16,
        patch: Option<u16>,
    },
    Package {
        name: Identity,
        version: Option<Version>,
    },
    Native {
        name: Identity,
        sha256: Option<ContentDigest>,
    },
    Platform {
        system: Identity,
        machine: Identity,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct EnvironmentRequirements {
    method: Identity,
    required: Vec<Requirement>,
    preferred: Vec<Requirement>,
}
impl EnvironmentRequirements {
    pub fn new(
        method: Identity,
        required: Vec<Requirement>,
        preferred: Vec<Requirement>,
    ) -> Result<Self, EnvironmentError> {
        if required.is_empty() || required.len() > 64 || preferred.len() > 64 {
            return Err(EnvironmentError::Invalid("requirements"));
        }
        Ok(Self {
            method,
            required,
            preferred,
        })
    }
    pub fn method(&self) -> &Identity {
        &self.method
    }
    pub fn required(&self) -> &[Requirement] {
        &self.required
    }
    pub fn preferred(&self) -> &[Requirement] {
        &self.preferred
    }
}

/// P1 names preparation inputs but has no preparation executor or prepared claim.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct SoftwareRecipe {
    pub definition: ContentDigest,
    pub inputs: Vec<ContentDigest>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct EnvironmentTemplate {
    identity: Identity,
    version: Version,
    requirements: EnvironmentRequirements,
}
impl EnvironmentTemplate {
    pub fn new(
        identity: Identity,
        version: Version,
        requirements: EnvironmentRequirements,
    ) -> Self {
        Self {
            identity,
            version,
            requirements,
        }
    }
    pub fn digest(&self) -> ContentDigest {
        ContentDigest::of(self)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct EnvironmentBinding {
    pub owner: Identity,
    pub incarnation: Identity,
    pub observed_at_ms: u64,
    pub profile: SoftwareProfile,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct EnvironmentSnapshot {
    template: EnvironmentTemplate,
    binding: EnvironmentBinding,
}
impl EnvironmentSnapshot {
    pub fn capture(
        template: EnvironmentTemplate,
        binding: EnvironmentBinding,
        now_ms: u64,
        max_age_ms: u64,
    ) -> Result<Self, EnvironmentError> {
        super::matching::match_profile(&template.requirements, &binding, now_ms, max_age_ms)?;
        Ok(Self { template, binding })
    }
    pub fn digest(&self) -> ContentDigest {
        ContentDigest::of(self)
    }
    pub fn binding(&self) -> &EnvironmentBinding {
        &self.binding
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct EnvironmentInstance {
    identity: Identity,
    snapshot: EnvironmentSnapshot,
}
impl EnvironmentInstance {
    pub fn new(identity: Identity, snapshot: EnvironmentSnapshot) -> Self {
        Self { identity, snapshot }
    }
    pub fn refresh(
        &self,
        binding: EnvironmentBinding,
        now_ms: u64,
        max_age_ms: u64,
    ) -> Result<Self, EnvironmentError> {
        let old = &self.snapshot.binding;
        if old.owner != binding.owner
            || old.incarnation != binding.incarnation
            || old.profile.id != binding.profile.id
        {
            return Err(EnvironmentError::IdentityChanged);
        }
        Ok(Self {
            identity: self.identity.clone(),
            snapshot: EnvironmentSnapshot::capture(
                self.snapshot.template.clone(),
                binding,
                now_ms,
                max_age_ms,
            )?,
        })
    }
    pub fn snapshot(&self) -> &EnvironmentSnapshot {
        &self.snapshot
    }
}
