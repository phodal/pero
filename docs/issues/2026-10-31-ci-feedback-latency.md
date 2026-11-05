---
kind: incident
status: open
date: 2026-10-31
---

# CI delays integration failures behind serial acceptance

## 2026-11-05 contract and startup repairs

Master run [41942237130](https://github.com/phodal/pero/actions/runs/41942237130)
failed three independent checks: the PDF restoration selection fake lacked the
production begin/end selection subscriptions; the research-import fixture staged
only `dataset.py` although Data now imports the shared view/chart modules; and
Viewer browser acceptance still treated SDK Select buttons as native selects.
The fixtures now match those public interfaces and installed payloads. Existing
zoom/citation, transfer/consent and browser assertions remain in place.

Release runs including
[41849393828](https://github.com/phodal/pero/actions/runs/41849393828) reached
the product restart check with an English App inside a Chinese shell. App
surfaces cached context sent before the iframe installed its message listener,
then suppressed the identical context at the ready handshake. Context delivery
now waits for ready and resets its cache at each handshake, including iframe
reload. Geometry-only updates still deduplicate context. The cross-origin bridge
regression exercises initial Chinese/dark context, live changes, deduplication
and reload, and runs in the existing Chromium CI job.

Local verification: the Generated/runner command passed 104 tests (five Linux-only
cases skipped on macOS), all six App build contracts passed, and a freshly built
Host passed the complete Paper-to-Data research-import contract. Chromium/RDKit
Viewer acceptance passed all five groups and produced light/dark/narrow screenshots
under `test-results/scientific-viewer-browser/`. The bridge regression failed
before the startup repair and passed afterward. A newly packaged macOS product
restart has not been rerun locally. The separate ARM64 runner-capacity failure
requires another available GitHub runner and has no source repair here.

A passing CI run took about 30 minutes although repository caches hit. Linux
combined compilation with 22 minutes of serial Desktop scenarios. An unbounded
scenario could hide subsequent failures until the job timeout. Meanwhile master
changed beneath a long-running PR, requiring another full run and exposing
unrelated generated-file and fixture integration failures late.

The fix separates independent Desktop scenarios, reuses an exact-revision runtime
artifact, caches previously uncached pinned tools/independent Cargo targets,
and retains complete mode-specific gates. The user subsequently requested normal
Linux-only CI, with all platforms retained in daily/manual full runs. Each scenario has its own timing/failure
receipt and bounded test-owned cleanup. The first split run still took 16m07s with cold build caches and found three
Control Lab failures. The user then authorized ordinary critical smokes with
slow complete scenarios in daily/manual runs. A later cold run still took 14m58s, so the user authorized moving complete
Desktop compilation and GUI to daily/manual too. Ordinary runs now check
independent types, core runtime and real stdio/permission/recovery contracts.
All tests remain in the full tier;
moving a failing test is not treated as fixing it.

Baseline fixes included here do not reduce coverage: Windows npm is launched via
Node rather than executing a `.cmd` file directly; the ACP presentation fixture
explicitly accepts the existing built-in HTTP connector configuration; MCP user
server assertions still independently validate that built-in connector. The
source TypeSpec generator initially removed orphan Terminal types found only in
the generated output. A later master added the actual Terminal source and
implementation: the fast contract gate detected the changed merge input in 19
seconds, before compilation. After synchronizing that master, regeneration now
retains its complete Terminal contract. This early failure is not a passing
ten-minute CI measurement.

That master also introduced an external Point SDK/runtime build prerequisite
without a CI supplier. At the user’s request the unused external adapter, its
private Project binary and dedicated routes were removed, rather than bypassing
the build check or copying external source. Ordinary Pero App installation,
preparation, backend permissions and Terminal remain. Desktop builds and runtime
artifacts no longer require a Point checkout.

The first independent-core run exposed a real Worker journal ownership race:
closing the owner's file descriptor does not release a Unix flock while a
forked/duplicated descriptor still refers to the same open-file description.
A deterministic duplicate-descriptor regression fails on the prior code without
sleep or parallel scheduling assumptions. A private non-cloneable lock guard
now explicitly unlocks at the owner boundary, including errors after acquisition;
a failed acquisition never creates that guard. The regression retains exclusive
ownership and proves an old alias cannot release a subsequent owner's lock.
The original durable-claim and cross-platform reopening assertions remain.
See the [flock ownership contract](https://man7.org/linux/man-pages/man2/flock.2.html).
This is a correctness repair, not a retry or removal of the failing test.

The core-only ownership run also exposed an undeclared build prerequisite:
Host MCP Apps needs its real Node provider plus panel/sandbox HTTP assets, which
previously came from the complete Desktop build. Core now builds those three
small JavaScript outputs through the same shared builder as Desktop. A correlated
Host MCP error fails the ownership test immediately instead of being discarded
until timeout; all real configuration, HTTP and teardown assertions remain.
The positive reproduction starts with no Desktop dist directory and only these
three outputs, avoiding stale local build artifacts as hidden prerequisites.

The incident remains open until real Actions measurements demonstrate the target
and full coverage on the new exact head. See `docs/fitness/ci-feedback.md` for the
baseline, coverage mapping, cold/warm distinction and measurement procedure.

New master changed workspace lock inputs back to patched GPUI. Core supplies the
same pinned public manifests through the existing wrapper while compiling only
core crates. Self-contained Automations/Scientific Viewer unit/type and actual
Host stdio contracts run in ordinary CI. Full acceptance retains the original
fifteen shards plus real Scientific Viewer and a separately labeled mock
Automation iframe; the mock does not establish scheduling or Agent correctness.

A later full run exposed a real startup handshake race, not a lazy chat session:
Desktop's initial two-second connection query returned `error.host_wait`, then
Host became ready while WASM/GPUI initialized without an event subscription.
The renderer later applied the obsolete disconnected snapshot, despite receiving
Agents and workspace history. Bootstrap now subscribes after the renderer is
ready, then queries current Host state; a live lifecycle event supersedes a
pending query snapshot. Deterministic regressions cover both event/query orders.
The Workbench smoke still requires connected, session-ready, streaming, cancel
and permission behavior; its existing owned-Electron cleanup now bounds early
failure teardown instead of consuming the entire six-minute scenario deadline.

## 2026-11-03 Data runtime artifact boundary

Full run [41563066420](https://github.com/phodal/pero/actions/runs/41563066420)
failed Data and Data Product startup with an invalid backend readiness line.
The App build generates shared Python parsers in `backend/_core`, but the runtime
archive transferred only App `dist` outputs. The fresh acceptance checkout
therefore installed a backend without those parsers; its source-tree fallback
cannot exist inside the installed profile. An isolated installed-backend
reproduction exits before readiness with `ModuleNotFoundError: No module named
'dataset'` from Data's `inspection.py`.

The runtime archive now requires and checksums each generated parser for Data
and Data Agent. A pack/unpack regression recreates the fresh-checkout and
installed-profile boundary, starts both actual Python servers on loopback,
and verifies authenticated import/inspection retains `9007199254740993`
exactly. It fails with the original archive list and passes with the repair;
missing generated inputs also fail packing. Native/UI outputs in this focused
fixture are placeholders, not Desktop acceptance.

The same acceptance chain had obsolete Paper import assertions for the removed
“Saved references” heading, old saved-resource list class and “Research bundles”
region. Assertions now require the saved bundle's actual title, four rendered
saved resources and the “Paper resources” reopening region. Clone, persistence,
confirmation and transfer checks remain. Browser execution was not retried
locally; full authorized CI must still establish Desktop and Paper UI acceptance.
