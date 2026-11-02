# Linux Host-owned reproduction approval — implementation, not acceptance

2026-11-02. User explicitly authorized replacing only Linux's approval window
and exercising real semantic clicks on an owned **no-computation** fixture.
macOS/Windows retain the original native message box. No scientific worker,
model, credential, private compute token, user desktop or OS security setting
was used here. Old #97 positive GTK attempts and #103 read-only evidence remain
separate and unchanged: this does **not** repair the GTK accessibility bridge.

## Authority and UI boundary

`confirmReproduction` selects a separate Linux BrowserWindow parented/modally
bound to its owner. The fixed trusted document is bundled in the main process;
its summary arrives only at the static isolated preload and is assigned through
`textContent`. No Paper App iframe, remote document, runtime-generated preload,
page script or contextBridge API is involved. CSP rejects script/network/frame
content; a fresh nonpersistent session denies requests, permissions and downloads.
Node integration/devtools/webviews are disabled; sandbox/context isolation are
explicit. Navigation/redirect/new-window attempts deny the pending request.

The main process owns a fresh random nonce per request and validates exact
webContents, exact main-frame identity, fixed document URL, nonce and exact
message shape before settling one decision. A synchronous per-owner reservation
rejects a second request during asynchronous window loading; it is released on
settlement rather than sharing an earlier grant. Preload accepts only a trusted
control event after configuration, disables both controls on submission and
cannot approve a second time. Cancel starts focused; Escape, abort, owner close
(including prevented close), forced destruction, popup close, renderer failure,
unresponsiveness, failed load and a 120-second timeout deny. The owner is never
manually re-enabled; already disabled/destroyed owners are rejected before window
creation. No prior grant is inherited. Existing Host frozen-ticket/private-token
and execution-owner paths are unchanged; a UI decision is not a new capability.

Desktop and Product builds both emit the same static
`reproduction-approval-preload.cjs` beside their main entry bundle. Existing
runtime packaging includes the Desktop dist directory. Missing preload/loading
failure cannot produce an allow decision; readiness/timeout fails closed.

## Local verification

Passed:

```sh
node --experimental-transform-types --test desktop/src/main/reproduction-approval-linux.test.ts desktop/src/main/apps-reproduction.test.ts tests/fixtures/paper-host-approval.test.mjs
```

20 tests cover wrong sender/frame/URL/nonce, malformed/replayed decisions,
Host private-boundary regressions, native fallback lifecycle, denial paths and
VM execution of the actual preload (malicious markup remains text; untrusted
synthetic click cannot submit; only one trusted decision). New fixture/helper
syntax, focused TypeScript checking, focused main/preload esbuild and diff-check
passed. Two additional static CI wiring tests verify distinct default-off gating,
packaged preload, exact artifacts/deadlines and retained native semantic gates.
Tests are not real clicks or native accessibility acceptance.

Full local Desktop build was attempted with a read-only dependency symlink to an
older scratch installation and blocked by missing `fflate` / `pdfjs-dist`.
Aggregate typecheck was blocked by the ungenerated reader-Wasm module. These are
not full build passes. CI must install the lockfile dependencies and use the
normal generated-runtime/build pipeline; Product packaging itself is not tested.

## Explicit positive no-compute fixture (not run locally)

`tests/e2e/paper-host-approval-native.mjs` is a new, separately opt-in entry point.
It copies the **built production preload unchanged** beside a temporary main
bundle. Fixture-only `force-renderer-accessibility` follows the existing authored
Electron fixture convention; the production launch flags are unchanged.

Before any input it verifies exact Electron PID exclusion, one owned window,
a complete native tree, named frame plus nested named dialog, authored nonce
inside that dialog, and one enabled semantic button. The native driver's exact
PID/±2 geometry and invoking-action gates are unchanged. Only native semantic
Cancel and Run once are accepted; no DOM click, pixel/key fallback or synthetic
approval is used. The native receipt and independent main-process decision must
both agree. Abort, ordinary owner close and forced owner destroy run first.

CI is now wired in `computer-use.yml`, but has not been executed for this change.
Only a Linux PR labelled `ci:paper-host-approval-native` or manual dispatch with
boolean `paper_host_approval_native=true` (default false) runs this fixture.
The #103 read-only label, ordinary PR/push/schedule and `ci:full` do not opt in.
Preparation installs official GTK/AT-SPI/Gio/X11 prerequisites and locked root
npm dependencies, builds Desktop/static preload using the normal build entry,
and runs unit negatives before UI input. The existing job supplies the native
driver. The UI step has a 3-minute outer timeout and a 120-second owned runner:


```sh
PERO_PAPER_HOST_APPROVAL_NATIVE=1 PERO_TEST_HEADED=1 PERO_TEST_SOFTWARE_GL=1 node scripts/ci/run-acceptance.mjs --name paper-host-approval-native --timeout-seconds 120 -- xvfb-run -a node tests/e2e/paper-host-approval-native.mjs
```

The entry creates its private D-Bus session and writes only its own evidence to
`test-results/paper-host-approval-native`, plus the runner's named receipt. Keep
CI opt-in distinct from `ci:paper-native-diagnostic`; exact screenshot/evidence
and named runner receipt paths are uploaded with seven-day retention. Remove
its positive label after
the intended run. If complete semantic evidence is missing, stop; do not relax
the gates. Any follow-up scientific environment or worker run remains outside
this authorized no-compute UI exercise.
