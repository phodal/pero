# 0038: Capability inventory and typed wire contracts

Date: 2026-11-28

Status: accepted for P0.1 of #256. Baseline `59d9addeb92b42d600095329204ecfb81c325d6c`. No shell, privilege, or transport change.

## Decision

Keep one checked-in inventory of the capabilities that already exist, and add only the shared metadata those calls do not have yet. The inventory is `protocol/inventory/capabilities.json`. The wire types are `protocol/capabilities.tsp`, generated to `protocol/generated/capabilities.schema.json` and `protocol/generated/capabilities.ts` by the existing `npm run gen:contracts` / `npm run check` path. Bazel `//:checks` diffs those two files as well.

This slice does not add a capability runtime, a permission service, a dispatcher, or a remote route. Electron and Native keep their current handlers. A row in the inventory is not a grant.

`protocol/host.tsp` and `protocol/apps.tsp` are unchanged. Draft PR #247 edits `protocol/host.tsp` and `protocol/generated/host.*`. The new contract lives in its own TypeSpec file so that diff stays untouched. `crates/pero-contracts/src/lib.rs` gains one module line, `capability_wire`, which only parses these documents.

## Three names that stay separate

| Name | Owner | Meaning |
| --- | --- | --- |
| `CapabilitySelection` | `crates/pero-contracts/src/capability_selection.rs` | The user's choice of a composer target. A selection grants no access. |
| `ComposerCapabilities` / `AgentCapabilities` | `crates/pero-contracts/src/composer_capabilities.rs` | What an ACP agent advertised at initialize (images, embedded context, science session). Advertisement is not a grant. |
| `WorkerCapability` | `protocol/remote.tsp`, `server/internal/store/worker_devices.go` | An execution tuple of project, workspace key, and agent. Project membership is not a checkout or an App capability. |

App SDK `permissions.host` is a fourth thing: a manifest declaration checked by `createAppHost` before it will expose `HostCapability.call`. Declaration is not a grant. The Host still admits the call.

## Compatibility

Negotiation is a new document (`CapabilityNegotiation`). Legacy operation bodies do not grow a version field.

- A negotiation with no `protocolVersion` fails closed as `missing_version`.
- `protocolVersion` other than `1` fails closed as `version_mismatch`. Values outside `0..4294967295` fail as `invalid_input`.
- A capability or operation that is not in the inventory fails closed as `unknown_operation`. Casing is significant: `Status` is not `status`.
- Unknown fields, a wrong enum, and a non-integer where an integer is required fail as `invalid_input`.
- The current operation body stays accepted. Agent status is still `{operation:"status", scope:{workspaceId}, runId}`. Research query read is still `{operation:"queries", queryId}`.
- `declaredHost` carries the existing `permissions.host` list. `advertised` records a manifest or provider advertisement. `CapabilityAdmission.grant` is `false` in both cases. Manifest declaration and advertisement are not grants.
- A routing entry, a TypeSpec model, and this inventory are not authorization. The owner that already admits the call stays the owner.

Shells still answer failures with plain text or their existing JSON codes. `CapabilityError` is the contract those carriers can adopt later. This slice does not make them emit it.

## Contract drift recorded here

The canonical samples follow the executing parser. Behavior is unchanged.

- `protocol/apps.tsp` `ResearchAssetsRequest` lists `start`, `status`, and `cancel`. `crates/pero-host/src/research_assets.rs` also accepts `datasets`, `queries`, `linkquery`, and `saverecord`. The canonical read is Host operation `queries`. With `queryId` it is the Data `read` of one saved query; without `queryId` it lists queries. `apps.tsp` stays the legacy subset inside the Host protocol bundle.
- `AgentScope` in `protocol/apps.tsp` and `pero_runtime::apps::agent_run::Scope` have only `workspaceId`. `AppAgentScope` in `packages/app-sdk/src/host.tsx` also allows `projectId` and forbids having both. A `projectId` field is an unknown field on the Host scope and fails closed. The SDK type is unchanged.
- The Host status projection has no `result` field. The SDK `AppAgentRun` type has an optional `result`. A `result` field on the canonical response fails closed.
- The generic envelope copies `operation` onto the JSON object it forwards. Automation's `AppRequest` denies unknown fields and already uses `method` for the HTTP verb, so an envelope call that injects `operation` does not match the direct `/host/automation` body. Direct automation calls stay the working carrier. This slice does not change that.
- Insights has no operation name. The shell requires some operation string, then forwards only `threadId` and `projectId`. Negotiation has no insights operation to admit.

## Exposure

`exposure` on an inventory row is a contract class, not a route that exists today. `remoteNow` is false for every row.

- `local_only`: the effect stays on this device (kernel, files, install, local process).
- `transport_neutral`: the document does not name a carrier. It is still local until a later slice.
- `remotely_exposable`: the document is ids and status, with no path, token, or backend URL. That class is not permission to expose it.
- `privileged`: credentials, stdio, operator or worker control, or a call that can start execution.

## What P0.2 and later pick up

P0.2 can derive Electron and Native dispatch from this inventory, starting with agent status and the `queries` read, and then the other named operations. It owns the envelope clash with automation, the unnamed insights body, and the direct routes listed as deferred in the inventory: environment, canvas, notebook projects, docling, reproduction, inputs, artifacts, and the App `/api` proxy. P0.3 owns SDK negotiation. P0.4 owns resource identity. This ADR does not migrate those shells.

## Non-goals

No Desktop behavior change, no new permission check, no mobile shell, no new workbench, and no edit to the Host JSONL shapes in `protocol/host.tsp`.
