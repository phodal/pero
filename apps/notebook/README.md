# Notebook

Notebook is an optional Workbench App for editing and reviewing research records.
Its workspace keeps save/history and formatting controls outside a continuous
reading surface. The notebook list can be collapsed for focused or narrow-screen
editing. Worksheet tools and reference replacement are available on demand,
while formulas, recorded source content and citation status stay visible.
The reusable `@pero/notebook` package owns the document types, formula calculation
and Excel file exchange. The App owns editing and SQLite revisions.

- Edit paragraphs, headings, lists, checklists, quotes and code alongside spreadsheets, evidence, experiments and findings.
- Enter formulas in a cell or the formula bar. Named worksheets in the same notebook can reference each other. Renaming a worksheet updates its formula references. Select a range to copy, clear, or fill down or right with Excel-style relative and absolute addresses. Paste multiline CSV/TSV or import and export `.xlsx`. Single-line comma-containing text stays in one cell. In a notebook with multiple worksheets, each sheet's export action exports the complete workbook so formula dependencies remain present.
- Attach units and versioned evidence references to individual cells. A Finding can cite evidence blocks in its notebook. Reference identity and version are recorded as provided by the researcher; this alone does not verify the source in its owning App.
- Paste a saved Paper Agent citation or passage link into an Evidence block to retain its report digest and exact location.
- Import a Paper report JSON into Evidence or a Control Lab export JSON into an Experiment reference. Choose the exact citation or trial. Notebook preserves the excerpt or recorded checks in each saved revision. Open the source in Paper Agent or Control Lab to inspect the owning record.
- Save revisions, inspect earlier snapshots, and retain the current draft on a version conflict. The Workbench can open Chat with the saved Notebook revision, and authorized Agent tools can make scoped, version-checked edits.
- Copy a group of research blocks into another notebook while retaining its internal Finding and cell citations. Copied blocks receive new IDs; frozen source identities and snapshots stay unchanged. References to blocks outside the copied group still need those blocks in the destination.

From the repository root, install dependencies with `npm ci` and
`npm ci --prefix apps/notebook`, then run `npm run dev:notebook` with a built
Workbench and Host. Notebook is available from the App catalog.

```sh
npm run test:notebook
npm --prefix apps/notebook run typecheck
npm --prefix apps/notebook run build
npm --prefix apps/notebook run test:browser
npm run test:notebook:desktop
```

The browser test uses the built UI, a temporary Notebook database and
Playwright Chromium. To use a system Chromium, set `PERO_CHROMIUM_EXECUTABLE`.
To exercise both source Apps in development Electron, build Notebook, Paper
Agent and Control Lab, then run the Desktop test with
`PERO_NOTEBOOK_OWNER_FIXTURES=1` and `PERO_APP_PYTHON` set to the executable
in a virtual environment with the dependencies from both App manifests.

## Code boundaries

`@pero/notebook` owns document/reference values, reference completeness, worksheet
rename transitions, formula calculations and owner-specific snapshot contracts.
Consumers use its exported package paths. `worksheet` has no editor dependency;
`workbook` adapts those values to ExcelJS. The App projects ProseMirror nodes into
those values, applies one undoable transaction, and handles selection and I/O.
Finding and cell controls share the same editor evidence query while retaining
their different citation policies. A pinned reference or imported snapshot is
not a claim of verification by the owning App.

The Python boundary validates persisted documents and Agent operations; SQLite
owns revision commits and HTTP maps domain/storage errors. Unsupported or corrupt
saved documents return `stored-document-error`, separately from invalid new
requests, and are never silently rewritten. Paper and Control portable snapshot
shapes are checked against the same JSON examples in TypeScript and Python.
Owner-specific digest checks remain at their existing import/storage boundaries.

## Data and format boundaries

Notebook revisions retain cell source, formulas and scientific annotations.
Excel export includes worksheet names, values and formula source. Workbook
formatting, charts, merged layout, and Notebook evidence are outside the XLSX
exchange format. One sheet supports up to 200 rows and 50 columns. Formula
calculation supports scalar results, cross-sheet ranges, error values and cycle
detection. Network functions, volatile functions, external workbook links and
dynamic array spilling are outside the supported subset. XLOOKUP supports exact
and numeric nearest matching with linear forward or reverse search.

Bundled editor and spreadsheet library notices are in [licenses](licenses).

## Agent reads

`read-entry` returns small entries and individual blocks inline. An oversized
entry returns a bounded `block-index` of IDs and types, including nested blocks.
Read the selected `blockId`, or request `view: "index"` with `offset: nextOffset`
to continue discovery. Always pin subsequent reads to the returned `revision`.

An oversized block returns `json-chunk` content. Requesting `offset: 0` also
starts a complete document read, including nodes without IDs. Continue with the
same entry, revision and optional block ID until `nextOffset` is null, then join
the content strings and parse the resulting JSON. Offsets count Unicode
characters. Use the pinned revision as `baseRevision` when applying edits.

Persisted documents with unsupported schema versions or unknown attributes are
refused rather than opened and silently rewritten by an older editor.
# Notebook Interop v0

The App Use action `describe-notebook` posts `{entryId, revision?}` to
`/api/interop-describe`. It describes one saved Notebook revision, its supported
formats and evidence references. Omitting `revision` observes the current saved
head; the reply always pins the actual revision. A resource revision identifies
the saved object, while `snapshot.sha256` identifies the UTF-8 bytes returned by
`NotebookDocument.serialized()`. Reassemble `read-entry` JSON chunks at that
revision before checking the digest. Neither identifier is scientific acceptance.

The returned `pero-app-location://notebook/main/entry/<id>/revision/<n>` opens the
existing read-only revision view. New edits and new experiment results leave old
descriptions and Findings resolvable. JSON is the complete entry exchange; `.ipynb`
exchange applies to an embedded document, HTML is a publication snapshot, and XLSX
exchanges worksheet values/formulas/names rather than the entire evidence record.

The descriptor declares read/edit/export, and explicitly has no execute/cancel
action. `apply-edits` still requires its existing Host grant and `baseRevision`;
its `propose_reference` operation creates a proposal for existing review. Control
Lab, Paper Agent and Host Projects retain their current execution, verification,
source and association ownership. This adds no global Host protocol or kernel.
