# Notebook references in Host research projects

Notebook home now reads actual `ResearchProject` records and lets the user choose an existing Host project to link, update the observed saved revision, or unlink a Notebook entry. Local Notebook project/author display labels remain separate and do not claim project membership, access control or authenticated identity.

## Owner and boundary

- `ProjectResourceRef` admits `notebook/entry`. The fixed Host project catalog reads Notebook's existing authenticated `/api/entries` and produces real saved revision references and `pero-app-location://notebook/main/entry/<id>` navigation. Workbench uses its existing project resource rows, stale-observation display and link picker. Notebook consumes the location through its existing saved-entry loader and retains local drafts.
- The SDK only exposes a bounded Notebook project catalog and specific reference changes through `/host/notebook-projects`. Public responses contain project ID/title and Notebook reference ID/revision, not local workspace paths, project settings or other owners' resources. Nothing uses arbitrary preference writes, remote project membership, new credentials or persistent grants.
- Electron Main and Native require the managed Notebook route. Public operations are list, set and cancel. The shell asks Host to review the frozen choice, obtains an explicit answer using the existing trusted shell confirmation, and only then sends the private apply request. The iframe cannot supply apply, approval, tickets or preferences. A closed origin or cancelled prompt cannot apply the choice.
- `NotebookProjectLink` owns association validation and the transition through `ResearchProject.attach/detach`. Host verifies the entry's current saved revision. Runtime settings atomically replaces only the selected entry reference while preserving all unrelated settings and resources; its expected associated revision rejects a stale choice. A normal `workbench_settings` event updates the existing workbench projection.
- `readOnly` can restrict an operation, not authenticate an editor principal. Current saved revision and the shell's explicit confirmation are independently required. Unsaved and historical views have disabled mutation controls. Project listing retains stale content with an explicit warning after refresh failure and disables further changes until a fresh list succeeds.
- There is no automatic write retry. If delivery is uncertain, the user reloads the real project list and inspects current associations. Association writes are metadata changes, not external account operations or scientific validation. Unlinking removes a reference, never Notebook content.

## Verification

Focused tests cover pure association transitions, stale expected revisions, read-only and malformed choices, runtime persistence with unrelated settings retained, real Notebook resource navigation, shell-origin/private-operation rejection, trusted denial/cancel/page-close, repeated clicks and a retained stale UI list. The real Host fixture extends `tests/contracts/app-canvas.mjs` through `tests/contracts/notebook-projects.mjs` and uses isolated installed Notebook data plus temporary Host settings.

Local TypeScript/React, shell route and Python owner tests pass. Rust compilation, the real Host fixture and Native rendering require the existing CI toolchains; Cargo is absent here. Chromium execution is blocked by the environment's socket restriction, so browser acceptance remains separately pending and is not inferred from component tests.
