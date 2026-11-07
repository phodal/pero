# ADR 0030: Composable compute environments for AI4S

Status: accepted, 2026-11-06. Implementation starts with the environment core;
acceptance of this decision does not establish Docker, VM, service-composition
or Slurm runtime support. Extends [ADR 0029](0029-ai4s-environments.md).

## Context

COBOL toolchains, Control/ngspice, PC-Gym and HPC need software, execution
resources and data access to be bound to an existing attempt. Docker, virtual
machines and Slurm describe different dimensions: software packaging, resource
supply and scheduling can coexist in one execution. The current Python-centric
profile and single-binding environment snapshot cannot express that composition.

Point provides useful multi-slot, Owner, runtime-incarnation and Use semantics,
plus concrete Docker, service and VM adapters. Importing its entire coordinator
would duplicate Pero's Host/Worker and control-plane ownership.

## Decision

1. Extend the existing SoftwareRecipe/Profile, EnvironmentRequirements,
   EnvironmentTemplate, Instance/Binding, Snapshot and Use concepts. Do not add
   a parallel ComputeEnvironment aggregate or scheduler.
2. Separate placement, software identity, resource provisioning and operation
   capability. There is no mutually exclusive local/docker/vm/slurm environment
   enum. A resource can expose multiple capabilities without duplicate allocation.
3. Templates declare versioned resource slots and required connections. A Use
   selects the method's necessary slots and their dependency closure. Missing
   optional resources do not block unrelated operations. Snapshots retain the
   actual Owner, resource identity, runtime incarnation and unknown observations.
4. Keep software independent of Python. Distinguish preparation inputs, prepared
   artifacts and actual observations; package metadata, OCI manifests, local image
   IDs and mutable VM disks are not interchangeable content identities. Preserve
   legacy serialized records and hashes; version new composite contracts.
5. Methods retain scientific parameters, seeds, units, budgets, checkpoint
   compatibility and verification. Data owners retain input meaning, versions and
   access. Environments bind these references and actual conditions, never infer
   scientific acceptance or cross-platform numerical equivalence.
6. Reuse existing execution and approval owners. Prepare explicitly, resolve the
   approved choices, acquire attempt-scoped Uses, then dispatch through the
   original execution owner. Record actual stop/release facts before declaring a
   Use released. Cancellation, unknown effects and restart never replay work.
7. For batch jobs, approve submission constraints before allocation; record the
   original job identity, then verify allocated conditions before scientific
   payload execution. Queued is not ready and submission is not allocation.
8. Use native deployment units such as reviewed Compose recipes for same-owner
   service groups. Cross-owner preparation records partial outcomes and cleans up
   only owned resources according to their disposition. Do not introduce a
   distributed transaction or another deployment/workflow DSL.
9. Keep pure matching/binding/Use transitions in the Rust environment core. Host
   adapters perform local I/O; existing Go RuntimeBinding and resource owners
   retain remote infrastructure authority. One coordinator owns each Use/resource
   lifecycle. Extract only ports exercised by real interchangeable implementations.
10. Compute manages resource placement, instances and associated operations;
    Environments manages software and reusable templates; domain Apps own methods
    and results. Management UIs are consumers of Host capabilities.

## Consequences

Implement in order: compatible core; local/Docker execution with COBOL and ngspice;
Compose service groups; Tart/QEMU and control-plane KubeVirt; PC-Gym runtime
separation and real Slurm integration. Each backend needs separate live evidence.
Desktop availability does not imply guest process control or cancellation.
Environment readiness, execution completion, verification and acceptance remain
separate facts. No general auto-placement, cache, checkpoint manager, volume GC,
arbitrary-command API or replacement approval queue is introduced.

The [detailed design](../design-docs/2026-11-06-compute-environment-capabilities.md)
owns source mapping, scenarios, adapter identities and delivery gates. The
[existing environment plan](../exec-plans/2026-11-02-ai4s-environments.md) remains
the implementation tracker and must distinguish delivered slices from plans.
