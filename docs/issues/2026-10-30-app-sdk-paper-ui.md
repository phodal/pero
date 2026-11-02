---
kind: issue
status: resolved
---

# App SDK controls and Paper Agent import presentation diverge

The Paper Agent add screen mixes native English file inputs with SDK controls.
Its base stylesheet overrides the Host palette and UI size, while shared App
controls use different geometry from the compact workbench. PDF import sits
outside the search/text tabs, and the title and form use unrelated gutters.

Adapt Point's shared native control implementations into the Pero App SDK,
using Pero theme tokens and compact dimensions. Provide a translated file
picker and shared page header. Use the SDK in Paper Agent, organize search,
PDF and text imports together, and inherit the Host appearance.

Verification must cover actual import and search behavior, keyboard tabs,
translated file choice, light/dark, narrow width and larger UI text. Keep
scientific document typography and existing backend rules unchanged.

## Implementation

Adapted Point's Button, Input/Textarea, Field and Toolbar at revision
`1398de034a3e3fc5e1e216cff762a555d6a4e900` into SDK-owned components. Existing
`@pero/app-sdk/ui` imports remain compatible. Native refs, busy buttons and
associated field descriptions/errors are retained. Added FilePicker and
PageHeader, using Pero's theme variables and compact control spacing.

Paper Agent uses Search/PDF/Import text tabs and translated file selection.
The library header and import body share gutters and a bounded width. Removed
App-local base palette and UI font overrides; search result titles and metadata
also inherit the selected UI size. Search continues to use an event handler:
the managed App sandbox does not permit native form submission.

## Verification — 2026-10-30

L1, macOS arm64 development Electron, working tree based on `2a0e940`:

- Both Apps' TypeScript checks, App builds and `npm run check` pass.
- `PERO_APP_PYTHON="$PWD/target/paper-test-env/bin/python" npm run test:paper`
  passes 15 checks with zero unexpected browser errors. It covers Enter search,
  arrow-key tabs, keyboard file choice, same-filename reselection, Chinese,
  light/dark, blue accent, 24px text, narrow layout, errors, PDF evidence and
  restart recovery. Public sources and Agent output use explicit test fixtures.
- `tests/e2e/paper-harness.mjs` passes six checks with a real cached 26-page
  Meta-Harness PDF and a fixture Agent, including actual upload through the new
  PDF tab, source location and restart recovery. This is not real-model or
  scientific acceptance.
- Virtual Cell smoke edits simulation duration, recomputes results and checks
  light/dark rendering with the shared controls. Screenshots were inspected.

The initial screenshots and receipts were in `test-results/paper-agent/`,
`test-results/paper-harness/fixture/` and `test-results/app-sdk/` (ignored).
A concurrent cleanup removed those directories and the cached real PDF after
the successful runs. Paper Agent and Virtual Cell were rerun with evidence
retained outside the repository in the current Codex chat artifact directory:
`/Users/phodal/.codex/visualizations/2026/10/30/01a18a3a-8d91-7f72-bb94-66fe5f979eae/`.
The real-PDF six-check success remains recorded in this chat's tool output;
its screenshots were not recovered. A later real-PDF rerun stopped before
launch because the cached PDF was absent.
Final Paper Agent bundle SHA-256: JS
`ad82951ae3ce1bb06290cb6dbb70847673776ae71fdae46ae1d16a27d28cc196`, CSS
`8b8125c65ccfc938468334e0f8ec08532a01c7bc12df0ce5afa411a21455117c`.

The existing canvas test entry coordinates were updated for the compact shell;
test Host sessions now select a disposable directory rather than compete for
the developer checkout's write lock. No lock was removed or bypassed.

This changes source and development App bundles. Packaged Desktop installation
and existing installed App copies have not been updated or accepted.

## Follow-up: Research URL resource selection (2026-11-02)

The Research URL screen repeated provenance tags and multi-sentence download
instructions below every title, making resource selection read like a report.
It now uses flat resource rows: identity, version and original link on the left;
file choices on the right. Narrow windows stack each row. Source details open
on demand; unresolved-source warnings and acquisition limits remain visible.
The URL field shares a row with its action, and the save footer retains the
explicit confirmation and disabled state. The Chinese tab is 链接导入.

App TypeScript, build and repository checks pass. Chromium's existing import
journey passes seven checks with zero browser errors, including selection,
reference-only saves, explicit download confirmation, cancellation, failure and
retry, persisted drafts, folded details, column layout and Chinese narrow mode.
These use synthetic HTTP Paper/Host seams; real Python/Host acquisition and
restart behavior are checked separately by the Electron structured-reading
journey. Screenshots were inspected at 1,280px light and 489px dark.
Evidence: `test-results/research-import/` and
`test-results/paper-source-fixes/research-import-{wide,narrow-dark}.jpg`.
