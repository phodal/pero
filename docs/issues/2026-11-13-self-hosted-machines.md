---
kind: feature
status: open
date: 2026-11-13
github_issue: 223
github_state: open
github_url: https://github.com/phodal/pero/issues/223
related: https://github.com/phodal/pero/issues/219
---

# Self-hosted machines: scoped task creation and observed execution targets

P1 reuses existing device enrollment, Task/Run, claim/dispatch/cancel and local approvals. Users need to create a task within their project grants, choose a compatible execution machine, and distinguish unknown/offline/online observations from busy or unresolved execution. Existing UI creation is operator-only; Worker rows currently infer idleness from incomplete loaded task pages.

The control plane remains the execution authority. Presence records authenticated contact, never grants permission. Capabilities come from enrollment, not heartbeat assertions. Busy/reconcile references come from existing Runs. A client-created task is atomically claimed by its creator; retries are scoped to that client. No alternate task queue, Agent loop or blanket tool approval is introduced.

Reuse the existing GPUI task form/detail and Worker page plus Electron/Native adapters. Preserve draft input after failures, operator workflows, shared task claims, legacy workers and old-server unknown-state presentation. Add target selection in execution detail; draft creation itself does not execute. Current native sandbox-required approval remains explicit and unchanged; general writable-agent approval and persistent follow-up remain separate slices.

## Acceptance

- [x] Scoped creation, receipt replay and forged-source rejection over real PostgreSQL.
- [x] Idle and active Worker contacts update presence; expiration is evaluated by a pure domain rule.
- [x] Project-scoped capability/status listings and existing execution controls remain correct.
- [x] Electron client creation and Native adapter implementation/build.
- [ ] Actual Native-window client creation and execution acceptance.
- [x] Real Desktop creation, target selection, progress and cancellation; inspect light/dark/narrow states.

## Implementation and verification

Implementation is isolated on `codex/self-hosted-machines`, based on `master`
`d41f19b56`, with five focused implementation commits ending at `37da6c04`.
It reuses the Task/Run receipt transaction and Worker authentication contact;
there is no new heartbeat endpoint or scheduler. Scoped creation rejects forged
source/parent identity. A selected incompatible/removed machine blocks dispatch
until the user chooses again; it never silently becomes an unrestricted target.

UI migration: the existing operator-only task form now admits scoped clients;
creation is still a draft and dispatch remains a separate explicit action.
The Worker settings page changes from fixed four-column rows to name/status plus
project/current-task lines, so the actual settings panel fits. It uses public
Kit buttons, existing typography and palette roles; no token or generated asset
was manually edited. Status previously inferred from loaded task pages now uses
server observation, retaining unknown state for older servers and preserving
private Run identifier filtering.

Real loopback Go/PostgreSQL HTTP acceptance and full server race tests passed.
The real Electron/Go/PostgreSQL/independent Worker suite passed with two tasks,
zero page errors, a lost creation-response replay, exclusion of a compatible
spare machine, ACP execution events and confirmed cancellation. Chinese/light,
English/dark and 1000px window screenshots were inspected. The busy Worker page
was inspected in a separate probe. See the dated section of
[remote dispatch verification](../fitness/remote-dispatch-verification.md).

Native library tests passed (79); a real Native window and Native client's HTTP
creation have not been accepted. This is deterministic ACP fixture execution,
not a real-model/scientific or packaged-release acceptance. P1 has not been
merged or deployed. General writable-agent approvals and persistent follow-up
remain outside this slice. Release updated Desktop clients before enabling the
new Worker response fields, since older clients have a closed response schema.

The user requested that screenshots remain local; no PNGs are committed or
uploaded. Keep #223 open for integration/release acceptance; #219 remains the
architecture/reference issue and #222 remains the independent P0 recovery fix.
