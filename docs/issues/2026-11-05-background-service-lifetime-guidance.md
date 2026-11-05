---
kind: issue
status: active
date: 2026-11-05
---

# Bash background receipts obscure the lifetime of requested services

The completed `pypi-server` baseline passes its own wheel and source installs
and observes HTTP 200 at native seq 2407. It leaves the server as a managed
background Bash task. After the normal turn ends, seq 3032 records that exact
task terminated with `aborted: true` and `context canceled`; the official
installation then cannot connect. The original reward is zero.

The Bash declaration says "detached" and "durable task_id", but describes
shutdown only as parent cancellation/retirement. A model can mistake this for
a service that survives the ACP process. Foreground `nohup ... &` also remains
subject to command ownership, as the earlier failed startup demonstrates.

State the lifetime in the tool declaration: managed jobs stop when their
agent/session closes. Persistent services need an environment-owned service
manager or daemon with an independent lifetime. Preserve normal cleanup and
the frozen benchmark evidence. A separate current-code acceptance can test
service persistence without rewriting the 89-task baseline or timeout cohort.

Source-bound native/result/verifier evidence is retained in
`terminal-bench2-full-04/analysis-pypi-service-lifetime.json` under the benchmark
artifact root. A guidance change does not itself establish benchmark success.

## Implementation and verification

The Bash declaration now calls the background process a managed job, states
agent/session shutdown explicitly, and explains that nohup/shell suffixes do
not change ownership. Persistent requested services need an environment owner.
The existing background ownership, cancellation and promotion real-process race
tests pass. A separately frozen current-code `pypi-server` acceptance is queued
after the full suite and timeout corrections, with unchanged official inputs
and no request/step caps. Its result will remain separate from both cohorts.

## Deferred service discovery regression

The separate current-runtime rerun at `5a246b02` still fails `pypi-server`
(49 responses, raw reward zero). Its Session discovers standard coding and
background-task tools but never ServiceStart. All four system prompt generations
omit that name. The service guidance incorrectly requires ServiceStart in the
already-declared tools, hiding the entry point while tools are deferred.
The final answer explicitly leaves a Session-owned server; the independent
post-agent probe confirms the process exited and port 8080 is unavailable.

Evidence is in `runtime-rerun-20261105-02/jobs/pypi-server-runtime-01/`
under the benchmark artifact root. Fix the discovery hint against the current
caller-authorized capability pool, without activating tools or advertising a
restricted capability. Preserve that attempt and separately rerun the service
case after the correction. Earlier lifetime guidance alone did not solve it.

The regression test reproduces missing guidance before the first deferred
discovery. The corrected prompt reads the existing authorized pool and supplies
an exact ToolSearch recovery action without activating ServiceStart. Eager,
deferred and restricted callers are covered; all related native race suites
pass. Real-provider acceptance of the correction remains a separate attempt.
