---
kind: verification_report
date: 2026-10-29
level: L1
---

# App Use verification

Source: the working tree based on `0b17054`, including concurrent Workspace and
Paper Agent changes. [ADR 0014](../adr/0014-app-use.md) describes the Agent → App path;
[ADR 0012](../adr/0012-shared-gpui-app-chat.md) describes shared Chat composition.
This is macOS development evidence, not a clean isolated patch or signed release.

## Implemented and observed

- Host injects an authenticated loopback HTTP MCP server into ACP session setup
  when the Agent advertises HTTP MCP. Session identity comes from the Host, not
  from model tool arguments. The official MCP SDK client connected, discovered
  `app_use`, and completed a real transport call; App `image` metadata survived.
- `useAppObject` exposes actual React state, latest action closures, parameter
  rules and object revisions. Parameter rules run without code generation under
  the existing App CSP. Virtual Cell exposes its actual view and a `select_view`
  action; the Agent changes the same view state as the user controls.
- `inventory/start/describe/observe/capture/wait/act/verify/runPlan/stop` ran from
  an ACP fixture through actual Desktop MCP and the real Virtual Cell document.
  Semantic selection changed to mechanism and back to cells. Fresh DOM refs
  filled the gene filter with `MS4A1` and selected that gene in the actual UI.
- Approval has one owner: the Agent session policy. Actual Workbench/Product
  operations, files, captures, standing tasks and writes completed automatically.
  An explicit ACP Agent permission request still used the existing Chat card;
  denial prevented an App effect. Product recorded the permission IDs and proved
  that only the two explicit Agent questions appeared, with no Desktop requests.
  Task expiry, action lists and session/instance boundaries remain enforced.
- Native screenshots returned actual PNG image blocks with evidence IDs and
  receipts. The captured region excluded Chat. Parent-side geometry checks
  rejected or clipped malformed and oversized App rectangles inside the owned
  iframe. Mechanical nonblank/changed checks and separate semantic verification
  passed. An executed operation remained `verdict: not-run` until verification.
- Ordinary Workbench Chat discovered the mounted App and read its retained
  hidden semantic state. Hidden capture and operation were refused. App-scoped
  conversations stayed within their own App/panel. Two-origin browser checks
  exercised multiple App documents and per-conversation/per-App presence.
- Strict-CSP browser checks covered user input priority, fresh DOM refs,
  lifecycle invalidation of pending calls, capture bounds, grant withdrawal and
  expiry display. Cancellation rejected a deferred read; a timed-out plan
  failed rather than reporting completion. Host replay restored association
  without restoring UI grants.

- Product startup was additionally exercised with the real Host output held
  behind a file signal until Chat initialized. Its original scoped draft remained
  usable after release; local draft selection no longer depends on Host readiness.
- Frozen App objects carry object ID, revision, selection, App instance and time.
  Actual SDK handoff inserted removable Composer chips without sending. Native
  Product capture inserted PNG plus its matching App state/receipt. The real
  image preview marked/undid a region and attached the note as separate JSON.
  Changing the App afterward did not replace the selected object's frozen state.
- A delayed real App semantic response completed after a Workbench conversation
  switch. The other draft stayed empty; reopening the original App conversation
  restored its reference. Capture rejects a changed destination before taking its snapshot.
- Explicit conversation files appeared as hashes/names in inventory. The actual
  Virtual Cell `import_file` action fetched its task-scoped URL, retained original
  JSON number spellings, and persisted a real input artifact. Foreign references,
  arbitrary URLs/paths, other Apps and expiry are refused by behavior tests.
  The actual file-handoff acceptance also uses a Chinese filename.
- Enabled Apps advertise document schemas with `app_describe`. Agent-policy denial
  created no input; an automatically allowed validated document created
  a distinct immutable input, confirmed through backend readback. Route changes
  invalidate prepared writes. These operations preserve scientific acceptance.
- Task tests covered turn boundaries, per-App revoke, selection invalidation and
  cancellation. The parent Revoke button passes the specific App scope. Complete
  capture JSONs were read from disk and matched against the PNG SHA-256, frame
  crop, conversation, Agent, task, App instance and capture time.
