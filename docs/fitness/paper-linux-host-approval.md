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
content; a fresh nonpersistent session permits only its exact fixed top-level document
for that exact popup and denies all other requests, permissions and downloads.
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
npm dependencies plus the separate locked `packages/connectors` dependencies
with `--ignore-scripts`, builds Desktop/static preload using the normal build entry,
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


## First CI preparation failures (no UI or input)

PR #107 head `5fb6463fb153251fb427701760df8b914ded69cd` runs
[41419923766](https://github.com/phodal/pero/actions/runs/41419923766) and
[41419924398](https://github.com/phodal/pero/actions/runs/41419924398) failed in
**Prepare opt-in Host approval UI**, before the semantic fixture step. Job
`125192737152` reported missing `fflate` and
`pdfjs-dist/legacy/build/pdf{.worker}.mjs` imports from the Feishu file parser.
Root `npm ci` had succeeded; `packages/connectors` is not a root workspace and
owns a separate committed package-lock. The normal connector build initializes
that lock with `npm ci --prefix ... --ignore-scripts` before Desktop bundling.

The narrow preparation fix runs that same locked dependency initialization
explicitly, without building/launching connector workers, changing dependency
versions, externalizing imports or bypassing production bundling. A static wiring
regression checks lock entries and ordering before the Desktop build. Both failed
attempts remain failures; neither produced native input or approval evidence.
The corrected workflow has not yet been run. Labels were removed before the fix;
root controls publication and a separately opted-in retry.


## First actual UI startup failure (no semantic input)

After the dependency fix, run
[41421332038](https://github.com/phodal/pero/actions/runs/41421332038), job
`125197309656`, head `dd6972f83f6c74c11ea19511f1ae3e2d5cfdc967`, passed Desktop
build and 20 unit/helper tests, then failed the first abort-lifecycle readiness
check: owner disabled was not observed within the unchanged 10-second bound.
Artifact `13129538388` (SHA-256
`e86651c1d57084d7710e91186c1927b0d6f10da4eec0c25a14b98d20ad4a0aec`) retained
runtime and runner records only. No semantic input was attempted.

Pinned Electron implements Linux modal-parent disablement and `isEnabled()`;
there is no basis to drop that readiness gate. Source review found a bootstrap
policy defect: the unconditional session request blocker has no exception for
its own trusted main document. It now permits **only** exact popup webContentsId,
mainFrame resource type and complete fixed data URL; alternate data URLs,
foreign windows, frames, resources and remote URLs remain blocked. Unit tests
exercise this allow case and each independent mismatch. This is not a broader
origin allowlist or a relaxed security/semantic gate.

The old log does not prove that data-URL interception caused this particular
failure. That causal diagnosis and the fix's native effect remain unverified.
The fixture now retains up to 64 authored-process startup events (including
load/preload failure and show/close), up to 8 window metadata records and, if
one exact owned approval window survives, a renderer diagnostic screenshot
with a 2-second capture deadline and hash. Such PNGs are labelled diagnostic,
not native approval evidence. Original native-driver screenshot/identity/tree
requirements still precede every semantic click; all existing deadlines remain.
Root controls publication and the next single opt-in CI verification. No local
GUI launch, worker, computation or OS security change was performed.
