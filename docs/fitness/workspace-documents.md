# Workspace document views

This is the first document-item slice of the [Zed view research](../design-docs/zed-content-view-data-agent-research.md).
It extends the existing content lifecycle rather than creating another navigation owner.

## Source implementation

- `ContentDocument` now belongs to `pero-contracts`. Source identity, revision,
  format and immutable text are independent of Chat rendering.
- `WorkspaceItem::Document { origin, source }` identifies a document by its source
  and typed conversation, file, App or MCP authority. Equal source IDs under different origins do not
  merge. Opening an existing item activates it without duplicating its view.
- The existing `WorkspaceNavigation` selects, cycles, closes and reconciles
  documents together with conversations, projects, tasks and Apps.
- `ContentReader` supplies both inline and workspace presentation. The workspace
  uses the available content height; each view retains its own query, selection
  and focus while sharing the same immutable source snapshot.
- Existing document views receive source revision updates at the Chat event
  boundary. Deleting their source conversation removes unavailable document
  items. Closing a document removes its view, preserving its conversation and
  original result. App iframe visibility continues to use `WorkspaceLayout`.
- `OpenDocument` is a local typed UI intent. It starts no Agent turn and grants
  no additional App or filesystem authority. Standalone Chat shells do not
  advertise a workspace-opening control.

## Actual acceptance

Run `node scripts/verify-content-reader.mjs --functional --workspace-documents`.
The verifier snapshots the sources, builds release Wasm and opens actual hidden
Electron. The fixture supplies Rust code with Unicode and 80 functions; it does
not call a model or execute that Rust code.

The probe verifies:

1. An ordinary code result opens from Chat into a document tab and fills the
   main workspace instead of remaining in the inline result's fixed height.
2. The code language, complete source bytes and source-derived title survive.
3. Command-F and actual typing find a function in the document.
4. Switching to Chat and reopening keeps the same document and reading state.
   Inline and workspace searches remain independent.
5. Closing the tab returns to its retained conversation without removing the
   source or starting another Agent turn.

Screenshots and `result.json` are under ignored `test-results/workspace-documents/`.
Navigation and layout behavior are rows in the existing pure-core test tables.
TypeScript/contract checks and native compilation are separate checks.

## File and App workflow acceptance (2026-10-30)

The source now carries its title and typed authority in `DocumentSource`.
`DocumentHeader` transports that metadata separately from immutable source
bytes. Revision ownership stays with the conversation, Host file buffer or
owning App panel. MCP has a named authority namespace but no resource host yet.

- All textual tool results can enter the workspace, including short Markdown
  and incomplete streamed fences. Markdown retains its rendered child and
  offers rendered/source modes; a completed code source selects its editor.
- Explicit file opening uses the OS picker in Desktop/native adapters. Host
  validates UTF-8 once, owns the file buffer, resolves file-relative links,
  and writes only after its pure save rule accepts the revision and disk text.
- The workspace owns drafts, undo/search state and dirty indicators. Save
  acknowledgement does not replace the editor or erase edits typed while the
  write was pending. Conflict keeps both the draft and changed disk contents.
- Discard is explicit for tab close and disk reload. Window close/reload is
  guarded in Electron; the native equivalent compiles but has no runtime UI
  receipt in this pass. Unsaved drafts are not restored after process failure.
- `openDocument` / SDK `ContentView` lets a managed App open its complete text
  in the same reader. Parent-owned frame identity supplies authority and
  revision; frames cannot supply file origins. Standalone `ContentView` offers
  full readonly text, without claiming the GPUI reader's rich interactions.
- Virtual Cell no longer drops per-condition data or slices result JSON at
  24,000 characters. It opens the complete calculation result in the workspace.

Run, after the repository's font and App dependency prerequisites:

```sh
node scripts/verify-content-reader.mjs --functional --file-documents
node scripts/verify-content-reader.mjs --functional --app-documents
```

The verifier snapshots source, compiles its Host and release Wasm, and copies
its Host executable rather than following a concurrently rebuilt binary. The
App probe rebuilds Virtual Cell from the snapshot's SDK and App sources.

The file probe operates a real temp file over actual Electron -> Host I/O;
only the OS chooser and discard dialog are stubbed at their boundaries. It
checks rendered Markdown, source editing, real save, shared-prefix text
replacement, exact clipboard source, external-change conflict, explicit
reload, percent-encoded relative links, dirty tab close, reload protection,
and reading the current file after reopen. Screenshots and `result.json` live
under `test-results/file-documents/`.

The App probe installs the real Virtual Cell bundle, imports its synthetic
example, runs its Python baseline comparison, opens all 20,021 source bytes,
checks exact clipboard content and App provenance, returns to the same frame
and result, deduplicates reopen, and releases owned documents on App disable.
This proves App integration and computation wiring; it is not scientific
acceptance or a Data Agent/model run. Receipts live under
`test-results/app-documents/`.

## Remaining scope

The complete matrix stays active in
[the implementation plan](../exec-plans/2026-10-30-content-view-parity.md).
Markdown heading anchors and rendered/source selection mapping, Save As,
split panes, navigation history and restart/draft recovery remain incomplete.
Generic Web/native WebView items now have a separate
[Web acceptance record](web-documents.md). MCP Apps negotiation/resource/bridge,
advanced editor/table interactions and the dataset/Data Agent workflow remain
unimplemented. Icon mapping/extension admission and
cross-platform package/accessibility evidence remain separate gates.
The existing large-source incident is still open: immutable text does not yet
share every parse or move the Wasm parsing/IME work onto a worker.
