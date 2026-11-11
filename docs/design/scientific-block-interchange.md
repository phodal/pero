# Notebook interchange v1

Status: phase A of [#195](https://github.com/phodal/pero/issues/195).
Merging this phase does not close that issue.

This is the stored-document projection used by the Notebook app. It is not a
second editor, a kernel, or a scientific record.

Pinned sources, read at these commits:

- BlockNote `9eda15fe45f37b614a08e8f6cf9340c12dd3672b` (main, 2026-11-10). Block shape and scalar props: [`types.ts`](https://github.com/TypeCellOS/BlockNote/blob/9eda15fe45f37b614a08e8f6cf9340c12dd3672b/packages/core/src/schema/blocks/types.ts#L575-L591), [`propTypes.ts`](https://github.com/TypeCellOS/BlockNote/blob/9eda15fe45f37b614a08e8f6cf9340c12dd3672b/packages/core/src/schema/propTypes.ts#L8-L28). Editor block id attribute: [`BlockContainer.ts`](https://github.com/TypeCellOS/BlockNote/blob/9eda15fe45f37b614a08e8f6cf9340c12dd3672b/packages/core/src/pm-nodes/BlockContainer.ts#L51-L57). Table cells are inline content: [`TableContent`](https://github.com/TypeCellOS/BlockNote/blob/9eda15fe45f37b614a08e8f6cf9340c12dd3672b/packages/core/src/schema/blocks/types.ts#L519-L545).
- MyST `50e82202324dc36f10bd04877d00016879da6f6e` (main, 2026-11-10). `crossReference` identifies a target, it does not own it: [`schema.ts`](https://github.com/jupyter-book/mystmd/blob/50e82202324dc36f10bd04877d00016879da6f6e/packages/myst-spec/src/schema.ts#L473-L490). `cite` keeps an identifier string and can record `error: 'not found'`: [`ext.ts`](https://github.com/jupyter-book/mystmd/blob/50e82202324dc36f10bd04877d00016879da6f6e/packages/myst-spec/src/ext.ts#L153-L166). Table cells are phrasing content: [`schema.ts`](https://github.com/jupyter-book/mystmd/blob/50e82202324dc36f10bd04877d00016879da6f6e/packages/myst-spec/src/schema.ts#L859-L870). `myst-spec` is MIT and has no runtime dependencies. `mystmd` itself is the document engine and is not embedded.
- TypeCell `a9bd7956e69454f8bf28f3f47b2df9214b73e636` (default branch `staging`, 2024-05-22; `main` merge `c80b9f3059a41900d856be49ed7f64cd2d2d945c` has the same tree). Locked `@blocknote/core@0.13.2` and `@tiptap/core@2.3.2`. The reactive engine re-evaluates registered models automatically: [`ReactiveEngine.ts`](https://github.com/TypeCellOS/TypeCell/blob/a9bd7956e69454f8bf28f3f47b2df9214b73e636/packages/engine/src/ReactiveEngine.ts#L96-L111), MobX `autorun` in [`executor.ts`](https://github.com/TypeCellOS/TypeCell/blob/a9bd7956e69454f8bf28f3f47b2df9214b73e636/packages/engine/src/executor.ts#L216). Root license is AGPL-3.0. Not used as a dependency.

## Decision

| Upstream | What it already solves | This phase |
| --- | --- | --- |
| BlockNote core 0.57.0, MPL-2.0 | Editor block `id`, `type`, scalar `props`, inline or plain `content`, `children`; transactions address that editor id | Adapt the public block shape as an export view. Do not adopt the editor. Pero already stores Tiptap 3.33.0 JSON. BlockNote props cannot hold a snapshot, a unit, or a missing value. `packages/xl-*` are `GPL-3.0 OR PROPRIETARY` and are not imported. |
| BlockNote `TableContent` | Rich-text cells, column widths, header counts | Do not use for sheets or structured tables. Those nodes stay in the notebook tree and produce a loss. |
| MyST `myst-spec` 0.0.6, MIT | `paragraph`, `heading`, `code`, `text`, `strong`, `emphasis`, `inlineCode`, `cite`, `crossReference` | Adapt this subset in our own projection. `data.editorBlockId` reuses the spec's free-form `data` object so a prose export does not drop the editor id. No `mystmd` compiler, transform pipeline, or site build. |
| MyST `cite` | An identifier string plus `error: 'not found'` when the target cannot be rendered | Withhold the cite from a complete export. The loss `myst-cite-not-owner-record` says the string is not the owner fields `app`, `kind`, `id`, and `version`. |
| MyST `si` / `inlineExpression` | Display of a unit, or a JavaScript expression result on the node | Not used. A unit on an input table is not an `si` node, and an expression result is not a Notebook revision. |
| TypeCell reactive runtime | TypeScript/React/MobX cells that re-run when dependencies change, inside its frame package | Do not adopt. A data change must not execute HPC or a paid model. Pero already has explicit owners for sheets, Control Lab, and Scientific Viewer. |
| Pero `ScientificReference` | `app`, `kind`, `id`, `version`, `locator` on evidence and experiment nodes | Reuse it. `readStoredReference` does not switch on a registry. The editor block id stays in `attrs.blockId`. |

`canReplace(projection, target)` is false when that target has any loss. Restore throws rather than writing a partial document over the stored tree.

## v1 subset

The input is a Notebook `doc` with a content array. Complete BlockNote and
MyST restore covers top-level `paragraph`, `heading`, and `codeBlock`. Prose
supports `bold`, `italic`, and `code` marks only. Code blocks contain unstyled
text: the BlockNote discriminator is [`codeBlock`](https://github.com/TypeCellOS/BlockNote/blob/9eda15fe45f37b614a08e8f6cf9340c12dd3672b/packages/core/src/blocks/Code/block.ts),
while MyST uses `code` with one string value. Separate code text segments are
therefore a MyST loss. Restore functions consume this adapter's narrow
projection; they are not general-purpose importers of arbitrary upstream JSON.

Root attributes, inline attributes, invalid editor ids, block marks, and
reference children or extra owner fields produce losses rather than silently
vanishing on restore. MyST emphasis/strong restores every inline child, including
nested spans, instead of retaining only the first child.

A pinned `evidence` or `experiment` reference with `snapshot: null` and no other stored attributes can be restored from the BlockNote view. Its props are strings: `label`, `app`, `kind`, `objectId`, `version`, `locator`. `objectId` is the owner id. The BlockNote `id` is only the editor block id. `templateOrigin` and any other persisted attribute are a loss on both targets, so `canReplace` is false and restore refuses to overwrite them.

These are withheld, and the stored node is unchanged:

- any other mark, including links
- a missing editor block id
- a missing, partial, or unpinned scientific reference
- a non-null snapshot
- `spreadsheet` (`formula-not-exported`)
- `inputTable`, `registrationTable`, `lookupTable` (`table-content-is-not-measurement`)
- every other node, including `section` (`outside-subset`)
- `retainedBlock` (`retained-envelope`)

An unrecognized node with an editor block id is wrapped as `retainedBlock` before the editor sees it. The payload is the original node. Nodes without that id are refused and are not deleted. The Python parser accepts the envelope and still rejects a raw unknown type. Known documents are not rewritten.

The interchange handler map only decides which nodes have a lossless BlockNote or MyST view. Storage and reference proposals use `apps/notebook/backend/block_registry.py`. Registering another block there does not add a name to `BLOCKS` or a branch to `parse_operations`.

## Reference proposals

The Host agent submits `propose_reference` through the existing `POST /api/agent-apply` route, declared in the App manifest write schema and description. That stores one pending proposal and does not change the document or mix with other edits. The same proposal id and body is idempotent. A different body conflicts. The evidence card only accepts or rejects that stored proposal through `POST /api/entries/{id}/block-proposals`, sending the proposal id, expected revision, and decision. It cannot supply a new reference or a permission field. Accept appends one revision through `EntryStore.commit`, which checks template lineage, clears the published draft, and records the decision in the same transaction. Reject does not change the revision and records the revision at which the decision was made for repeatable replay. An old proposal may be rejected at the current revision, but accepting it requires its original base revision. A stale expected revision is a conflict for either decision. The card prefers current-revision proposals, removes reviewed proposals, and keeps the decision feedback visible. A stale proposal remains dismissible with Accept disabled. Both routes use the existing Host token check.

A block enters through one `BlockDefinition`. A new type brings its persistence validator. Evidence and experiment stay on the historical parser and declare a reference capability. That capability accepts only a label and a source. If the block already holds a snapshot, the source must still match that snapshot; the recorded pointer is not a live lookup of the owner object. `noteCard` is the document extension: it has no reference command, and the editor mounts it through `editorAdapter` in `packages/notebook/src/scientific-block.ts`. Adding either kind does not add a branch to `parse_operations`. Historical block types are not moved onto this definition.

The evidence card sends this request only when a saved entry is open. The frame adopts the returned revision. The first real object in the persistence test is the paper report export in `packages/notebook/test/fixtures/snapshot-contract.json`, not a synthetic id.

## Not in this phase

- Replacing the Notebook editor with BlockNote.
- Embedding MyST build, execute, or reactive packages.
- Moving every existing Notebook capability onto this registry. That migration is phase B. The evidence and experiment reference proposal is part of phase A.
- New AI4S blocks for Control Lab, chemistry, or Virtual Cell. That is phase C, and only where those apps already have a real closed loop.
- Yjs, multiplayer, or a second revision store. Notebook revisions remain the citation freeze.
- Electron, Wasm, and Native GPUI were not launched here. The Web app was opened in Chrome against the Notebook backend.

Phase A does not close the Notebook research issue, chat citations (#145), or Skills (#156).
