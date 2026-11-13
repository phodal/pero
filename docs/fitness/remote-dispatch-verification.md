# Remote dispatch verification

Date: 2026-10-28. Design: [ADR 0002](../adr/0002-remote-task-dispatch.md)
and [ADR 0003](../adr/0003-github-issues-and-client-claims.md).

## Implemented and exercised

The control plane is Go with real PostgreSQL. An independent Rust Worker reuses
the existing ACP runtime; neither task scheduling nor future Kubernetes provider
ownership moves into Rust. The original baseline starts with manual Tasks and
operator credentials. The current extension adds read-only GitHub intake and
project-scoped client claims; its checks are listed separately below.

The following baseline results were recorded before the shared-client extension.
They do not stand in for its final combined checks.

| Check | Result |
| --- | --- |
| Go `go test -race ./...` with an isolated PostgreSQL database | Passed |
| Go `go vet ./...` | Passed |
| Worker unit and HTTP/ACP subprocess tests | 12 passed |
| `npm run check` | Passed: TypeScript, themes, 219 bilingual keys, generated contracts |
| `npm test` | Passed before the final Worker size-bound additions; the updated Worker suite then passed separately |
| `npm run test:contracts` | Passed; every observed Host line conforms |
| `npm run test:remote` with real Electron, Go, PostgreSQL and independent Worker | Passed |
| Existing `npm run test:e2e` conversation suite | Failed at the existing single-wheel scroll assertion; see incident below |

The database cases exercise concurrent claims, durable restart, frozen input,
operator/Worker/project/instance scope separation, expiry during a row-lock wait,
duplicate claims/events/results, cancellation races, Worker quarantine, Unicode
limits and response byte bounds. They use isolated schemas and remove them.

The actual Desktop flow creates two drafts through the GPUI form, explicitly
dispatches them, observes persisted ACP output, cancels a silent execution after
confirmation, restarts the Go service, recovers the same Tasks, checks connection
errors and loads 51 Tasks across pages. English, dark and 1000px-wide views and
the unconfigured state were captured. A native Workbench menu/shortcut opens
remote tasks. Cloud credentials are absent from renderer state and local Agent
environment. Test configuration and artifacts stay outside user repositories.

Worker fault injection also exercised supervisor SIGKILL and restart: descendant
processes stopped, the original Run entered `reconcile`, and its prompt ran once.
The ACP SDK's separate process group required explicit descendant-group cleanup.
See [cleanup incident](../issues/2026-10-28-remote-worker-descendant-cleanup.md).

## GitHub intake and shared clients

The extension imports stable GitHub Issue identities, preserves frozen goals and
source revisions, and separates latest provider metadata from the goal accepted
for execution. Closed or stale sources block new execution. Operator-provisioned
clients can claim, release and execute project-scoped Tasks; these claims do not
write GitHub assignees. Label-gated automatic dispatch is opt-in and cannot take
an existing human claim or silently rerun previously dispatched work.

| Current extension check | Result |
| --- | --- |
| Go `go test -race ./...` with isolated PostgreSQL | Passed, including source/client ownership and provenance cases |
| Go `go vet ./...` | Passed |
| `npm run check` | Passed: TypeScript, themes, 239 bilingual messages and generated contracts |
| `npm run build` | Passed: generated fonts, Host, GPUI WASM, Web and Desktop |
| Local complete-font reuse without Python/downloads; cached-font build with network disabled | Passed; generated binaries/stamp ignored by Git |
| Public GitHub read against `api.github.com` | Passed; details below |
| `npm run test:github`: actual Electron clients + Go/PostgreSQL + independent ACP Worker + fixture GitHub | Passed, including changed/closed sources, dark and 1000px-wide client views |
| `npm run test:remote` against the combined implementation | Passed: 51 Tasks, no page errors; create/execute/cancel/reconnect/pagination and English/dark/narrow views |

The public-source check read `phodal/pero` without a provider token. Startup
imported Issue #2 as one draft with automatic dispatch disabled and no Run. A
subsequent manual sync returned HTTP 200 with zero new imports, zero dispatches,
`partial:false` and no errors. An overlapping manual request during startup
returned the expected 409 while the single sync owner was running. This was
read-only provider access; no GitHub label, assignment or Issue-state write was
performed. Evidence: `test-results/github/live-source.json`.

The Desktop/GitHub harness uses deterministic provider and ACP fixtures with real
Electron windows, the actual Go API, PostgreSQL transactions and an independent
Rust Worker. The completed flow passed Desktop source sync, automatic dispatch
once, project scope, claim conflict, release/claim handoff, Worker execution, both
clients observing the same Run, and credential exclusion. After an upstream edit
and closure, frozen goal/source and the entire Run remained unchanged. Clicking
the disabled Execute button added zero dispatch requests in either state; visible
warnings explained recovery. Dark and 1000px-wide client layouts also passed,
with no page errors. Evidence is
`test-results/github/result.json` and the `operator-before-sync`,
`automatic-policy`, `available`, `alice-claimed`, `bob-executed`, `source-changed`,
`source-closed`, `client-dark` and `client-narrow` screenshots in that directory. This workflow is
protocol/interaction evidence, not a real-model or production acceptance claim.

## Reproduce

