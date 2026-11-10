# 0032: AI4S Notebook block editor, sheets and scientific ownership

Date: 2026-11-08
Status: accepted for the Notebook App on `codex/notebook-blocks`.
Implementation and local acceptance are recorded in
[Notebook verification](../fitness/notebook.md) and
[apps/notebook/README.md](../../apps/notebook/README.md).

Extends [local App packages](0007-local-app-platform.md),
[App Use](0014-app-use.md) and
[local research Projects](0028-local-research-projects.md).

This ADR consolidates three survey passes recorded newest-first in chat and
rewritten here in historical order: candidate framing, Tiptap ↔ BlockNote
bake-off, then sheets / scientific ownership.

## Context

Benchling-style research records need different object kinds in one editable
document: continuous prose with selection and paste; parameter tables with
units, stable row/column IDs and per-cell provenance; experiment cards that
open the owning App; findings that cite a frozen run. ChatGPT Pages adds
block-addressable AI edits and stale-write rejection. Interactive Apps stay
behind Host permission and lifecycle. Single-user save, immutable revisions and
a real scientific closed loop come before team co-editing.

The four selection criteria are therefore: block identity across edits; lossless
custom research blocks; safe local AI writes; complex components coexisting with
prose. Collaboration is a later axis.

The decisive layering is not “which editor brand looks richest”:

- the **editor** changes document content;
- the **sheet engine** computes values;
- the **research record** states where a value came from, who produced it, and
  under which revision it holds.

Survey inputs: Benchling notebook analysis, ChatGPT Pages / Space notes, Pero
Notebook design and fitness, AI4Paper evidence contract, Virtual Cell evaluation
shape notes, plus local shallow clones listed under Survey checkouts.

## Decision

1. **Pero Notebook product editor: Tiptap / ProseMirror.** Keep domain structure
   in the product layer. React NodeViews already host Spreadsheet, Evidence,
   Experiment and Finding with `blockId` and structured attrs in versioned
   documents. MIT DragHandle, UniqueID and math extensions remain available.
   Ordinary paste regenerates UniqueIDs, so copying Evidence with citing
   Findings must remap references in one transaction. Strict JSON import must
   refuse unknown nodes without replacing existing prose; default `setContent`
   that swaps the body is unsafe for Agent batches, templates and migration.
2. **BlockNote stays the fastest block-interaction prototype**, not the product
   schema owner. Use it to trial drag, slash menus and nesting. Custom props are
   mainly string / number / boolean; typed tables and experiment state stay in
   the domain layer. Agent tools must address public document block IDs, not
   transient internal ProseMirror node attrs (suggest-mode and live copies can
   share IDs inside the tree while `editor.document` disambiguates).
3. **Both editor paths need an explicit document schema version gate.** Tiptap
   `enableContentCheck` can stop an old client from deleting unknown block
   *types*, but an old client that knows the type and lacks new attrs can still
   strip those attrs without a schema error. Unknown-type default collaboration
   deletes sync back to the origin document unless content checks are enabled
   and errors handled.
4. **Keep ExcelJS and the current formula engine** for embedded sheets and XLSX.
   Values and formula source round-trip; layout, charts and scientific
   annotations live in Notebook revisions, not in XLSX.
5. **Univer is the preferred large-grid / advanced-function candidate**, not the
   exchange replacement. Evaluate open workbook, grid, formula and headless calc
   separately. Official XLSX conversion is commercial
   `@univerjs-pro/exchange-node`; ExcelJS stays the exchange path. Any Univer
   calc path needs acceptance for cycles, blanks vs zero, error propagation,
   dates, volatiles and dynamic arrays.
6. **Pero owns evidence identity and revision; domain Apps own professional
   editing and computation.** Notebook stores bindings, frozen snapshots and
   citations. Paper Agent, Control Lab, Lab, Scientific Viewer and peers remain
   authoritative.
7. **Two product table kinds.** Spreadsheet: formulas, fills, XLSX. Structured
   Input Table: typed experimental inputs with stable `rowId` / `columnId`,
   quantities, units, missingness and per-cell provenance. Agents propose;
   researchers accept. Grids may share rendering later; validation and commit
   rules stay separate.
8. **Near-term closed loop before adopting a new grid:**
   `Paper fixed evidence → structured parameter table with per-cell provenance →
   Control Lab / experiment App → Observation / VerificationReport → Finding`.
   Acceptance walks Finding back to paper and experiment, creates a new revision
   after parameter edits while old conclusions keep prior evidence, and remaps
   block IDs on cross-notebook copy. Only then decide on Univer grid or formula
   layers.
