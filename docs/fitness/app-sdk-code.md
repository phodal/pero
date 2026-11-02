# App SDK code surfaces

`@pero/app-sdk/ui` provides CodeMirror-backed source, draft, comparison and command
components. The complete SDK API is documented in [App SDK](../../packages/app-sdk/README.md).
Upstream attribution and licenses are retained in the SDK NOTICE.

| Contract | Supported behavior |
| --- | --- |
| CodeViewer | Read-only document identity, COBOL/Java/SQL/JCL/JSON/JS/TS/JSX/TSX/CSS/HTML grammars, line offsets, cursor callback, folding, search, line marks and reveal-by-line. |
| CodeEditor | Controlled Mermaid drafts, indentation, undo/redo, disabled/read-only state and ARIA attributes. |
| CodeCompare | Read-only text diff or mapped blocks, absolute line offsets, scroll following, review comments, active-block callback and resizable mapped panes. |
| CommandLine | Read-only highlighted command text. |

`ranges` are foldable source sections; `lineMarks` are custom line decorations.
They do not imply arbitrary character-range annotations, LSP, completion, code
execution or automatic file writes. CodeMirror versions are pinned. Each App
retains one React runtime; unused lazy code surfaces can be tree-shaken.

## Verification

```sh
npm run typecheck --workspace @pero/app-sdk
npm test --workspace @pero/app-sdk
node tests/e2e/app-sdk.mjs
node tests/e2e/app-sdk-code.mjs
```

The first browser test is automated and stores light/dark/narrow screenshots in
`test-results/app-sdk/`. It verifies source rendering together with controls,
menus, dialog portals, SVG and uPlot charts. It is an isolated SDK fixture.

The second command serves an interactive fixture until stdin receives `stop`.
Earlier browser verification covered read-only typing, absolute-line navigation,
search, folding, document-switch cleanup, Mermaid editing/undo/redo, disabled
editing, review comments across diff modes, keyboard resize and narrow layouts.
Its evidence remains in `test-results/app-sdk-code/`.

An owner-built COBOL source-analysis App also used the shared source renderer
against its real Node backend. Browser checks are separate from packaged Desktop,
real-model and business acceptance.
