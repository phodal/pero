---
kind: issue
status: active
date: 2026-11-02
github_issue: 79
github_state: open
github_url: https://github.com/phodal/pero/issues/79
---

# Manual research record save blocked by the App sandbox

Desktop CI run `41419531782`, job `125195050862`, failed the existing
`paper-research-import` journey at the first manual record save. The populated
editor remained visible, while the saved-revision feedback never appeared.
Artifact `13130945429` was downloaded and its ZIP SHA-256 verified as
`64703411f02d3ec1d4da64ffcf03d7b2b70fd6cd295a073e1309969ba9ffcab4`.
Its `paper-source-study/fixture/failure.png` shows the editor still mounted;
`failure-view.json` confirms the reading screen and active App.

The record editor depended on native form submission to call its API save.
Production App frames intentionally omit `allow-forms` (`web/src/apps.ts`), so
Chromium blocks that submission before React's submit handler. The previous
component smoke ran as an unrestricted top-level file page and missed this
boundary. There is no evidence here of a slow backend or a remount race.

Keep the sandbox unchanged. Save now explicitly validates the form with
`reportValidity()` and calls the existing guarded action. Enter in the question
input uses the same path; textarea Enter remains a newline, and IME composition
must not save. The existing in-flight guard still prevents duplicate writes.
The component smoke now runs inside the production-equivalent iframe sandbox,
checks required evidence validation before a write, saves by clicking, and
revises with Enter. The Desktop feedback assertion and timeout are unchanged.

## Verification

- Python `test_research_records`: 4 tests passed (including authenticated HTTP
  persistence and reopen); no provider or scientific execution.
- `node --check tests/e2e/paper-manual-records.mjs` and `git diff --check`: passed.
- App TypeScript check passed using a temporary symlink to the existing
  `pero-library-source-unification` App dependencies after byte-comparing the
  App lockfiles. The temporary link was removed; shared dependencies unchanged.
- No local GUI was launched: executor GUI permission remains blocked. The
  sandboxed browser regression and real Desktop journey require the authorized
  CI rerun. This record remains active until that evidence is established.

## Next Desktop run: revision field selector

Run `41423671104`, job `125210996729`, passed the original save-feedback
assertion and reached revision editing, then failed filling Scope. Artifact
`13132302581` SHA-256
`2e47fabb58a82105e6b8d16367a4cf33a26d854c08f3e3adcb187aee011d69f4`
shows the revision editor and saved Scope still visible after Question changed.

This is a separate test selector mismatch: Playwright's `getByLabel` matches
raw wrapping-label descendant text, including a prefilled textarea's initial
text node. Its textbox accessible-name calculation excludes that same control
while traversing its label. Both journeys now use exact textbox role/name
selectors and assert the saved Scope value before editing it. No product label,
assertion timeout, save feedback assertion, or sandbox permission was changed.
The sandboxed component and complete Desktop journeys still need a passing run.