9. **AI writes go through validated domain operations**, not free editor JSON
   mutation. Prose uses block-level text patches; tables use typed
   `rowId`/`columnId` values. Submit checks base revision and current draft;
   duplicate submits return the same operation receipt. Multiplayer later checks
   document schema version before accepting snapshots or updates. Yjs does not
   roll back a transaction after throw; Hocuspocus sync ack and DB persist are
   separate paths, so review commits need independent persistence confirmation.
10. **Point Pages is a separate decision.** If canonical content is chunked
    Markdown + metadata, verify ProseMirror as edit projection (list merge,
    CJK/emoji position maps, attribute retention after local rewrite). If the
    structural tree is canonical, Tiptap + Yjs is more direct and Markdown is
    import/export/AI text. Either route keeps one authoritative document model
    and its own permission, version and commit rules.

Collaboration note: draft sync may use **Yjs + Hocuspocus**; Notebook
`EntryRevision` remains the citable freeze. Interactive App blocks use Host
lifecycle; the document keeps bindings and retained results only. Markdown is
fine for prose input/export; research objects stay typed versioned references.

## 1. Candidate framing

| Candidate | Reuse | Fit and cost |
| --- | --- | --- |
| **Tiptap · MIT core** | ProseMirror schema, React NodeView, UniqueID, table and drag extensions; structured JSON; optional Yjs / self-hosted Hocuspocus | Best Pero product base. Define `StructuredInputTable`, `Experiment`, `Finding` editing separately; assemble menus locally. Markdown extension still Beta. Official AI Toolkit / cloud inject APIs are commercial; own Agent protocol can use the open core. |
| **BlockNote · MPL-2.0 core** | Ready React block UX; `id/type/props/content/children`; custom React blocks, nesting, Yjs | Fastest full-page prototype; also a product candidate. Props suit reference keys and display params. Native block JSON for fidelity; generic Markdown/HTML is lossy. AI, multi-column and some exports are GPL-3.0 or commercial XL. |
| **ProseMirror · MIT** | Full control of tree, schema, NodeView, transactions, position maps; optional Yjs | Best for Point Pages custom projection when Markdown chunks are canonical. Block IDs, menus, maps and sync recovery are all owned work—heavy as Pero’s sole product base. |
| **BlockSuite / AFFiNE** | Typed nested block tree, Web Components, Yjs, snapshots, adapters; Page and Edgeless on one store | Shortlist if Notebook and experiment canvas must share one block set. Pick standalone BlockSuite vs AFFiNE monorepo API generation; license per package (standalone root MPL-2.0). |
| **Lexical · MIT** | Extensible nodes, React, server-operable state, JSON, Yjs | For teams building UX themselves. Experimental Block ID extension exists; identity and clipboard still need acceptance. |
| **Plate / Yoopta · MIT core** | React/Slate; Plate has drag, multi-select, Yjs; Yoopta has block UI and optional Yjs | Worth comparing with Slate experience. Verify indent, cross-block select and post-copy trees. Yoopta order/depth are separate metadata. Plate `next` is v54 beta on Plite and clears undeclared legacy IDs. |
| **Milkdown · MIT** | ProseMirror + Markdown ecosystem, custom nodes, block menu, Yjs | Good for Paper drafts and Markdown-first notes. Full round-trip of experiment refs, cell provenance and custom components needs extension syntax proof. |
| **Editor.js · Apache-2.0** | Light Block Tool API and `blocks[]` JSON | Fine for flat single-user notes. Nesting, cross-block edit and collab are more custom work; collab still on upstream roadmap. Default save can skip invalid blocks—research drafts must retain and mark errors. |
| **AppFlowy Editor · AGPLv3 or MPL-2.0** | Flutter custom blocks and JSON docs | Direct if host is Flutter. Current Lab/Notebook is React/TS; cross-stack cost is high. |

Scientific references (not product bases by themselves): **Curvenote** for cite/math/MyST writing; **Stencila** for executable document schemas and Tiptap research nodes with read-only fidelity placeholders; **JupyterLab / nbformat** and Pero Scientific Viewer for code cells and kernels; **marimo-blocks** for browser Python demos (separate from managed experiment execution).

## 2. Tiptap ↔ BlockNote bake-off

Isolated Chrome fixtures compared **Tiptap 3.33.0** and **BlockNote 0.57.0** on a
paragraph plus a `researchEvidence` block with `blockId` and paper-version
reference. Collaboration used two independent Yjs docs exchanging updates.

