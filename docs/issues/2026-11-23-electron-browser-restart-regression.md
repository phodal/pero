---
kind: incident
status: resolved
---

# Electron Browser Use restart regression timed out on stale Workbench Wasm

The launch that timed out had saved both same-URL tabs with distinct IDs in
`settings.workspace/session.json`. On relaunch the renderer stayed on Projects.
The Electron bundle and Host were current enough to write the checkpoint, but
the Vite output still contained a Workbench Wasm build from before the independent
tab restore change (`44ae2503e`).

Rebuilding the Workbench Wasm and Vite output made the existing full Browser Use
regression pass. The source-checkout test entry now rebuilds the Host, Wasm,
renderer and Electron bundle together. A supplied `PERO_CONTENT_TEST_ROOT` still
selects an explicitly staged build. The restart test checks the saved checkpoint,
both restored tab identities and their independent Chromium form state.
