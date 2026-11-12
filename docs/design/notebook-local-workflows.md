# Notebook local workflow completion

Original implementation for PR 181, 2026-11-09. Reference semantics are source evidence,
not code or asset reuse. The pinned reference has no confirmed reuse license.

## Source evidence

- Home/provenance and project drawer: [NotebookApp N01–N03](https://github.com/phodal/benchling-notebook-lab/blob/8fd07848a61967ff9046b131b31f034eee5b88cb/ui/notebook/NotebookApp.tsx#L343-L515).
  The source-audited host shows local metadata and a provenance dialog, not a working
  project ownership transfer. Pero's local labels remain distinct from Host association.
- Published templates/fragments: [feature analysis](https://github.com/phodal/benchling-notebook-lab/blob/8fd07848a61967ff9046b131b31f034eee5b88cb/docs/design/notebook-feature-analysis.md#L41),
  [revision semantics](https://github.com/phodal/benchling-notebook-lab/blob/8fd07848a61967ff9046b131b31f034eee5b88cb/docs/design/notebook-architecture.md#L118-L122).
- Host assistance: use shared App Chat / Ask Agent rather than an in-app AI tools
  panel. Historical reference: [AI review intent](https://github.com/phodal/benchling-notebook-lab/blob/8fd07848a61967ff9046b131b31f034eee5b88cb/docs/design/notebook-architecture.md#L149-L164).
- External file/account family: [TFI source index](https://github.com/phodal/benchling-notebook-lab/blob/8fd07848a61967ff9046b131b31f034eee5b88cb/source-index.json#L7658-L7718).
  Missing-source/unmounted reference names establish a requirement, not a functioning
  remote service. Local preview/import is independently defined below.

## Implemented behaviors and owners

- `template-comparison.ts` uses the existing Notebook revision comparison for stable
  block/row identities, moves and full content. Definition labels, collections and typed
  parameter bindings/defaults are also compared. Actual equality is not truncated;
  only display previews and the first 100 changes are bounded. `template-comparison.tsx`
  reads explicitly selected immutable revisions and never upgrades an instance.
- `notebook-home.tsx` displays actual entry/revision, draft status, template instances,
  source identities and embedded-file digests. `backend/notebook_home.py` projects the
  latest 500 saved entries through the existing SQLite/document owner in one read
  transaction. Project/author label selection retains tags and applies through the
  whole-document draft/history owner. Labels do not attest identity or membership.
- In-app Host AI proposal/check generation (`NotebookAITools`, `AIProposalStore`,
  `/api/entries/{id}/ai-workspace`) was removed. Manual recorded-check import remains
  under Scientific tools; agent assistance belongs to Host side chat.
- `file-intake.tsx` stages one selected/dropped local file, hashes its original bytes,
  previews safe images or inert bounded UTF-8 text, allows a local filename/caption,
  and requires explicit insertion. Cancelled/late reads cannot insert. Changed drafts
  require a new preview. Confirmation inserts one normal attachment in editor history,
  so existing export/import, integrity and revision retention rules apply. PDF/Office/OCR
  extraction remains the separate source-extraction workflow after insertion.
- External-account affordances discover installed Connectors, Data and Paper panels
  from the actual Host catalog and recheck availability before owner navigation. They
  create no credentials, grants or remote files. The Notebook does not consume a
  provider file-list/download/sync contract today. Existing Connectors owns account
  configuration and MCP sessions; Data owns `/api/import` and `/api/datasets/update`;
  Paper owns its imports. A downloaded local file is not labelled a remote sync.

## Verification

Focused checks passed on the uncommitted integrated tree:

- Template core and template comparison/UI regression: 4 tests.
- Home/file preview UI and SQLite Home projection tests remain.
- `npm run typecheck --prefix apps/notebook`.

`remaining-workflows-browser-scenario.mjs` exercises real saved labels/provenance,
file preview/confirm/reload and immutable template diff; it also captures wide and
narrow/dark views. It is authored but **not run** here: Chromium's socket operation
is denied in this environment. No browser, Desktop, Native or external account
acceptance is inferred from jsdom or type checking.
