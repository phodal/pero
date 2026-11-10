---
kind: incident
status: resolved
date: 2026-11-10
---

# Notebook code block mirrors source above CodeMirror

## What failed

Typing in a Notebook code block (language-aware CodeMirror node view) also
shows the same characters in the note body above the block chrome. The
screenshot for an untitled note with a Python block showed `safimpo` once in
the prose area and again inside the editor.

## Why

`NotebookCodeBlock` keeps TipTap's non-leaf `text*` model and renders a React
node view without `NodeViewContent`. TipTap still mounts
`[data-node-view-content-react]` for non-leaf React node views and appends it
to the renderer root before the portal paints. ProseMirror then writes the
same node text into that hole, so the source appears twice: once as plain
body text above the block, once in CodeMirror.

## Repair and verification

Detach that content hole and expose `contentDOM: null` so CodeMirror owns the
editable surface while the document still stores `text*`. Regression coverage
asserts the hole is absent and the source string appears once across editable
and read-only toggles.

`apps/notebook` `npm run test:editor -- test/content-editing.test.ts` passed
the code-block cases; `npm run typecheck` passed.
