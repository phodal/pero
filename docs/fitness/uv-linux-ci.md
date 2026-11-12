---
kind: verification_report
status: verified
---

# Linux locked preparation and scientific Use gate — #163

## Observed run — 2026-11-11

[Run 43018513361](https://github.com/phodal/pero/actions/runs/43018513361)
passed on source `aeb52d34b58040217f3a6ad18a1981fe95681beb` and Ubuntu
24.04 x86_64. Both Control and PC-Gym completed actual locked preparation,
immutable rebuild and recovery, then actual attempts, cancellation and Use
release. The Control gate also ran installed ngspice and the native orphan
process check. Logs, native locks and receipts were downloaded and checked by
the coordinating chat. PC-Gym remains scientifically INCONCLUSIVE; this is
environment/runtime acceptance, not agreement with the paper.

The existing Linux Control job installs manifest dependencies with pip and runs
the numerical engine tests. General Rust test jobs leave explicitly ignored
network tests unexecuted. Neither is evidence of the new managed uv lock,
immutable rebuild or scientific Use bridge on Linux.

`acceptance.yml` (suite `locked-scientific-linux`) adds a manual-only Ubuntu 24.04 **x86_64** gate.
It uses the existing real AppStore preparation and scientific execution tests,
with no new runtime owner, fake solver or browser. All operations run serially
inside one disposable runner and fresh directories. No model API is used.
The ordinary App interpreter remains separate from the managed scientific Python.

The workflow requires the #163 implementation containing all three test entries:

- `apps::locked_python::tests::locked_control_rebuild_and_recovery`
- `apps::scientific_uses::tests::managed_control_attempt_and_cancel`
- `apps::scientific_uses::tests::managed_pcgym_attempt_and_cancel`

It first compiles and lists tests, failing if any entry is missing. Each actual
invocation selects its exact entry with `--ignored`; an older checkout cannot
silently report success by selecting zero tests. Merge the runtime implementation
before invoking the workflow. The workflow does not edit shared `ci.yml`.
The wiring was checked against implementation commit
`7461a7c9e15ff4a0715a45b10fb06aab2e7da157` and the existing built Runtime's
actual `--list` output, which contains all three exact test names.

## Covered path

1. Prepare Control with pinned uv/managed Python, resolve the native lock, rebuild
   into another prefix, reject lock drift and recover an interrupted unpublished
   preparation through the existing AppStore test.
2. Invoke the existing Control trial through its Rust Use bridge: real numerical
   child, changed/missing package refusal, cancellation, release and retained history.
3. Fetch PC-Gym commit `fbfb36bf84b494cd157cff88292e1fd1b864cee5`. Prepare its CPU
   profile through the same owner, with the implementation's explicit PyTorch CPU
   index, then perform the same immutable rebuild and recovery checks.
4. Run the existing managed PC-Gym attempt/cancel test with the actual prepared
   profile. It requires approval binding, Released Use receipts, independent export
   verification and process-owner cancellation. Its Paper metadata is synthetic.

The workflow retains the repository commit, platform, actual resolved Cargo.lock,
logs, profile observations, recipes/native locks and small App/attempt evidence.
It excludes managed interpreters, package caches, installed environments and Rust
targets. Dependency installation has network access; no private account or model
credential is configured. Run/job and individual live-step timeouts bound execution.

## Invocation and evidence boundary

After the complete implementation and workflow are on the selected remote ref:

```sh
gh workflow run acceptance.yml --ref YOUR_INTEGRATED_BRANCH -f suite=locked-scientific-linux
gh run list --workflow acceptance.yml --limit 5
```

Inspect the actual run and `locked-scientific-linux-<commit>` artifact before
recording Linux acceptance. Adding or statically validating this workflow does
**not** establish a passing Linux run, packaging acceptance, Electron/Native UI
acceptance or scientific agreement with a paper.
Local checks parsed the YAML, ran `bash -n` for every command step and compiled
both inline Python snippets. No Linux installation or remote workflow dispatch
was performed during this wiring task.

The local `pero-pybamm-59` VM is Linux ARM64. The managed downloader currently
supports Linux x86_64 and macOS ARM64, so the successful PyBaMM VM evidence cannot
be substituted for this gate. That VM was stopped after the parent #59 replay;
its retained disk and evidence remain available.
