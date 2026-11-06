# Conversation workspace files

2026-11-07 · macOS arm64 · GPUI Kit 0.9.0 · #145.
Source: `codex/conversation-files-145`, `db0be05d` plus the final presentation and toolbar changes in this PR.
Scientific conversation PR [#150](https://github.com/phodal/pero/pull/150) is already merged.

## Behavior and ownership

The conversation has one upper toolbar: Files / Artifacts, refresh and close.
When collapsed, its existing button reopens the selected view. The earlier duplicate
Files button and inner heading row are removed. Active tabs use the shared selected
button style; the tree uses surface-muted, the reader surface, and shared selection
and icon tokens. Both workbench and standalone Chat consume the shared GPUI panel.

Host resolves the original session workspace. Directory and preview I/O runs off
its input loop; browsing neither starts an Agent nor appends conversation history.
`FileTree` owns expansion, selection, retained listings and stale-reply rejection.
Only direct children are fetched, and only visible rows are painted. Tabs retain the
reader, tree selection and scroll. Wide panels place tree and reader side by side;
narrow panels retain a Back action. Files remain distinct from immutable Artifacts.

## Observed verification

- Real Electron/Wasm with real Host and temporary files: `node tests/e2e/workspace-files.mjs` passed.
  Two sessions stay isolated; nested loading, keyboard Down/Enter/Home/End,
  relative-path copying, tab retention, live reload, directory rename, workspace
  escape rejection and preference restore after restart all pass. Modifying a live
  result leaves its registered artifact unchanged. Conversation history is unchanged.
- A directory containing 2,050 files reports a 2,000-entry cap and explicit truncation.
  The latest run painted **28 rows for 2,000 loaded entries**; this measures virtualization,
  not a filesystem latency or memory benchmark.
- Inspected actual Electron screenshots in `test-results/workspace-files/`:
  `files-light.png` (wide tree and reader), `files-narrow-dark.png` (Back and reader).
  One upper navigation row, readable selected rows and themed surfaces; no duplicated
  Files title. Final selected-state styling was rebuilt and the scenario rerun.
- Actual isolated Native app `com.openpero.scientific-145`: inspected the unified
  toolbar and real molecular workspace, opened the 68-byte request, switched to
  Artifacts and back without losing the preview, then used Back/Down/Enter to open
  the 13,717-byte RDKit result. Request records and RDKit 2026.09.1 were visible.
  Native artifact viewer reports App not installed in this deliberately App-free
  profile; this run accepts the navigation, not installation or embedded App loading.
- Rust value/runtime tests: Chat 26, contracts 102, runtime 127 passed (4 explicit skips).
  Native workbench and Host built separately; all four Wasm outputs, Web and Desktop built.
  `npm run check` passed (996 bilingual messages, 85 icons), with Kit path configured.
- `go -C harness/go test -race ./charts ./acp` passed. Mounted `table_render` and
  `chart_render` each exercise a real default spill with 2,000 exact numeric source
  records and a one-record selection. Complete presentation and source precision
  survive; ACP live delivery and history replay use the complete presentation.
  Gazelle regeneration/check and `git diff --check` pass.

Commands use `PERO_GPUI_KIT_PATH=/Users/phodal/test/gpui-kit` and the repository's
`nightly-2026-10-28`; the pinned checkout is 0.9.0 after synchronization with master.
Earlier 0.8.1 acceptance is superseded for the toolbar by this run.

## Limits and evidence

Each directory returns at most 2,000 entries; there is no paging or global index.
Text previews use the existing UTF-8 reader with a 2 MiB file-size admission limit,
not streaming or large-file performance acceptance. Binary previews, filesystem
writes, remote directories and watchers are not implemented. Manual refresh and
turn completion refresh loaded directories; open files reload explicitly.

Native dark theme, full assistive-technology navigation, signed distribution and
standalone Product runtime acceptance are not established by this increment.
Wasm screenshots do not substitute for Native checks. No fresh GPT request was
needed for UI browsing; earlier real GPT/ACP evidence remains in
[scientific-conversation.md](scientific-conversation.md).

Local machine evidence is ignored by Git: `test-results/workspace-files/result.json`
and its screenshots, plus the real molecular history in
`test-results/scientific-molecules-real-approved/`. Per the user's explicit instruction,
no binary screenshots are committed or uploaded; PR review links this record.