- Live Codex (`gpt-6.1-sol`) completed actual Desktop MCP inventory/start/observe/
  stop against Virtual Cell, reported the observed cells/atlas state, and emitted
  the acceptance marker with zero renderer errors. This was an observe-only
  provider check; deterministic Desktop fixtures cover operations and writes.

## Commands and results

- `npm run check`: TypeScript, theme/contracts, 538 bilingual keys and shared icon
  generation passed in this working tree.
- `CARGO_INCREMENTAL=0 node scripts/cargo.mjs test --offline -p pero-contracts -p pero-runtime -p pero-host -p pero-chat-ui -p pero-chat-web -p pero-ui -p pero-worker`:
  82 Rust tests passed. The count includes concurrent Workspace/App-agent tests.
- `node tests/contracts/host.mjs`: Host protocol conformance passed, exercising
  33 of 48 declared event kinds.
- `npm run test:app-use:unit`: eight context/file/write/authority/MCP behavior tests plus six SDK
  tests passed; SDK tests disable string-based code generation.
- `npm run test:app-use:bridge`: 13 actual cross-origin Chromium checks passed,
  with zero recorded renderer errors.
- All components of `PERO_TEST_HEADED=1 npm run test:app-use` passed,
  including actual Workbench and App Product Electron fixtures. These suites
  explicitly require a visible native window because capture visibility is part
  of their contract. Use an isolated desktop when rerunning them.
- `PERO_APP_USE_REAL_AGENT=1 node tests/e2e/app-use-real.mjs`: live Codex acceptance
  passed. It is opt-in and excluded from default suites.
- `npm run test:paper`: 11 existing Paper Agent UI/backend/fixture checks passed
  with the new App declaration and zero renderer errors.
- `+nightly-2026-10-28 check --offline -p pero-ui --features native --bin pero-native`
  passed. The native preview has no App bridge and does not forward local App
  selection/preview intents to Host.
- Both App TypeScript projects passed typecheck. Host, both GPUI Wasm surfaces,
  Web, Desktop, Virtual Cell and Paper Agent assets built successfully. Incremental
  Rust output initially hit a transient disk-space failure; the nonincremental
  build and test runs above completed successfully.

## Local evidence

Generated captures and JSON are ignored build/test evidence:

- `test-results/app-use/approval.png`, `operated.png`, `capture-1.png`,
  `capture-2.png`, `standing-read.png`, `hidden-narrow.png`, `light.png`,
  `dark.png`, `frozen-draft.png`, `annotation-editor.png`,
  `capture-receipts.json` and `result.json`.
- `test-results/app-use-workbench/operated.png`,
  `ordinary-hidden.png`, `original-draft.png`, captured panel PNGs and `result.json`.
- `test-results/app-use-real/result.json` and `observed.png` contain the live
  Codex model, completed tool calls and response.
- The duplicate-approval correction is recorded in
  [the resolved policy incident](../issues/2026-10-29-app-use-duplicate-approval.md).
- The transport ordering failure discovered during acceptance is recorded in
  [the resolved readiness incident](../issues/2026-10-29-app-use-turn-readiness.md).

The fixture transcripts intentionally contain structured diagnostic results.
They do not represent real-model wording or scientific conclusions. Temporary
profiles are removed after tests; captured evidence copies remain in the paths
above. Capture receipts can therefore refer to removed temporary profile paths.

## Remaining acceptance boundaries

The live Codex check established read-only model tool use. Screenshot, DOM,
semantic mutation, file handoff and persistent-write acceptance used a scripted
ACP Agent through the actual Desktop/App/backend boundary. Claude model choice,
real-provider writes/captures, physical IME, Windows/Linux native capture and a
signed/notarized Product release remain separate acceptance checks. Native GPUI
preview has no HTML App surface. No test establishes scientific acceptance.

The implemented interfaces now include Composer object references, screenshot
annotations, conversation file handoff, declared app_describe/app_write, bundled
workflow instructions, per-App revocation and durable capture receipts. An App
callback already dispatched when cancellation occurs may have effects; neither
a cancelled wait nor a plan failure promises rollback.
