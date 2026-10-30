---
kind: incident
status: resolved
---

# Optional App catalog failure blocks File checkpoints

## What

The actual 100k-row File suite reached its first edit on the release-Wasm
`pero-content-release-OE8qKa` snapshot. Awaiting `peroWorkspaceCheckpoint(false)`
returned, but the disposable profile had no `settings.workspace/session.json`.
Its diagnostic capture reports an App catalog error (`App entry is missing:
dist/index.html`) and no File error. The profile is `pero-file-references-8c85IS`;
the snapshot's `test-results/workspace-file-references/failure.json` is the receipt.

## Why and repair

Workspace recovery waited for a successful `apps_catalog` observation. An
`apps_error` completed the optional catalog request without releasing that wait.
The Wasm checkpoint consequently returned no command; its browser bridge treated
that absence as successful persistence despite sending no request to Host.

Both catalog success and failure now finish the startup wait. A catalog error
preserves saved App sources/history rather than implying removal; actual App
opening still requires an available enabled panel. An empty explicit checkpoint
now rejects, and a real command resolves only after the existing Host save ACK.

## Verification

The App availability behavior table includes an unavailable-catalog case.
The existing actual 100k File suite creates a disposable unavailable App store,
observes its error, then requires the normal checkpoint/crash/restart/save flow.
TypeScript and 14 pure UI tests pass. Fresh release-Wasm Desktop verification on
`pero-content-release-tYZGeN` also passes: the optional catalog reports its real
error, the Host acknowledges the File checkpoint, the process is killed, and a
new Host restores the dirty 100k-row draft. Save and Save As write exact contents.
Checkpoint metadata is 3,144 bytes and the edit journal 653 bytes. The receipt is
`test-results/workspace-file-references/result.json`; the earlier failed snapshot
is retained only as reproduction evidence.
