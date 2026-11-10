---
kind: incident
status: resolved
---

# Completed science cells must release cancellation ownership

## What failed

[PR #181 CI run 42747146922](https://github.com/phodal/pero/actions/runs/42747146922)
failed `TestScienceSkillArtifactAndSearch` at head
`1922db4e8eaff76d75060a8eed2ed168fe44c7dc`: a later Python cell reported
`write |1: file already closed`, discarding persistent kernel state.

## Why

`Kernel.roundTrip` signals its cancellation watcher at return but does not wait
for it to exit. Harness cancels a tool's timeout context after the body returns.
If the watcher is still scheduled, both cancellation and completion can be ready;
it can choose cancellation and kill the process used by the next cell. The same
implementation exists on the inspected master branch. This is kernel lifecycle
ownership, not Notebook behavior or a test timeout.

## Repair and verification

Retire the cell's watcher before returning and releasing the kernel lock.
Cancellation during an active cell must continue to kill and discard that state.
Regression coverage cancels completed Load and Exec contexts and then reads the
persistent marker, with scheduler contention and no timed sleeps.

Local verification with official Go 1.26.4 on Linux:

- Before the fix, the completed-cell regression failed 23 of 100 repetitions
  under `-race`, including the original closed-pipe error. This is bounded
  concurrency stress, not a deterministic scheduling hook.
- After the fix, 100 repetitions of that regression, the original artifact/skill
  integration test, and the active-cell cancellation test passed under `-race`.
- The complete scienceenv package passed `go test -race -count=10 ./scienceenv`.
- The full Harness module passed `go test -race -count=1 ./...` (37 packages).
- `go vet ./scienceenv` and `git diff --check` passed.

[Exact-head CI on `21e3d513`](https://github.com/phodal/pero/actions/runs/42750510935)
passed Harness Go contracts with Go 1.27.3 and the standalone Harness Bazel
race contracts with its pinned Go 1.26.4. The kernel lifecycle incident is resolved. The unrelated
Notebook browser menu-navigation failure in that run remains tracked by the PR;
this result does not claim the entire run passed.
