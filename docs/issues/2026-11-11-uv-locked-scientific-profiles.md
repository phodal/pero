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

## P0/P1 completion pass from master 5072cbc6 — 2026-11-11

Original #163 remains the acceptance source. Review before implementation:

| Original requirement | Already delivered | Remaining implementation / verification |
| --- | --- | --- |
| Trusted uv / requested-resolved-observed identity | Fixed artifacts for locked Control, exact build and install observation | Remove legacy PATH installer trust; structured blockers |
| Full native uv lock / immutable publication | Control lock, new prefix, atomic catalog, cache and recovery | PC-Gym managed recipe; explicit cancellation; network/interruption/concurrent gates |
| Project declarations / review proposal | None | Read bounded project declarations into a reviewable proposal; never execute/install on inspect |
| PC-Gym freeze / approval / EnvironmentUse | Separate observed ScientificPython, original private approval and CLI owner | Managed selection; actual package-content identity; production Use and attempt link |
| Control numerical / fixed ngspice | Independent Python numerical execution | Freeze actual ngspice path/version/bytes at admission, use that executable and reject drift |
| Minimal user UI | Control create/prepare/rebuild/select/logs | PC-Gym selection, cancellation and source review/blocker presentation |
| Real acceptance 1–7 | macOS Control integration and history retained | Real PC-Gym smoke/checker/cancel; native solver drift; failure/restart; Linux CI configuration/run status |
| P2 Pixi | Fixed-source analysis | Only implement for a demonstrated native dependency conflict; does not block P1 |

Use transitions remain the Rust core's responsibility. Existing Python owners
retain scientific admission, approval, process cancellation and attempt records;
private transport will carry their frozen and stopped receipts to that core.

Implementation/verification pass completed on macOS: managed PC-Gym fixed
recipe/lock and original approval→freeze→Rust Use→real attempt, complete scientific
process-group stop proof, actual managed ngspice identity, preparation cancellation
and structured failure stages, and local/pinned-GitHub declaration review are now
implemented. Real Electron method selection/cancel/proposal/light/dark/narrow checks
passed. See the [requirement-by-requirement production report](../fitness/uv-scientific-production.md)
for commands, exact evidence and limitations.

Shared UI changes: Control-only compute tab becomes Compute with the existing
Select component for fixed methods; current bindings are shown per method. Existing
prepare/rebuild/history behavior remains, with a cancel action, explicit failure
stage and a Disclosure containing the read-only project review form. No new token
or page-local control style was added. Production Use remains the original Rust
state machine, with the original Python scientific owners and existing Paper approval.

P0/P1 implementation for this pass is delivered with the real macOS evidence above.
The issue remains open for remaining acceptance review: the coordinated Linux
workflow is integrated and awaits publication/execution; Native, signed package and Windows execution are
unverified. Extra uv artifact digests/layouts are verified, not execution acceptance.
The P2 Pixi candidate from #59's real Linux ARM native ABI conflict needs a separate
demonstrated resolver fit; no new provider was added. The user requested stopping
new scope after completing this pass.