| Scenario | Tiptap 3.33.0 | BlockNote 0.57.0 |
| --- | --- | --- |
| Move block, save, reopen | Move keeps block ID. Native JSON keeps refs and nested page attrs. | `moveBlocksUp` keeps block ID. Native block JSON keeps custom refs. |
| In-editor copy/paste | Paste assigns new IDs; refs that entered HTML survive. Sample page attrs excluded from HTML were lost. | Internal `blocknote/html` assigns new IDs and keeps refs. Default Markdown round-trip drops custom block types. |
| Old client, unknown block type | Default collab removed the shared block; delete synced home. With `enableContentCheck` + error handling, block retained and old edits did not write. | Default collab removed the shared block; delete synced home; sample saw no exception. |
| Old client knows type, lacks new attrs | Even with `enableContentCheck`, updating the same block stripped new attrs with no schema error. | Unknown-type only in this pass. |

Source differences that drove the product pick:

- **Tiptap** carries mixed research objects in one document via React NodeViews,
  and separates widget input events from ProseMirror edit events. UniqueID
  reassigns on paste; splitting an empty paragraph can move the original ID to
  the successor—ordinary paragraphs may follow editor rules, research cards and
  template instances need product-defined move/copy/delete/provenance mapping.
  Native table attrs favor merge/display; units, per-cell evidence, formulas and
  commit receipts need typed tables.
- **BlockNote** ships complete block interaction under its document and
  conversion rules. Suggested deletes and live copies may temporarily share IDs
  in the internal tree while the public document disambiguates.
- **Stencila** is the strongest scientific Tiptap reference: `Claim`,
  `Evidence`, `Question`, `Protocol`, `Request`, prose nested inside research
  objects, and read-only placeholders that keep structured payloads for
  not-yet-editable nodes. Its sync client can clear uncommitted local buffers on
  some server updates; Pero should keep its own stale rejection and draft
  retention.

Acceptance shared by both candidates (data left after edit matters more than
chrome):

1. Reorder, copy, restore—move keeps ID; copy gets new ID with frozen source;
   reopen recovers units, formulas, per-cell provenance and experiment versions.
2. AI local edits—Markdown for prose, typed ops for experiment blocks; conflict
   when the user edited the same block/cell; paragraph edits must not drop
   adjacent tables, cards or layout metadata.
3. Mixed UX—CJK IME, cross-block selection, rich paste, drag, undo; arrow/delete
   behavior when focus is inside a grid or embedded control.

Still unverified on real Notebook: legacy migration, system clipboard, CJK IME
and multiplayer with permissions plus persistence.

## 3. Sheets, formulas and scientific block reuse

| Project | Role | Integration |
| --- | --- | --- |
| **ExcelJS + fast-formula-parser** | Current stack | Keep for embedded sheets and XLSX. |
| **Univer 1.4.0** | Preferred expansion | Open grid/calc separately; ExcelJS for exchange; commercial converter out of default path. |
| **HyperFormula 3.5.0** | Compatibility oracle | GPL-3.0 or commercial; measured differences on cycles, booleans, volatiles. |
| **FortuneSheet 1.0.4** | MIT React workbook UX | Insert-row path hit `EvalError` under Pero-native App script limits until dynamic JS was allowed. |
| **SheetXL** | fast-formula-parser follow-on | Public entry / `@sheetxl/formulas@0.7.27` empty registry (`formulaCount` 0); full SDK commercial. |

Same small workbook across Pero, HyperFormula and Univer: `XLOOKUP`, `SLOPE`,
spaced sheet names, `IFERROR`, `LOG10` matched. Reproducibility gaps:

| Sample | Pero | HyperFormula | Univer default |
| --- | --- | --- | --- |
| `E2 = E2` | `#CIRC!` | `#CYCLE!` | `0` |
| `C2 = IF(FALSE,C2,99)` | `99` | `#CYCLE!` | `0` |
| `NOW()` / `RAND()` | `#NAME?` | time / random | time / random |
| `SEQUENCE(2,2)` into occupied range | `#NAME?` | `#SPILL!` | `#SPILL!` |

Univer’s `0` appeared after waiting for calc and in the saved snapshot—a cycle
could be treated as a valid measurement in means or regressions. Large-sheet
performance and full desktop Excel parity were not established.

