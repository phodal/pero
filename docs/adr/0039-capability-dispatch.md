# 0039: Shared capability dispatch and owner admission

Date: 2026-11-28

Status: accepted for P0.2 of #256. Depends on [0038](0038-capability-inventory.md). No new permission authority and no remote route.

## Decision

Electron and Native take the route for a migrated family from `protocol/inventory/capabilities.json`. `desktop/src/main/capability-dispatch.mjs` and `crates/pero-ui/src/capability_dispatch.rs` apply the same rules to that file. The golden corpus is `protocol/fixtures/capability-dispatch/cases.json`.

A route is not a grant. The owner already named in the inventory still admits the call:

| Owner | What still admits the call |
| --- | --- |
| Host | Agent, research-assets, skills, automation, and insights bodies. The shell checks that the operation is one the inventory names, then forwards the body. |
| Shell | The existing connectors grant (`requireConnectorsGrant` / Native `connectors` request) stays in front of a known connector operation. |
| Device | Deferred routes stay on their current handlers: environment, canvas, notebook projects, docling, reproduction, inputs, artifacts, and the App `/api` proxy. |

`admit` from 0038 is still not called by a shell. Version negotiation belongs to P0.3.

## Envelope rules

The legacy `POST /host/capability` body `{capability, operation, input}` remains the adapter.

- An unknown capability, an unknown operation, or a non-object input fails closed as `CapabilityError` with HTTP 403. Both shells use that status for these migrated rejections. Method, size, and origin failures keep their current platform status.
- Agent envelope operations are only those whose inventory carrier contains `envelope`. `science` and `science_sessions` still go to `/host/agent`. `status` and `lookup` still go to `/host/app-agent`. Envelope `info` stays rejected, because that operation is direct-only; `POST /host/agent` with `info` still forwards.
- Research-assets `queries` is the read. `read` is not an operation and fails closed on both the envelope and the direct route.
- Insights still has no operation name. Any non-empty operation string routes to `/host/insights`, and the handler still forwards only `threadId` and `projectId`.
- Automation no longer receives an injected `operation` field. The envelope forwards `input` as the direct `method` / `path` / `body` document. An `operation` field on that document is `invalid_input`, because `AppRequest` denies unknown fields. Direct automation calls stay the working carrier.

Direct `/host/app-agent`, `/host/agent`, `/host/research-assets`, `/host/skills`, and `/host/connectors` use the same operation names. An unknown operation on those routes is rejected before the Host request, so it cannot bypass the family check. A foreign `Origin` is still refused before dispatch. An oversized body is still refused before dispatch. A `projectId` on an agent status body is forwarded unchanged; the Host scope parser remains the owner that rejects it.

## What this does not change

Privileged control-plane routes, raw Host stdio, and App-frame credentials stay inaccessible. Connector grants, skillhub deadlines, the Electron agent-cancel hook, and the deferred routes are unchanged. Nothing is exposed remotely.

## Verification

Linux runs the corpus against the Electron `DesktopApps` handler and against the pure dispatch. The Native handler test is `cargo test -p pero-ui --features native --lib native_adapter`. A macOS window is not required for the route decision and is not claimed here.
