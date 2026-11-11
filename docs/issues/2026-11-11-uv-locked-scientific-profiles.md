---
kind: issue
status: in_progress
github_issue: 163
github_state: open
github_url: https://github.com/phodal/pero/issues/163
---
# Locked scientific Python profiles

Current named environments use micromamba plus pip, and binding changes the App
service interpreter. Top-level pins and metadata observations do not capture the
transitive installation inputs. #163 has no existing canonical local tracker.

First increment: explicit Host API for a Python-only Control Lab profile, native
uv project lock, same-lock rebuild into a new prefix, and independent computation
binding consumed by the existing ExperimentStore/Attempt. Existing named environments
and App service preparation remain compatible. No new scheduler or live Use authority.

Prepared profiles retain their project/lock bytes, pinned uv identity, exact managed
Python request and observed build/packages. Publish only after inspection. Failure and
Host interruption retain errors; retry installs in a fresh unpublished prefix. Never
repair a published profile in place. Compute selection does not restart the App.

First increment delivered on 2026-11-11: real macOS arm64 cold preparation and
same-lock rebuild passed. Control's service Python 3.14.7 stayed alive while Python
3.12.14 performed actual PI golden trials (analytic max error 1.89e-15). Missing
packages, same-version package-byte drift and changed computation binding refused
execution. Lock mismatch failed safely; Host-interrupted preparation recovered on
explicit retry; cancellation stopped scientific work and historical exports survived
service restart. Runtime: 160 passed / 5 ignored; Control: 54 passed / 1 skipped;
Host App stdio and generated contract checks passed. Cargo.lock is unchanged.

Details, API, exact commands, measurements, fixed Pixi source research and
remaining gates: [verification](../fitness/uv-locked-control.md).
The issue remains open: this is a software/Control attempt slice, not completion of
production EnvironmentUse authority, full approval presentation or the wider matrix.
PC-Gym production Use integration, ngspice identity, signed packages, Native,
Windows, GPU/HPC and Pixi installation remain outside these increments.

UI increment: Environments now separates App service environments from Control
compute profiles. The compute tab exposes explicit create, prepare, persisted
progress/logs, retry, immutable same-lock copy, selection and return to service
Python. Current selection and historical experiment continuity are directly visible;
lock/content evidence is disclosed on demand. Components reuse shared Card, Tabs,
Dialog, Button, Field, Progress, Feedback, Disclosure and semantic theme tokens.
The App service list and Software checks retain their existing behavior; the first
tab is relabeled “App environments” to make the distinction explicit. No obsolete
control/token is removed and no page-local control styling is introduced.

UI acceptance completed in real macOS Electron: explicit preparation with actual
progress, same-lock rebuilding and failed retry, selection without service restart,
historical refusal and return-to-service recovery, light/dark/Chinese/narrow window
and Enter/Escape focus restoration. Runtime 160 passed / 5 ignored; UI 6/6; SDK/root
TypeScript and generated contracts passed. See the verification record for retained
screenshots and the later reopened-history screenshot. This does not close the
remaining production Use, Native or wider environment matrix gates.
