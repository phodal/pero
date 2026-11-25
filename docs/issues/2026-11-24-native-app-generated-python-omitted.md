---
kind: incident
status: open
date: 2026-11-24
---

# Native App packages omit generated Python modules and hide the startup cause

## What happened

In the macOS Native profile on 2026-11-24, opening Paper Agent displayed
“App backend stopped during startup.” `~/.pero/native/app-startup.jsonl`
recorded four `paper-agent` failures at the readiness stage, each with
`backend_exited` and exit code 1 (127–217 ms). Data and Notebook failed with
the same exit code shortly afterward. The visible details contained no Python
exception or repair action.

Replaying the installed Paper backend with the profile's selected Python 3.12
environment, Host-style isolated environment variables, and a disposable data
directory exits with `ModuleNotFoundError: No module named 'pero_source_tools'`.
The same isolated replay reports `No module named 'pero_source_tools'` for
Notebook and `No module named 'dataset'` for Data. Declared pinned packages
in the selected environment are present at their expected versions.

The workspace source contains `apps/paper-agent/backend/pero_source_tools.py`,
`apps/notebook/backend/pero_source_tools.py`, and Data's `backend/_core/`
modules. Those are generated or copied inputs ignored by Git. The installed
`/Applications/Pero.app/Contents/Resources/app/apps/` payload and the copied
`~/.pero/native/apps/` payload omit them. Staging the current workspace with
`stageBuiltinApp` does include the files, so this evidence identifies an
incomplete packaged payload; it does not identify which release command or
source snapshot produced it.

## Why the visible reason is generic

`AppProcess::start` inherits the backend's stderr and converts an early exit
to the fixed string “App backend stopped during startup.” The Host startup
diagnostic deliberately records only stage, code, exit code and signal; its
contract test asserts that backend stderr is absent. The Native error panel
then displays this fixed string and a generic retry/update hint. The actual
Python traceback is therefore unavailable from the panel or the persisted
startup record.

## Resolution criteria

- Require generated Python modules to exist before staging or releasing every
  affected builtin App, and exercise imports from the staged payload without
  relying on the source checkout.
- Verify a rebuilt macOS package and a fresh Native profile open Paper Agent,
  Notebook and Data with the selected interpreter. Preserve existing App data
  while refreshing the builtin packages.
- Give the user a bounded, actionable startup reason for a missing packaged
  module while keeping secrets and arbitrary stderr out of the UI and logs.

This record is based on the installed macOS `0.1.2` package, the active Native
profile and the workspace at `ef57360a0` plus unrelated concurrent edits.
## Progress on 2026-11-24

The builtin staging path now rejects Paper Agent, Notebook and Data when their
generated backend modules are absent. A source fixture covers each required
file. The Host now recognizes a bounded `ModuleNotFoundError` from an early
Python exit and returns the missing module name with a repair action. Other
stderr stays out of the returned error and the structured startup journal;
the Native failure hint directs users to the details. A real Host stdio
contract reproduced the missing `pero_source_tools` import and checked the
returned error and journal metadata. After generating the backend modules from
their canonical sources, staging each of Paper Agent, Notebook and Data into
disposable directories and importing their modules with the selected Python
3.12 environment passed.

The installed macOS `0.1.2` package remains incomplete. The new source has
not yet been released or installed, and opening the three Apps from a rebuilt
macOS package in a fresh Native profile remains unverified. This issue stays
open until that product acceptance is complete.

## 2026-11-25 rebuilt package verification

The independently mounted DMG verifier now checks the same generated inputs as
staging. A signed test image that omitted `pero_source_tools.py` was rejected
even though the staged App contained it. The rebuilt Native bundle opened
Paper and Notebook in a new profile with the existing managed Python
environment. Data's generated modules were verified inside the mounted DMG.
The full research workflow and its scope are in [release verification](../fitness/release-products.md#native-research-project-handoff-2026-11-2425).
The public package and the Data window still have separate acceptance criteria.
