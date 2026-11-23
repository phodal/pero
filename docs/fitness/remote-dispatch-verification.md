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

## 2026-11-20 — Native scoped task acceptance (#223)

The Native runner reuses the Electron scenario's loopback Go/PostgreSQL
environment, scoped Client, targeted Worker, compatible spare, incompatible
machine and ACP fixture. The HTTP proxy drops the first successful creation
response after PostgreSQL has committed the task. It records each successful
creation's idempotency key and task ID, and the Worker ID requested by the UI
at dispatch. The window operator drives the actual GPUI controls while the
runner checks the resulting API state and Worker exit.

Run from macOS with an isolated `PERO_TEST_DATABASE_URL`, Node, Go and `psql`
available. Build the preview and the distribution with the existing commands,
then run the scenarios serially:

```sh
npm run build:macos-native
node tests/e2e/native-self-hosted-machines.mjs --preview 'target/native/Pero.app'
npm run package:macos-native
node tests/e2e/native-self-hosted-machines.mjs --dmg /absolute/path/to/Pero-macos-arm64.dmg
```

In the window, open **Settings → All settings… → GitHub Connector**, then
connect as **Project client** with the loopback URL and disposable token
printed by the runner. Press Escape, then open **Projects → All project tasks
→ New task**. Follow the runner's task titles and instructions.

- After the first error, inspect the retained title, instructions, completion
  criteria and machine before retrying `Create draft`. The runner checks that
  both requests used the same key and returned the same single, creator-claimed
  task. The detail should open with the selected machine retained.
- Delegate each task explicitly to `Research machine`. The runner checks the
  dispatch request and rejects a claim by the compatible spare before starting
  the selected Worker. Observe `Agent finished` and the execution log for the
  first task. The runner checks for a saved ACP session event.
- Wait for the runner to confirm the ACP turn has started and for `Running on
  Research machine` in the second task. Use `Stop` and `Stop execution`.
  Inspect the confirmation and observe `Stopped` after the Worker confirms
  cleanup. The runner checks the same Run records `cancelled` and the Worker
  exits zero. Press Enter only after checking the window states.

The DMG mode mounts the image read-only, copies the App out, detaches the
image, verifies the copy with `codesign --verify --deep --strict`, then runs
it from a temporary home outside the checkout. Its Worker comes from the
installed bundle. Both modes use an ephemeral Native credential store and
remove their application home, database schema and owned processes on exit.
The runner also cleans up when interrupted or when the Native window closes
before acceptance completes.
Successful receipts and Native logs are written under
`test-results/self-hosted-machines/{native-preview,native-installed}/`.

Observed on macOS 27.2.1 arm64, with runtime source `eedf6162a` and the
acceptance-script changes in the working tree:

| Surface | Observed result |
| --- | --- |
| Actual Native preview window | The connection error was visible with all inputs and the machine selection retained. Retry reached the claimed task. Progress and the execution log showed the first Run complete, then the second Run showed `Running on Research machine`, the explicit confirmation, `Stopping` and `Stopped`. |
| Installed Native from local DMG | The failed submission retained the draft and machine, and retry recovered the same receipt. The copied App showed the completed log, running machine, stop confirmation and `Stopped`. The Worker came from the image, and the App resolved its bundled runtime from outside the checkout. |
| Go/PostgreSQL and independent Worker | Each run created two tasks in total. The successful task retained 15 events. Both dispatches identified the selected Worker and excluded the compatible spare. The cancellation Run reached `cancelled` and its Worker exited zero. The temporary schemas were removed. |

`npm run check`, `go -C server test -race ./...` against the isolated
PostgreSQL instance, and the existing `node scripts/release/native-smoke.mjs`
also passed. The local DMG is 81,646,896 bytes with SHA-256
`12be4d4dcee19c8592643e647ab071522a07b5e45c8350c27c05007748c2cd86`.
Image verification and the copied App's strict ad-hoc signature check passed.
The temporary install location produced a macOS URL-handler registration
warning. This run used the scoped token form and ephemeral credentials.
It did not exercise GitHub OAuth callbacks, Keychain persistence, Gatekeeper
or notarization, public release distribution, or production deployment.

## Go harness with Codex exec-server, 2026-11-21

