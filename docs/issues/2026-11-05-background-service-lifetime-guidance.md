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
