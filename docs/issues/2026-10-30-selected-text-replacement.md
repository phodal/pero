---
kind: incident
status: resolved
---

# Web text replacement loses a shared selected prefix

The real Electron file-document acceptance replaced `# Edited document` with
`# Unsaved draft` through Chromium text input after Select All. The editor
contained `Unsaved draft`: the shared `# ` prefix was lost before save. The
same source is retained correctly when its new prefix differs.

The pinned gpui-pre-web input importer finds a common prefix/suffix between
the IME mirror's old and new values, but then replaces the entire live
selection with only the differing text. Common text inside the selected range
must belong to the replacement, not the preserved surrounding document.

Repair the existing pinned Web backend patch: cap preserved prefix/suffix at
the old selection boundaries. Keep the real file-editor reproduction in
`tests/e2e/file-documents.mjs`; run the existing composition/shortcut suite as
a regression check. This does not establish physical macOS IME acceptance.

## Verification

The patched release Wasm passes the exact failing Select All / Chromium
`insertText` replacement, retains all 16 bytes of `# Unsaved draft\n`, and
copies that exact source through the actual Electron clipboard. File saving,
external-change conflicts, relative file links and discard/reload also pass.
The existing Web IME suite passes successive Chinese composition, boundary
keys, ordinary editing, shortcuts, and CDP confirmation/cancellation. The
pinned archive and source digest are preserved by the build adapter.

Receipts: `test-results/file-documents/result.json`,
`test-results/ime/pinyin.png`; source fingerprints are recorded by
`scripts/verify-content-reader.mjs`. These are automated Chromium operations;
this change has no new physical IME, Windows/Linux package or upstream merge
receipt.
