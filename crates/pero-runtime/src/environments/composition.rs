//! Resource capabilities and immutable, method-selected binding snapshots.
use super::*;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Capability {
    Process,
    Batch,
    Http,
    Sql,
    Terminal,
    DesktopObserve,
    DesktopInput,
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ResourceRef {
    pub owner: Identity,
    pub kind: Identity,
    pub scope: Identity,
    pub id: Identity,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Readiness {
    Ready,
    NotReady,
    Unknown,
}

/// Owner observation, not a caller's declaration or a grant. Runtime identifies
/// the boot/process incarnation separately from the surviving resource.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ResourceBinding {
    pub resource: ResourceRef,
    pub runtime: Identity,
    pub observed_at_ms: u64,
    pub readiness: Readiness,
    pub profile: SoftwareProfile,
    pub capabilities: BTreeSet<Capability>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ResourceSlot {
    pub software: EnvironmentRequirements,
    pub capabilities: BTreeSet<Capability>,
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SlotCapability {
    pub slot: Identity,
    pub capability: Capability,
}

/// An access dependency, not a workflow step or a provisioning schedule.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ResourceLink {
    pub from: SlotCapability,
    pub to: SlotCapability,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "ResourceTemplateInput")]
pub struct ResourceTemplate {
    schema: TemplateSchema,
    identity: Identity,
    version: Version,
    slots: BTreeMap<Identity, ResourceSlot>,
    links: BTreeSet<ResourceLink>,
}
impl ResourceTemplate {
    pub fn new(
        identity: Identity,
        version: Version,
        slots: BTreeMap<Identity, ResourceSlot>,
        links: BTreeSet<ResourceLink>,
    ) -> Result<Self, EnvironmentError> {
        if slots.is_empty()
            || slots.len() > 64
            || links.len() > 256
            || slots.values().any(|slot| slot.capabilities.is_empty())
        {
            return Err(EnvironmentError::Invalid("resource slots"));
        }
        for link in &links {
            for endpoint in [&link.from, &link.to] {
                if !slots
                    .get(&endpoint.slot)
                    .is_some_and(|slot| slot.capabilities.contains(&endpoint.capability))
                {
                    return Err(EnvironmentError::Invalid("resource link"));
                }
            }
        }
        Ok(Self {
            schema: TemplateSchema::V2,
            identity,
            version,
            slots,
            links,
        })
    }
}

/// Supplied by the existing method owner after freezing its specification.
/// This selection does not authorize an App to run or acquire a resource.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UseSelection {
    pub method: Identity,
    pub slots: BTreeMap<Identity, BTreeSet<Capability>>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "CompositeSnapshotInput")]
pub struct CompositeSnapshot {
    schema: SnapshotSchema,
    template: ResourceTemplate,
    selection: UseSelection,
    required: BTreeMap<Identity, BTreeSet<Capability>>,
    bindings: BTreeMap<Identity, ResourceBinding>,
}

/// One acquisition per actual resource, even when several slots refer to it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UseTarget {
    pub resource: ResourceRef,
    pub runtime: Identity,
    pub profile: ContentDigest,
    pub capabilities: BTreeSet<Capability>,
}
impl UseTarget {
    pub fn digest(&self) -> ContentDigest {
        ContentDigest::of(self)
    }
}