A macOS 27.2.1 arm64 development Electron client dispatched a Run to the
independent Rust Worker. The Worker launched the SHA256-pinned Go ACP harness
in its native shell approval configuration. A loopback model selected two real
Shell calls. The harness started codex-cli 0.154.0 over private stdio for each.

- The first Shell read a random marker from the workspace. The sandbox denied
  reading a sibling file. The model-side tool receipt and persisted Run event
  agreed on exit code 0, stdout and stderr, including newlines.
- The second Shell printed a different marker and started a 120-second sleep.
  OS process inspection confirmed the live exec-server → Bash → sleep chain.
  Clicking Stop and confirming in Electron produced a persisted `cancelled`
  Run with summary `Cancellation requested by Cloud`. All three PIDs disappeared.
- The second call's partial stdout did not reach the persisted Run events.
  The native foreground tool emits its ACP tool result at completion, and the
  Worker leaves its event-consumption loop when a renewal reports cancellation.
  The direct Go transport test independently observed partial stdout and confirmed
  shell and child exit after cancelling the Go context without the Worker.

Run `node tests/e2e/exec-server-shell.mjs` with a built development Desktop,
`PERO_TEST_DATABASE_URL` for loopback PostgreSQL and
`PERO_TEST_CODEX_EXECUTABLE` set to the installed Codex binary. By default the
fixture uses the development Host and Worker under `target/debug`;
`PERO_HOST_EXECUTABLE` and `PERO_WORKER_BIN` can select built binaries.
This run used Host and Worker binaries from the local #223 package acceptance.
Screenshots and the machine-readable receipt are in `test-results/exec-server-shell/`.
The direct check runs with the same Codex variable and
`go -C harness/go test -race ./shell -run TestExecServerForegroundCancellation`.

### Cancellation retains Shell output, 2026-11-22

The Worker now forwards cancellation to ACP, collects its final events for a
bounded grace period, and flushes its journal before completing the Run. The
existing Run event text displays stdout and stderr from the cancelled Shell.
The full bounded Shell result remains in the ACP event data, including its
abort status and stream truncation flags.

Repeated the fixture on macOS arm64 with a freshly built Worker and Go ACP
harness, the existing development Electron and Host, and real Codex 0.154.0.
After clicking Stop and confirming, the saved Run and Desktop showed
`cancelled`. Refreshing Desktop reloaded the exact two output markers from
PostgreSQL. The execution log showed stdout and stderr separately. OS process
checks found that the Worker executor, Go Agent, exec-server, Bash and sleep
had all exited. The model tool choices were supplied by the loopback fixture.

### SIGTERM before forced cleanup, 2026-11-22

The macOS Desktop fixture now waits until the Shell has installed its SIGTERM
trap and its child has set SIGTERM to ignore. After the Desktop stop
confirmation, the trap writes both output streams, records the still-running
child, and exits with status 23. The Go harness continues collecting output
through its 200 ms native Shell grace and escalates to SIGKILL.

The Run detail returned both pre-cancel and cleanup output from PostgreSQL
after refresh, along with exit code 23 and an aborted Shell receipt. The Run
itself settled as `cancelled`. OS checks confirmed that the Worker executor,
Go Agent, Codex 0.154.0 exec-server, Bash, and the SIGTERM-ignoring child had
exited. The direct real-Codex Go test also checks that cancellation waits for
the configured grace and captures both streams without Worker supervision.

### Worker restart before event upload, 2026-11-22

Run the same fixture with `node tests/e2e/exec-server-shell.mjs --restart`.
The loopback proxy rejects the first batch containing the SIGTERM cleanup
receipt before forwarding it to the real control plane. The first Worker
exits with a saved `cancelled` outcome and unacknowledged events. The Run is
still `cancel_requested` in PostgreSQL. The fixture restarts the Worker with
the same journal and checks its persisted acknowledgement at the completion
request boundary.

The previous Worker submitted completion while events 10–13 were still
unacknowledged. The fixed Worker acknowledged event 13 before submitting
`cancelled`, reused the original Run instance and generation, and made no
additional model calls. Refreshing Desktop showed the recovered stdout and
stderr, including both SIGTERM cleanup markers. The restarted Worker exited
successfully and all five execution PIDs were gone. Evidence is under
`test-results/exec-server-shell-restart/`.