Build with `npm run build` and `npm run build:worker`. Set
`PERO_TEST_DATABASE_URL` to a disposable PostgreSQL database, then run
`npm run test:remote`. For the shared source/client flow, use the same disposable
URL with `npm run test:github`. Run Electron suites sequentially. Database credentials are
configuration; no production database or remote deployment was touched.

Generated evidence: `test-results/remote/result.json`,
`test-results/remote/worker-faults.json`, and the `empty`, `create-form`, `draft`,
`completed`, `running`, `cancel-confirmation`, `cancelled`, `connection-error`,
`english`, `dark`, `narrow`, `unconfigured` PNGs in the same directory.

## Limits and remaining work

This is macOS local multi-process protocol acceptance with an ACP fixture, not
real-model, deployed Linux, Kubernetes, packaged Desktop or production acceptance.
The Worker uses approved trusted checkouts and Unix process supervision; it is
not an adversarial sandbox. Remote unattended permission requests are denied.
Task execution success does not establish candidate verification or acceptance.

ROADMAP ingestion, GitHub OAuth/webhooks/writeback, credential revocation and
explicit reconciliation/source-refresh UI for previously executed goals,
independent verification, PR publication, Kubernetes providers and deployment to
openpero.com remain unimplemented. The Go service has configurable listen,
database and token settings for a future separate deployment.

During the [master worktree integration](worktree-integration.md), the
[conversation scroll follow](../issues/2026-10-28-conversation-scroll-follow.md)
regression was resolved by cancelling stale layout-follow requests after reader
movement. The original single-wheel assertions passed twice, and the full
Desktop tool/conversation and i18n suites passed. The combined remote suite
again passed with 51 Tasks, and the two-client GitHub flow passed with frozen
source/Run evidence and no requests from disabled Execute controls. The earlier
failure table is retained as historical evidence from the original slice.


## 2026-11-13 — Scoped creation and observed machines (#223)

Source: `codex/self-hosted-machines` over `master d41f19b56`; implementation
commits `6c20242c` through `37da6c04`. Acceptance harness and this record were
uncommitted during the run. P0 recovery PR #222 is a separate branch and was
not folded into this slice. No public environment was changed.

| Check | Observed result |
| --- | --- |
| `go -C server test -race ./...` with `PERO_TEST_DATABASE_URL` | Passed against real isolated PostgreSQL schemas, including scoped creation, atomic creator claim, receipt replay, forged input, capabilities, private occupancy and disable |
| `node scripts/cargo.mjs +nightly-2026-10-28 test -p pero-ui --features native --lib` | 79 passed; includes target compatibility and existing Native connection tests |
| `npm run check` | Passed: TypeScript, generated contracts/tokens/icons and 1214 bilingual messages |
| Wasm build + wasm-bindgen + `npm run build:web`; `node scripts/build/desktop.mjs` | Passed; existing dead-code/eval/import.meta warnings remain |
| `node tests/e2e/self-hosted-machines.mjs` with isolated database | Passed: real Electron client credential, Go HTTP, PostgreSQL, independent Rust Worker and deterministic ACP fixture; two tasks, zero page errors |

The loopback proxy forwards creation to the real server, then drops the first
successful response. The UI retains its draft. A second real click sends the
same idempotency key and receives the same task ID; the list contains one task.
A different enrolled machine with the same capability cannot claim the explicitly
targeted queued Run. The selected independent Worker executes ACP and uploads
session events. A second `wait` task reaches running, then the actual Stop and
confirmation controls drive it to cancelled. Presence is checked independently
of occupied Run state. The pure expiry table fixes time explicitly, including
the exact 15-second boundary; no timestamp sleeps or public-network tests.

Inspected local screenshots in
`test-results/self-hosted-machines/desktop/`: `create-form`, `creation-retry`,
`target-detail`, `completed`, `running`, `cancel-confirmation`, `cancelled`,
`workers-idle`, `workers-dark`, `workers-narrow`, `tasks-narrow`. A preceding
probe's `workers-running` shows the real active task alongside unknown and idle
machines. The settings layout retains readable names, status and project scope
in light/dark at 1280px and 1000px window widths. The final task-list capture waits
for observable pixel stability after the settings closing animation. Evidence:
`result.json`. Screenshots remain local at the user's request.

Reproduce after building the Host, Worker, Wasm/Web and Desktop:

```sh
PERO_TEST_DATABASE_URL='<disposable PostgreSQL URL>' node tests/e2e/self-hosted-machines.mjs
```

`PERO_TEST_ELECTRON_EXECUTABLE` optionally selects an existing Electron executable.
The suite creates/drops its own schema and closes its owned processes. The local
PostgreSQL instance uses a private Unix socket; no literal TCP port is bound for
that database. HTTP servers bind ephemeral loopback ports.

Limits: Native adapter source and library behavior compiled/tested, but its new
client creation route and actual Native window have no independent end-to-end
acceptance here. No signed/package installation, real model, scientific verdict
or P1 production rollout is established. The general writable-agent approval and
persistent follow-up work remain separate. New clients accept old observation-free
responses; old clients with closed schemas need updating before the new server
Worker fields are rolled out. Keep API contact observation separate from machine
readiness and execution permission.
