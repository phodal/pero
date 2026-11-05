# ADR 0029: AI4S environments bound to scientific attempts

Status: accepted for P1, 2026-11-02. Pure domain values, matching and read-only
software observation implemented; managed Uses, runtime separation and remote
integration remain planned. See [P1 evidence](../fitness/ai4s-environments.md).

The 2026-11-05 [local preparation delivery](../fitness/local-environment-preparation.md)
adds named venvs and explicit App-wide binding. It does not complete managed Uses
or separate per-attempt scientific interpreters.

## Context

Pero already has App Python preparation, App-owned experiment/process evidence,
workspace leases and a bounded Go Kubernetes owner with RuntimeBinding. These
are different authorities. A reusable AI4S environment must connect them without
creating another scheduler, experiment store or approval system.

Control Lab currently performs Python calculations inside its backend and calls
ngspice as a subprocess. Fixed PC-Gym execution currently uses the App-selected
interpreter. A different scientific interpreter therefore needs actual process
and binding changes; a UI selector alone cannot provide it. PC-Gym's smoke/table6
`profile` is an experiment configuration, not a software environment identity.

The [research record](../design-docs/ai4s-environments-research.md) compares
scientific workflows, open-source applications and commercial platforms.
It supports separate identities for methods, software, execution resources,
inputs, executions and results; version labels alone do not fix actual content.

## Decision

1. Environment resolves and binds execution conditions for existing scientific
   methods. Methods/ExperimentSpecs retain parameters, units, seeds, scientific
   budgets, metrics and acceptance rules. Data, models and samples retain their
   domain owners; environments reference their authorized access.
2. Use the named concepts SoftwareRecipe/Profile, EnvironmentRequirements,
   Template, Instance/Binding, immutable Snapshot and Use. Reusable software is
   separate from live resource allocation and per-attempt writable output.
   Observed existing software is not mislabeled as a reproducibly built profile.
3. Bind Uses to existing calculation attempts and verification operations.
   One research Run may reference multiple Uses. App, Agent and scientific
   runtime requirements remain distinct. No parallel scientific Run type is added.
4. Fix requirements and resolved content before admission; record actual runtime
   observations when available. Requirements and preferences are distinct.
   Missing mandatory observations block execution; snapshots retain unknowns.
5. Keep pure matching and Use transitions in a planned Rust Runtime environment
   module. The shell supplies identity/time, persists before external effects and
   feeds Owner receipts back to the core. Python adapters do not duplicate that
   lifecycle. Interfaces are introduced only for concrete replacement seams.
6. Host/App/Worker retain execution and cancellation. Go RuntimeBinding retains
   remote infrastructure lifecycle. Each environment instance/Use has one
   coordinator; references do not grant authority. Existing leases are not acquired
   twice. Unknown effects are reconciled with original IDs, never auto-redispatched.
7. Preparation is an explicit operation separate from inspection or calculation
   approval. Existing Control Lab Goal/budgets and PC-Gym private approval/integrity
   checks remain authoritative. Changed execution bindings require renewed approval.
8. Release a Use only after the original Owner confirms stopping and release.
   Preserve shared software, inputs and outputs according to their existing owners.
   Environment readiness, process success, numerical verification and scientific
   acceptance remain independent claims.

The model, semantic interfaces, lifecycle and migration rules are specified in
[the design](../design-docs/ai4s-environments.md). P1 has no new public Host/HTTP
operation and does not use its pure Use transitions to grant live execution.

## Alternatives

| Alternative | Reason not selected |
| --- | --- |
| One App-wide mutable venv | Cannot independently version methods or separate App availability from scientific dependencies |
| One environment/VM for an entire research Run | Does not describe hybrid per-step computation or independent verification |
| Import Point's entire environment engine | Adds a second local runtime/coordinator instead of extending Pero's existing owners |
| New capsule/workflow/scheduler platform | Existing Specs, Playbooks, attempts and execution authorities already own these concerns |
| One universal AI4S YAML and capability registry | Domain input/output meanings and physical sample state do not belong to an environment engine |

## Consequences and rollout

Start with read-only observations and optional receipt references. Preserve
historic Specs/hashes; missing historical observations stay missing. Next,
implement per-attempt local Uses, then separate scientific compute interpreters
with fixed entrypoints and complete approval/checker/export migration.
Prepared software reuse follows both scenarios. Remote compute reuses existing
Worker/RuntimeBinding; hosted services and instruments require separate evidence.

[Control Lab and PC-Gym](../design-docs/ai4s-environments-scenarios.md) validate
the responsibilities and failure cases at design level. The
[phased plan](../exec-plans/2026-11-02-ai4s-environments.md) defines actual gates.
No GPU/HPC deployment, full PC-Gym training, arbitrary-code sandbox or scientific
replication acceptance is established by this ADR. ADR 0007, 0017, 0018 and 0026
retain their existing authority and trust boundaries.