impl CompositeSnapshot {
    pub fn capture(
        template: ResourceTemplate,
        selection: UseSelection,
        observations: &BTreeMap<Identity, ResourceBinding>,
        now_ms: u64,
        max_age_ms: u64,
    ) -> Result<Self, EnvironmentError> {
        if selection.slots.is_empty() || selection.slots.len() > 64 {
            return Err(EnvironmentError::Invalid("use selection"));
        }
        let mut required = selection.slots.clone();
        for (name, operations) in &required {
            if operations.is_empty()
                || !template
                    .slots
                    .get(name)
                    .is_some_and(|slot| operations.is_subset(&slot.capabilities))
            {
                return Err(EnvironmentError::Invalid("selected capability"));
            }
        }
        // Finite set closure permits service cycles; it never schedules work.
        loop {
            let mut changed = false;
            for link in &template.links {
                if required
                    .get(&link.from.slot)
                    .is_some_and(|ops| ops.contains(&link.from.capability))
                {
                    changed |= required
                        .entry(link.to.slot.clone())
                        .or_default()
                        .insert(link.to.capability.clone());
                }
            }
            if !changed {
                break;
            }
        }
        let mut bindings = BTreeMap::new();
        let mut resources: BTreeMap<&ResourceRef, &ResourceBinding> = BTreeMap::new();
        let window = ObservationWindow::new(now_ms, max_age_ms)?;
        for (name, operations) in &required {
            let binding = observations
                .get(name)
                .ok_or(EnvironmentError::ObservationMissing)?;
            window.require(binding.observed_at_ms)?;
            if binding.readiness != Readiness::Ready {
                return Err(EnvironmentError::ResourceUnavailable {
                    slot: name.clone(),
                    readiness: binding.readiness.clone(),
                });
            }
            if !operations.is_subset(&binding.capabilities) {
                return Err(EnvironmentError::CapabilityUnavailable {
                    slot: name.clone(),
                    missing: operations
                        .difference(&binding.capabilities)
                        .cloned()
                        .collect(),
                });
            }
            match_software(&template.slots[name].software, &binding.profile)?;
            // Aliases cannot claim different boots/software or capability facts
            // for the same resource in a single acquisition snapshot.
            if let Some(previous) = resources.insert(&binding.resource, binding) {
                if previous.runtime != binding.runtime
                    || previous.profile != binding.profile
                    || previous.capabilities != binding.capabilities
                {
                    return Err(EnvironmentError::IdentityChanged);
                }
            }
            bindings.insert(name.clone(), binding.clone());
        }
        Ok(Self {
            schema: SnapshotSchema::V2,
            template,
            selection,
            required,
            bindings,
        })
    }
    pub fn bindings(&self) -> &BTreeMap<Identity, ResourceBinding> {
        &self.bindings
    }
    pub fn required(&self) -> &BTreeMap<Identity, BTreeSet<Capability>> {
        &self.required
    }
    pub fn digest(&self) -> ContentDigest {
        ContentDigest::of(self)
    }
    pub fn targets(&self) -> BTreeMap<ContentDigest, UseTarget> {
        let mut grouped: BTreeMap<ResourceRef, UseTarget> = BTreeMap::new();
        for (slot, binding) in &self.bindings {
            let target = grouped
                .entry(binding.resource.clone())
                .or_insert_with(|| UseTarget {
                    resource: binding.resource.clone(),
                    runtime: binding.runtime.clone(),
                    profile: binding.profile.id().clone(),
                    capabilities: BTreeSet::new(),
                });
            target
                .capabilities
                .extend(self.required[slot].iter().cloned());
        }
        grouped
            .into_values()
            .map(|target| (target.digest(), target))
            .collect()
    }
    pub fn refresh(
        &self,
        observations: &BTreeMap<Identity, ResourceBinding>,
        now_ms: u64,
        max_age_ms: u64,
    ) -> Result<Self, EnvironmentError> {
        let next = Self::capture(
            self.template.clone(),
            self.selection.clone(),
            observations,
            now_ms,
            max_age_ms,
        )?;
        if self.bindings.iter().any(|(slot, original)| {
            let actual = &next.bindings[slot];
            original.resource != actual.resource
                || original.runtime != actual.runtime
                || original.profile != actual.profile
                || original.capabilities != actual.capabilities
        }) {
            return Err(EnvironmentError::IdentityChanged);
        }
        Ok(next)
    }
}

#[cfg(test)]
pub(super) mod tests;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ResourceTemplateInput {
    schema: TemplateSchema,
    identity: Identity,
    version: Version,
    slots: BTreeMap<Identity, ResourceSlot>,
    links: BTreeSet<ResourceLink>,
}
impl TryFrom<ResourceTemplateInput> for ResourceTemplate {
    type Error = EnvironmentError;
    fn try_from(value: ResourceTemplateInput) -> Result<Self, Self::Error> {
        let _ = value.schema;
        Self::new(value.identity, value.version, value.slots, value.links)
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CompositeSnapshotInput {
    schema: SnapshotSchema,
    template: ResourceTemplate,
    selection: UseSelection,
    required: BTreeMap<Identity, BTreeSet<Capability>>,
    bindings: BTreeMap<Identity, ResourceBinding>,
}
impl TryFrom<CompositeSnapshotInput> for CompositeSnapshot {
    type Error = EnvironmentError;
    fn try_from(value: CompositeSnapshotInput) -> Result<Self, Self::Error> {
        let _ = value.schema;
        // Historical records retain their original times. The live admission
        // shell must observe/refresh them before dispatch, never use load as grant.
        let observed = value
            .bindings
            .values()
            .map(|b| b.observed_at_ms)
            .max()
            .unwrap_or(0);
        let snapshot = Self::capture(
            value.template,
            value.selection,
            &value.bindings,
            observed,
            u64::MAX,
        )?;
        if snapshot.required != value.required || snapshot.bindings != value.bindings {
            return Err(EnvironmentError::Invalid("snapshot closure"));
        }
        Ok(snapshot)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
enum TemplateSchema {
    #[serde(rename = "pero.environment.template.v2")]
    V2,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
enum SnapshotSchema {
    #[serde(rename = "pero.environment.snapshot.v2")]
    V2,
}
