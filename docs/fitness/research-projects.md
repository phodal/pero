---
kind: verification_report
date: 2026-11-02
---

# Local research Projects verification

Scope: [ADR 0028](../adr/0028-local-research-projects.md). This record distinguishes
implemented source and deterministic checks from actual desktop and scientific
acceptance.

## Implemented source

- Stable local research identity, title, goal, optional directory and App resource
  references live in `pero-contracts::research_project`.
- The existing runtime settings path persists
  `WorkbenchPreferences.research_projects`; missing fields restore as an empty
  list. It preserves other settings through the existing writer.
- The workbench overlays saved research entries on the existing directory/shared
  catalog and retains their shared-project association and known checkouts.
- Overview presents the goal and linked records. The existing task, source,
  execution and settings paths retain their roles.
- A Host-acquired public catalog lists Paper papers/studies and Control Lab/Lab
  experiments. Records open in their owning App. Linking, unlinking and explicit
  reference updates change project preferences, not the source objects.
- Catalog loading, unavailable objects, changed observations and read errors are
  explicit states. Catalog observations do not prove scientific validity.

## Completed deterministic evidence

- `node scripts/cargo.mjs test -p pero-contracts research_project`: two tests
  passed. They cover valid/invalid identity and text, optional absolute directory,
  supported App/kind references, stable identity across edits, relinking a new
  revision and unlinking the selected association.
- `node scripts/cargo.mjs test -p pero-runtime settings::tests::preferences_survive_restart_and_preserve_other_settings`:
  passed. The existing temp-file check covers older preferences without the new
  field and persists/reloads a research project while preserving unrelated
  settings.

- `node scripts/cargo.mjs test -p pero-ui --lib research_catalog_preserves_stable_identity_and_unrelated_workspaces`:
  passed. One value table covers title/directory changes with a stable research
  key, directory-free projects, replacement of an existing directory entry while
  retaining its shared ID, unrelated local entries, and shared Projects with
  multiple checkout aliases.

## Acceptance boundaries

An observed catalog revision identifies the public record summary returned by
its owning App. Except for paper content digests, it does not establish a
frozen full source/result version. Reopening a link follows the current App
record; a changed revision requires explicit project-reference update.

No test in the deterministic evidence above establishes real-provider Agent
execution, solver accuracy, reproducibility of a scientific claim, physical Lab
behavior, shared Cloud research Projects, packaged Desktop installation or
production deployment.

## Desktop runtime evidence — passed 2026-11-02

`node tests/e2e/research-projects.mjs` passed against isolated real Electron,
Host and the actual Paper, Control Lab and Lab backends. Synthetic papers and
unexecuted experiment plans were seeded through their existing APIs; no model,
solver or physical experiment was run.

The pointer/keyboard flow verified:

- Creating a project without a directory or account, required-name recovery,
  editing the research goal and retaining identity after renaming.
- Explicitly linking three App records, opening each exact source object, and
  retaining those objects unchanged.
- A failed settings write preserves the saved project and editor draft; retry
  after restoring the file succeeds.
- A symbolic-link directory with a trailing slash is persisted using the Host's
  canonical path, and its actual ROADMAP is loaded.
- Restart persistence, explicit stale-reference update, unlinking without
  deleting the original record, and visible missing-source recovery.
- Light/dark and minimum-window layouts. Screenshots were opened and inspected;
  renderer page errors were zero. Evidence:
  `test-results/research-projects/results.json` and the adjacent PNG files.

`node tests/e2e/local-project-start.mjs` also passed: first-run local browsing,
Overview-to-ROADMAP navigation, sidebar account entry, restart and dark/narrow
layouts remain available without login.

Wasm/web/Host/Desktop development builds, native UI compilation,
`npm run check`, the contracts/UI library tests, Host resource tests and runtime
settings persistence checks passed. Native compilation is separate from native
GUI acceptance. No installed release was rebuilt or production service changed.

## Project navigation — 2026-11-08

Base `1c938e68` with local project UI changes. The project catalog now uses the
shared GPUI list row and groups research projects separately from workspaces and
shared projects. The project header uses the shared dropdown to switch projects.
Project routes remain in navigation history. The window tab strip and its
keyboard cycling use task tabs alongside the existing pane tab behavior.

Research projects open to the goal and an action to link or open materials.
Existing paper, study and experiment links moved from Overview to Materials &
Experiments. The same link revisions, source navigation, recovery and unlink
behavior still apply. Repository and PR browsing has its own clearly named tab.
Local workspaces retain their ROADMAP path under View project tasks. The workspace
path is shown in the overview and execution body so the tab row stays in place.

The running macOS Native Preview was inspected while switching from `pero` to
`pero-ws-b`. The dropdown opened below the heading, showed the current selection
and switched directly to the target overview. The title bar had no project tabs
and the chat toggle was present. The settings and execution headers were checked
visually after moving the path into the page body.

The isolated Electron local-start flow covered keyboard switching to a second
workspace and reading its own ROADMAP without a Cloud account. It also checked
that switching to Settings keeps the tab row in place. The light menu and
narrow dark overview screenshots were inspected in `test-results/local-project-start/`.

The research Projects Electron suite passed using an isolated Python 3.12
environment with the dependencies pinned by Paper, Control Lab and Lab.
Set `PERO_RESEARCH_TEST_PYTHON_ENV` to the prepared environment root when running
`node tests/e2e/research-projects.mjs`. Synthetic records exercised association,
exact source opening, settings-write recovery, restart persistence, stale
references and unlinking. The project overview and linked materials screenshots
were inspected in `test-results/research-projects-workspace-v1/`.

The UI unit suite and repository checks passed. Scientific execution, signed
packages and other Native platforms are outside this verification.
