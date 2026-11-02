# App SDK code surfaces

Point's source workbench requires code components in addition to App/Agent
declarations. The first COBOL migration used a plain `pre`; it proved analysis
wiring but did not preserve the source workbench experience.

`@pero/app-sdk/ui` now exports the following presentation components, adapted
from Point SDK at `872cbf87d` with its Apache-2.0 notice retained:

| Contract | Supported behavior |
| --- | --- |
| CodeViewer | Immutable document identity, COBOL/Java/SQL/JCL/JSON/JS/TS/JSX/TSX/CSS/HTML grammars, line offsets, cursor callback, source-range folding, search, line marks and reveal-by-line. Plain remains unparsed. |
| CodeEditor | Controlled Mermaid draft editing, indentation, history/undo/redo, disabled/read-only state and ARIA field attributes. It does not write files. |
| CodeCompare | Read-only text differences or explicitly mapped blocks, independent source line offsets, mapped scroll following, review comments and active-block callback. Mapped panes use the existing Split/Pane keyboard, resize and narrow layout behavior. |
| CommandLine | Read-only highlighted command text; no shell execution. |

CodeMirror packages are pinned to Point's versions. React is a peer dependency;
the App build retains a single React runtime. Unused lazy surfaces can be removed
by the bundler. No Point Host/runtime package is imported.

This is **code surface alignment**, not complete App SDK parity. Point FileTree/
TreeView, structured tables, menus/dialogs and Host Project/Run/prepared-method
contracts still require separate migration checks. No LSP, completion, native
execution, disk editing or business acceptance is implied.

Point's independent `SourceAnalysisPanel` now requires a host-supplied source
renderer. Its Pero adapter uses CodeViewer, with document identity bound to the
snapshot digest and file path. The App passes paragraph/program/record ranges,
diagnostic line marks and source navigation. There is no plain-text fallback.

## Verification

```sh
npm run typecheck --workspace @pero/app-sdk
npm test --workspace @pero/app-sdk
npm run check
node tests/e2e/app-sdk-code.mjs
```

The last command serves a browser fixture until stdin receives `stop`. Its source
mapping test retains unmapped gaps and chooses the narrowest explicit block.
Actual browser actions verified:

- Read-only typing preserves the source; Go to MAIN reveals absolute line 107.
- Search finds all four AMOUNT references; folding omits the explicit body range.
- Changing documents removes old diagnostic line marks.
- Editing changes the draft callback, undo removes the edit, redo restores it;
  disabling makes the content non-editable and preserves the draft.
- Both mapped source/target offsets and review notes render. Switching to text
  differences produces change marks, retains the same review note and clears the
  mapped active-block result. Switching back retains working pane keyboard resize.
- Dark/light surfaces were visually inspected. Browser console errors/warnings
  were empty in the SDK fixture.

The owner-built COBOL App was also rebuilt with this SDK and inspected against
its real Node backend: graph MAIN → source line 11, COBOL highlighting, folding,
search and bilingual theme context. This is browser transport verification;
no new packaged Desktop/native approval click or real-model acceptance is claimed.

Evidence is under `test-results/app-sdk-code` and
`test-results/point-cobol-app/browser`. The SDK fixture and App/backend fixture
are separate evidence. Existing Host/Agent approval behavior is unchanged.

Implementation is on `codex/app-sdk-code-surfaces` in the isolated worktree:
the original worktree had an incomplete rebase with unrelated Paper conflicts.
Those conflicts and the rebase controls were left for their owner.
