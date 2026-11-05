---
kind: verification_report
date: 2026-11-04
---

# Terminal-Bench 2.0: cancellation task smoke run

The first completed coding attempt on `cancel-async-tasks` failed: **one of six
official tests passed**, five failed, no skips, reward 0. Pero reached a normal
`end_turn`; this was a submitted implementation failure. It is one diagnostic
task with a custom request ceiling, not a Terminal-Bench leaderboard result.

## Inputs and controls

- Clean Pero source: `bf6f6fb8faccb704c17e2b089f69b9de7296ef46`.
- Linux arm64 binary, CGO disabled, `vcs.modified=false`; SHA-256
  `d62d767f9eb8e0a4fb8fd1c1107a6949da1014f4b4c36d2eb6a8f7923d0dbf7d`.
- Terminal-Bench source: `2fd12b88aafdd04a52c298e3940bcb189f9766d6`.
  Harbor: `8c6bdacc9b9cd5342508179f1296bcbae5f1df36`.
- DeepSeek Flash, thinking disabled, deferred discovery, provider-default
  sampling, 8,192 output tokens per request, zero HTTP retries and a shared
  32-request ceiling. Upstream 900-second agent/verifier timeouts are retained.
- One completed provider attempt, without official-feedback repair. The source
  task, instructions, environment Dockerfile and official tests are unchanged.
- The reference agent passes 6/6; no-op fails 6/6, both without skips. The same
  official verifier judges the provider submission.

The host's existing default Colima VM was unreachable over SSH and Docker.
A dedicated `pero-benchmark` Colima profile supplies a working Linux arm64
Docker environment without switching the user's active Docker context. Harbor
builds the unchanged official `python:3.13-slim-bookworm` Dockerfile locally.
No claim is made about the benchmark's prebuilt amd64 image or full suite.

A small staging class uploads the pinned binary and neutral plugin, then reuses
Harbor's generic ACP runner and official task/verifier lifecycle. The native
`--session-dir` lives in exported agent logs. The submitted `/app/run.py` is
downloaded before verification as an immutable separate snapshot.

The first integration job failed before any provider request because Harbor
was configured to negotiate a model while Pero advertised only its fixed
launch model. Its pre-prompt Session, empty HTTP audit, exception and reward-0
record remain preserved. Omitting Harbor's `model_name`, while keeping explicit
`--model deepseek-flash` in the launcher, allows the next job to run. This setup
failure is separate from the completed coding attempt; production ACP behavior
was not changed. See the [integration record](../issues/2026-11-04-harbor-acp-fixed-model.md).

## Usage and tool results

| Measurement | Observed |
| --- | ---: |
| HTTP attempts / committed responses | 26 / 26 |
| Uncached input tokens | 12,524 |
| Cache-read tokens | 230,528 |
| Output tokens | 8,259 |
| Total recorded tokens | 251,311 |
| Tool calls / paired results | 25 / 25 |
| Explicit protocol/execution/lifecycle failures | 0 |
| Hash-bound reviewed failed scratch checks with shell exit 0 | 3 |
| Empty discovery / repeated identical calls | 0 / 0 |

Tools were ToolSearch ×1, Write ×1, Read ×4 and Bash ×19. Exact discovery selected
`Read,Write,Bash`; no child agent was used. All observed HTTP attempts have
committed usage. Cache reads are included in the total; this is not an invoice.
Prepared request bodies total 968,942 bytes, including 313,791 retained
tool-result message bytes. These are serialized byte measurements, not tokens.
No spill, reminder or search-continuation branch was established by this run.

## Failure found through the Session

The required public API is **async**: the official caller awaits
`run_tasks(tasks, max_concurrent)` inside an existing event loop. The submitted
public function is synchronous at line 103 and starts its own `asyncio.run`.
The official caller therefore raises
`asyncio.run() cannot be called from a running event loop`; the task bodies do
not start. Two normal-execution tests fail and all three cancellation tests
observe zero started jobs. Only the file-existence test passes.

The first Write already chose a synchronous public function. Subsequent scratch
checks called it synchronously, reinforcing the changed API. Nineteen Bash
calls explored concurrency, signals, errors and cleanup without checking the
required awaited caller. The final answer describes synchronous blocking and
claims completion despite that contract mismatch. This is a useful negative
case for requiring self-tests to preserve the requested calling convention.

Three scratch-check failures were hidden by a trailing successful `echo`:

- Native result seq 1986: invalid `nonlocal` in a test script caused SyntaxError.
- Seq 2366: `/tmp/t1.py` could not import `/app/run.py`.
- Seq 2422: changing cwd to `/app` repeated the same import error; Python still
  put the script's `/tmp` directory on its import path. Copying the script into
  the workspace finally allowed those checks to run.

All three printed `exit=1`, while Bash truthfully returned shell exit 0. The
reporter's three heuristic candidates are confirmed by source/output-hash-bound
reviews. Original exits and traces remain unchanged. A separate intentional
SIGINT probe printed KeyboardInterrupt and child return code -2 after cleanup;
that expected observation is not counted as another failed tool invocation.

The next prompt experiment should first verify the declared async calling
convention, then concurrency limits and cancellation cleanup. Scratch scripts
should use the intended import context, and validation commands must preserve
the checked process's status. Existing guidance already covers focused checks
and exit preservation; this one run shows model non-adherence, not proof that
adding more prompt text alone will fix it. No production prompt or model
implementation was modified after observing this score.

## Evidence

Local analysis artifacts are under
`reports/coding-benchmark-2026-11-04/terminal-bench2-01/`: pinned source and
binary metadata, staging/launch scripts, both control jobs, both integration
jobs, frozen submission, verifier CTRF/stdout, native Session JSONL, HTTP audit,
ACP JSONL/summary, ATIF trajectory, automatic and reviewed reports and Better
Harness Inspector exports. Credentials, binaries and generated traces are not
committed to this repository.
