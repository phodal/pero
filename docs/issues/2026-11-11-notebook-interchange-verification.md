---
kind: verification_report
status: partial
date: 2026-11-11
github_issue: 195
github_state: open
github_url: https://github.com/phodal/pero/issues/195
---

# Notebook interchange corrections on PR #196

This is supporting evidence for the existing Phase A work in [PR #196](https://github.com/phodal/pero/pull/196),
not another active roadmap or completion of phases B/C. Baseline inspected:
`f7059e43b29579f9063922a45b02d340ffb30b93`; the branch advanced during work to
`9488507a1121fa5e5d7d45634e8ec44a60361be9`. These corrections were rebased
onto that head, preserving its BlockDefinition, noteCard, snapshot checks and
EntryStore.commit ownership, and reverified. Master was
`d9f8e8521283265b268a0bd93e51ffd3915e6839`. Verification below covers the
local corrections following that PR head.

## What and why

- The BlockNote projection used `code`, but the pinned upstream block contract
  uses `codeBlock` with plain, unstyled text. MyST uses `code` with one string.
  Other unrepresented root, inline and reference fields could be dropped while
  `canReplace` still returned true. These now produce explicit losses.
- MyST emphasis/strong restore retained only its first child. It now preserves
  every nested inline child. Restore remains a narrow projection adapter, not
  an arbitrary upstream JSON importer. See the [source and license decision](../design/scientific-block-interchange.md).
- A pending reference proposal became impossible to dismiss after an unrelated
  save. Rejection now checks the current expected revision without requiring the
  proposal's old base, and records its review revision for exact replay. Accept
  still requires the original base. The regression was reproduced before fixing.
- The backend supported `propose_reference`, but the Host-facing App write schema
  did not declare it. Its pinned source fields and standalone proposal semantics
  are now declared; review decisions and permissions are not Agent fields.
- Editor readonly was inconsistent across toolbar, shortcuts, diagnostics, context
  menus and Save/Restore. Those consumers now share the protected readonly state.
  Original content remains the JSON/Markdown export source when editing is blocked.
- Reference review prefers current proposals, keeps stale proposals rejectable,
  removes completed controls, and retains decision feedback. Fetches follow entry,
  block and revision identity rather than each context render.

No new dependency, upstream runtime, permission bypass, automatic computation,
editor replacement, or changes to the other open PR's Notes-tab implementation.

## Verification

- Notebook package: 161 tests passed.
- Focused editor and declared Agent proposal contract: 7 tests passed. Existing
  React `act` warnings remain. Broader editor suite: 88 passed, 2 failed.
- The two broader failures expect document titles `Method` and `Cross-root
  sources` but receive `Notes`. They match the unchanged PR-head CI failures in
  [run 42926462885](https://github.com/phodal/pero/actions/runs/42926462885).
- Python backend: 130 tests passed with `NOTEBOOK_REAL_OCR=1`, no skips.
  The earlier default run skipped two opt-in OCR cases; both passed in the final run.
- Notebook TypeScript check and production App build passed.
- Generated theme, design, SDK tokens, locales and protocol checks passed.
  Root `npm run check` stops at missing generated `web/src/reader-wasm/pero_reader_web`.
  Icon verification separately stops at missing external GPUI Kit `pin.svg`.
- The extended scientific-block browser regression covers accept/reject,
  consecutive proposals, stale rejection, disabled stale acceptance, reload,
  decision feedback and no duplicate actions. It writes evidence into the same
  `test-results/notebook/` directory retained by CI and uses Playwright's browser
  unless `PERO_CHROMIUM_EXECUTABLE` is supplied.
- This container could not launch Chromium: `socket() failed: Operation not
  permitted` at the browser singleton, including the approved elevated test
  attempt. No screenshot or visual acceptance is claimed for these corrections.
  Browser behavior and screenshots require the PR's normal CI environment.
- Electron, Native and Wasm product flows were not launched. No new-head CI
  success or Phase A completion is claimed from these local checks.
