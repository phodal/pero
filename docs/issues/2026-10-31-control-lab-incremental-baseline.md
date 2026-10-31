---
kind: incident
status: open
date: 2026-10-31
---

# Control Lab could not inspect the baseline before iterating

Independent review found that an Agent could not follow the supplied Skills'
baseline → evidence → next candidate workflow. The existing `search` operation
registered the remaining deterministic candidates up to the frozen candidate
budget before evaluating them. A later proposal was therefore rejected when
the budget was full. Conversely, `propose` registered the baseline but ran
only the proposed candidate, leaving no evaluated baseline to inspect first.

The implementation under review adds two Agent actions with no numeric budget
argument. `baseline` registers the baseline if needed and evaluates only its
unfinished search scenarios. `search-next` first completes or retries one
existing candidate's unfinished search scenarios; when all existing work is
complete, it registers and evaluates one candidate in the existing
deterministic order. The original batch `search` remains available for the
human UI and existing clients. The baseline and every new candidate consume
the same frozen candidate budget; the existing attempt and sample admission
rules remain shared by all paths.

Candidate and job changes are prepared before admission, so rejecting an
operation for an exhausted attempt or sample budget does not leave a new
candidate in memory or storage. The Spec's canonical hash and existing
record/export format do not change. Existing records remain readable; future
operations use the current admission policy.

The working-tree Store tests cover baseline, proposal and incremental/batch
mixing, retry, lock, exhausted budgets and reopen. A macOS Desktop scripted
fixture using the real Host, App and python-control completed baseline, read,
proposal, incremental search, batch search, lock and final verification. All
ten trials completed and the scientific verdict was FAIL; the fixture does not
exercise a model. The run removed its isolated profile and reaped its processes.
Its local receipt is `test-results/control-lab-app-use/result.json`.

The first Desktop attempt, at 2026-10-31 01:15:18 UTC, instead returned
`EngineCancelled: Cancelled before computation` for the first baseline trial.
The Agent transcript had no cancel tool call; the available evidence does not
identify whether a UI request or a backend signal caused cancellation. A single
repeat passed, so the cause remains unknown and no cancellation fix is claimed.
The local screenshot is archived at
`test-results/control-lab-app-use/failure-WXwiuV/failure.png`. The old harness
removed its JSON failure receipt on restart; the screenshot and the recorded
observation are all that remain. The harness now archives prior failure receipts
and screenshots before another run and records their time and paths.

Exact-head CI verification remains pending; no new model request is authorized
under the exhausted six-attempt budget.
