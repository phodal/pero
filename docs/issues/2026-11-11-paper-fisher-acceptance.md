---
kind: issue
status: active
github_issue: 77
github_state: open
github_url: https://github.com/phodal/pero/issues/77
---

# Fisher reproduction: complete the running App acceptance

## What and why

The current Fisher App already freezes input/source/environment/comparison identities,
executes the built-in arithmetic and independent checker, persists attempts and
exports evidence. Historical acceptance stopped before Chromium could launch.
No existing canonical Fisher issue record was found; the numerical and App history
remains in `docs/fitness/paper-fisher-reproduction.md`.

On 2026-11-11 the existing browser runner could not start on macOS: it selected
system Python 3.9 and did not stage the shared PDF parser. The component runners
also resolved SDK imports through different checkout paths when dependencies were
shared, preventing the production component from mounting. Use the supported
Python override, existing parser packager and canonical SDK aliases.

## Scope

Exercise original-source selection, frozen input/tolerance, actual calculation,
rerun, original-cell navigation, evidence export and failure recovery in Chromium
and real Electron/Host. Preserve the numerical checker and fixed tolerances.
The #143 research program and shared execution owners are outside this change.
Independent scientific review, a second paper, Native and signed packages remain
separate acceptance requirements; this work does not close #77.

## Verification

In progress in `codex/paper-fisher-acceptance`, based on `b1b95293`.
Original university-hosted PDF downloaded and checked against pinned SHA-256
`d3a49aaa4f2d283931544f58cb12b1174f537642b83def7ae9119a1d8717b740`.

## Reproduced engineering defects and repairs

- Selecting Fisher opens the notes sidebar and changes the PDF viewport width.
  Automatic FitPage could subsequently restore page 1 over the page-4 source jump.
  `selectFisher` now fixes the current zoom through the existing PDF capability
  before opening the sidebar. The regression checks page 4 after reviewing all
  inputs and after computation, plus the source mark inside the actual viewport.
- An environment failure has a failure report but no result annotation. The UI
  incorrectly called that missing write-back an incomplete handoff even though
  no computation ran. Show that warning only after completed execution. Use the
  existing Feedback component for environment recovery and numerical mismatch;
  no new tokens, controls, comparison rules or execution owners were introduced.
- The CLI integration fixture used macOS's symlinked temporary parent despite
  the CLI requiring canonical paths. Resolve the test's directory; preserve the
  production path admission rule. Other existing PC-Gym tests require canonical
  `TMPDIR=/private/tmp` for the full suite on this machine.

## Completed verification — 2026-11-11

Current issue and PR inspection: #77 remains open; Fisher implementation PRs #160
and #166 were already merged. This change extends their existing implementation.

- 18 original-PDF Fisher Python tests pass with system-default temp directory.
- Complete Paper suite with canonical TMPDIR: 381 tests, 377 pass / 4 skip.
  The first noncanonical run failed 43 tests with errors and one assertion due
  to existing path admission; it is preserved as a failed run, not hidden.
- Production-component state and Chromium transport-fixture suites pass.
- Real Chromium PdfViewer + authenticated Python API passes original selection,
  frozen protocol, real arithmetic, rerun and ZIP export.
- Real development Electron 45.1.0 + Rust Host + installed Paper passes import,
  all 100 inputs, source/annotation equality, absolute comparison, repeated
  attempts, ZIP export and fresh-directory checker, environment failure and
  restoration, a new immutable bounds protocol producing MISMATCH, logs,
  keyboard selection/navigation, dark/narrow, close/reopen and Host restart.
- Paper production App build and TypeScript check pass. No numeric checker or
  default tolerance changed. No model calls or package installs were needed.

Commands, artifact identities and screenshot observations are recorded in
[the Fisher fitness record](../fitness/paper-fisher-reproduction.md#macos-browser-and-electron-acceptance--2026-11-11).
Issue remains active for the broader acceptance boundary: Native, signed release,
independent scientific review, a second non-curated paper and general
Environment/Compute integration are not established by this bounded local case.