| Block | Reusable projects | In Pero |
| --- | --- | --- |
| Paper evidence, figures, claims | Stencila (Apache-2.0), Curvenote (MIT) | Patterns only; Paper Agent citations + Notebook frozen snapshots. |
| Executable code / outputs | JupyterLab / nbformat (BSD-3-Clause), marimo / marimo-blocks (Apache-2.0) | Prefer Scientific Viewer kernel; freeze code, inputs, environment, output identity. |
| Molecules, reactions, sequences | Ketcher (Apache-2.0), Mol\* (MIT), OVE via `tg-oss` | Prefer Scientific Viewer; Notebook stores selected structure and version. |
| Plates, protocols, receipts | PyLabRobot (MIT); eLabFTW / Chemotion (AGPL-3.0, product reference) | Lab owns models; Notebook links design/execution/observation and labels simulation vs measured. |
| Single-cell / spatial / perturbation | Vitessce views; AnnData/evaluators in domain envs | Blocks store data version, filters, controls, view config, result refs; distinguish mean vs cell-level; retain train/calibrate/independent-eval identities. |

## Alternatives not selected as the primary path

| Alternative | Why not now |
| --- | --- |
| Ship BlockNote as the product schema owner | Faster UX, less control over research structure and typed props; XL features are separately licensed. |
| Replace Tiptap with Lexical, BlockSuite or Plate | Migration cost exceeds research gain for current NodeViews and revisions. |
| Raw ProseMirror as Pero’s sole base | Right for Point Pages projection work; too much UX ownership for Notebook first ship. |
| Replace ExcelJS exchange with Univer Pro converter | Commercial dependency for XLSX even for single-user edit. |
| Adopt HyperFormula as default engine | License gate plus measured semantic differences. |
| Embed FortuneSheet as-is | Dynamic-eval insert-row fails under App script policy. |
| Put professional editors inside Notebook blocks | Duplicates App authority; Notebook stops being a provenance/revision record. |

## Implemented domain seams

The Notebook package owns `ScientificReferenceState`, `ReferenceSnapshot` and
`NotebookWorksheet`. Reference completeness has one pure definition; the App's
shared evidence projection supplies both Findings and cell annotation controls.
It does not combine their different citation policies or imply owner validation.

Worksheet rename is a pure value transition that validates the name and rewrites
unambiguous cross-sheet formula references. The ProseMirror adapter maps its result
to one undoable transaction. ExcelJS imports the same worksheet name rule; the
package does not depend on React, ProseMirror, Host or the HTTP backend.

Python and TypeScript must each validate their external boundary. A shared JSON
snapshot corpus checks their portable Paper/Control shape contract, while
owner-specific import and digest verification stay separate. The store gives
unreadable persisted revisions a distinct error from invalid incoming documents.
No generic service, repository or validator framework is introduced.

## Consequences

- Notebook continues on Tiptap / ProseMirror, ExcelJS and the formula subset in
  the App README; BlockNote remains a prototype harness.
- Document schema versioning and unknown-attr policy are required before shared
  drafts, regardless of editor brand.
- Structured Input Table and per-cell provenance are product follow-ons, not a
  reason to swap editors.
- Univer may arrive later behind calculation-strategy and commercial-exchange
  gates.
- Cross-notebook paste remaps research IDs with citing Findings in one
  transaction.
- Multiplayer draft sync, if added, uses Yjs for working state and
  `EntryRevision` as the citable freeze.
- This ADR does not accept large-sheet performance, full Excel parity, Native
  GPUI packaging, live Agent execution, physical lab validation, system
  clipboard parity, CJK IME acceptance or permissioned multiplayer persistence.

## Survey checkouts

Editor / collab / scientific writing (bake-off era): Tiptap `5fd5d2f`,
BlockNote `262fb81`, Stencila `56f5721`, ProseMirror meta `91851b0`,
prosemirror-model `819b986`, state `57d4a96`, view `5f28efa`, Yjs `9ea3a4f`,
y-prosemirror `f89fadd`, Hocuspocus `576fa10`, BlockSuite `5cb5cb6`,
AFFiNE `4ac1636`, Lexical `9df2d28`, Plate `25dbbe0`, Yoopta-Editor `070349b`,
Milkdown `0655111`, Editor.js `cfbf1da`, AppFlowy Editor `01eccc6`,
Curvenote Editor `c601b99`, JupyterLab `1c917ab`, marimo-blocks `7fc5fd3`.

Sheets / ELN / domain components (ownership pass): Univer `f1714b3`,
HyperFormula `187dfa1`, FortuneSheet `9434660`, ExcelJS `5bed18b`,
fast-formula-parser `ed38a50`, SheetXL `0e96d8b`, eLabFTW `b090a72`,
Chemotion ELN `a8b47c7`, Ketcher `5b93c2a5`, Mol\* `6682cc9`,
tg-oss / OVE `3909b79` / `453ce25`, marimo `b737e83`, PyLabRobot `dbe1beb`.

Judgments remain source-level selection notes unless named in
[Notebook verification](../fitness/notebook.md). Current App runtime evidence
covers package and backend tests, browser App flow, and development Electron
source reopening.
