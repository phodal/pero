# Point App compatibility — 2026-10-31

The target is **independent Pero execution**: a person installs an existing
Point App directory and uses its original workflow, without running Point.
The current implementation closes the directory/SDK/backend protocol gap for
nine domain Apps, plus a bounded local Project API. It does **not** yet establish full Point Host API parity.

## Tested inputs and authority

Point source: `b45190a3db725953128b4a8a40e95a287aa9bfd7`, clean and unchanged.
Pero validation base: `439120dd9431936e703c8f516c0745fc5b3464cc`, plus the Point
App changes. Other sessions were editing Data and session/navigation UI.
Validation therefore also used a temporary export of that base with only these
changes, existing dependency/generated-font inputs and existing web artifacts.

Rust Host remains the owner of install/enable, backend processes and App data.
The SDK is built from Point once and bundled with Pero. The original panel and
backend files are not rewritten. Point's HMAC contract binds method, target
(including query) and body. Caller credentials are stripped while domain
request/response headers are retained. App config is a Rust Host operation,
not a browser store or a second backend-owned config authority.

Local Project list/types/create/read/revision/context operations compile the
canonical Point Project rules/storage into a private binary bundled with Pero.
Rust serializes calls under the App store and checks the enabled App's declared
Project API scope; the binary accepts no App-selected root, URL or executable.
Its journal lives under the Pero data home. No Point HTTP server, Session owner,
planner or scheduler is started. Repository resolution, delivery endpoints and
shared Hub connections are not implemented; no `shared:true` or successful
empty replacement is returned. Unsupported operations return an explicit 501.

Exact pre-launch Host/Desktop/web artifact hashes and source base are in
`test-results/point-apps/result.json`. `point-build.json` records copied file
hashes and `runtime.json` records the bundled SDK/dependency digest and private Project binary hash. These
ignored artifacts identify what was tested; existing web assets are not claimed
to be rebuilt from the complete working tree.

## Actual Electron results

| Original Point App | Verified workflow |
| --- | --- |
| Welcome | Direct source-directory install and original SDK/module rendering. |
| Ontology Explorer | Synthetic input analysis, retained state, semantic App Use read, `data-point-object` geometry, locale/theme/narrow layout and keyboard clear. |
| Virtual Cell | Original Python import and persisted input; `control`, `train_mean`, `additive` each evaluated 5/5 test combinations with 0 failures. Full split: 12 candidates, 5 train, 2 validation, 5 test, 0 excluded. |
| Map | Original Node catalog/UI, PUT document write and POST restore after seeding a previous document. A first-write restore correctly has no previous document. |
| Design System | Original Node catalog and UI. |
| CAN Bus Monitor | Original Node bus state and UI with the App's simulated adapter. |
| Data Lab | Integrity-checked Iris default example, Python analysis to `succeeded`, and original SDK chat action filling the Pero composer. |
| CAD Studio | Original Node status/UI and available bundled OCCT WASM kernel. |
| AI4S Lab | Original Python environment/UI and Rust-owned config GET/PUT roundtrip. Optional scientific packages/binaries were absent and were reported as absent. |

A separate two-panel fixture preserved both IDs; its first panel rendered and
its secondary HTML entry was served. User navigation to every secondary panel
is not claimed as live acceptance. The fixture also created/read a real Project through original API paths in
the Electron frame, retained its revision ETag and reported actual local
non-shared Hub ownership. The page error list was empty. The nine
original compiled modules were byte-compared with their installed copies.
Owned processes and temporary profile data were cleaned up.

## Checks

- Node contract tests: permissions, schema/route rejection, methods, query and
  binary-body signing, credential stripping, domain headers, source-data exclusion,
  SDK surface revisions and existing workbench payload behavior.
- Rust Runtime suite: 66 passed, including config permission, object/size limits,
  persistence across reopening the store, revoked storage permission and Project
  scope/enable gates. The private Go Project test proves durable reopening,
  revision conflict rejection and unsupported repository/execution operations.
- Native UI source/check plus its Point wire-protocol unit test passed from the
  isolated source export. A concurrent `sessions_view.rs` edit prevented testing
  the complete shared worktree at one point; it was not modified to unblock this.
- TypeScript and generated contract checks passed with the existing generated
  Wasm declarations available. The nine-App Electron suite passed from the
  isolated source export as well as the earlier ordinary development checkout; the new Project fixture passed in
  the isolated export. A fresh WebAssembly rebuild was blocked by a local GPUI
  dependency API mismatch (`TextViewState`/`InputBaseState` methods missing);
  Electron used the recorded existing web assets.

```sh
node --test packages/point-app/*.test.mjs desktop/src/main/point-apps.test.ts packages/app-sdk/src/app-use.test.ts
CARGO_TARGET_DIR=target/point-apps node scripts/cargo.mjs test -p pero-runtime
POINT_ROOT=/absolute/path/to/point node scripts/build/desktop.mjs
POINT_ROOT=/absolute/path/to/point node tests/e2e/point-apps.mjs
```

## Full denominator: 9 of 23 original packages accepted

| Not yet supported | Missing independent Pero contracts |
| --- | --- |
| Architecture Workbench, Engineering Notebook, Pages | Complete Project contracts, Workspace/settings APIs; cross-App reads and Pages UI modules as applicable. |
| Paper Agent, Scientific Viewer, Scene Studio, Legacy Workbench | Workspace/Project/Harness APIs, scoped Agent runs, conversation bindings and related execution authority. |
| Factory | Project delivery APIs, events, automation/webhooks, Agent plugins, secrets and workspace authority. |
| GitHub, COBOL Modernization | Agent plugin contributions/authority and their Host/Project/Session APIs. COBOL also has real execution environment prerequisites. |
| Calendar | OS calendar Host capability and its privacy/permission flow. |
| AAOS Test, Android Auto Viewer | Mobile Host capability, devices/surfaces and scoped lifecycle. |
| Vehicle Investigation | `exec` backend, Host input APIs and session/agent events. |

These fourteen Apps are refused at manifest or shared-module validation rather than having permissions or
contributions silently removed. The decision is to implement these capabilities
inside Pero, not connect to a running Point installation. Their independent
Host API migration and real workflow acceptance remain required work.

No claim is made for real-model Agent writes, signed release packages,
Windows/Linux, full native Wry GUI acceptance, physical CAN/Mobile devices,
Calendar access or scientific/business acceptance. Virtual Cell retains its
original `isolation: unverified`, `acceptance: not_reviewed` and insufficient
scientific evidence. CAD kernel readiness is not model-import acceptance;
AI4S environment status is not an installed scientific environment.
