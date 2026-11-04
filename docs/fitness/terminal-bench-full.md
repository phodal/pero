---
kind: progress_note
status: running
date: 2026-11-04
---

# Terminal-Bench 2.0: uncapped full-suite run

All 89 tasks are queued in a fresh run without a provider-request ceiling.
The run is still in progress. No full-suite score or completed artifact audit
is claimed. Individual completed results below are diagnostic observations.

## Frozen execution controls

- Pero source `2f02e684ccf7296e82977a9c831dd21c23b0f7dd`.
- Go 1.27.3 static linux/amd64 binary, `vcs.modified=false`; SHA-256
  `0ed53b5f787cbf3798995bb7402b05d84a55b57b9ea4c4890c8a1ad4b615591c`.
- Terminal-Bench source `2fd12b88aafdd04a52c298e3940bcb189f9766d6`;
  Harbor `8c6bdacc9b9cd5342508179f1296bcbae5f1df36`.
- DeepSeek Flash, thinking disabled, provider-default sampling, deferred tools,
  zero HTTP retries, `--max-requests 0` (unlimited).
- 8,192 output tokens per request, matching DeepSeek's published 8K default
  for non-thinking mode. This is a response limit, not a total-run budget.
  The published maximum is higher; see [the API contract](https://api-docs.deepseek.com/api/create-chat-completion).
- Two concurrent trials, one coding attempt per task. Official agent/verifier
  timeouts, task instructions, images, tests and resources are retained.
- Official amd64 images and amd64 agent execute in the dedicated Colima
  `pero-benchmark-rosetta` VM, using VZ and Rosetta with qemu-x86_64 disabled.
  The default Docker context is not changed.
- Fixed model is selected by the launcher; Harbor does not request ACP model
  negotiation. The launcher's workspace is the actual container cwd.

Independent Go channel, deferred-tool and browser-oracle preflights pass under
Rosetta. The earlier QEMU runtime/verifier failures and evidence are retained
in [the emulation incident](../issues/2026-11-04-amd64-emulation-go-runtime.md).

## Evidence and accounting

The local workspace artifact root is
`/Users/phodal/workforce/openstar-agents/reports/coding-benchmark-2026-11-04/terminal-bench2-full-04/`.
It contains the 89-task manifest, input hashes, binary metadata, exact launcher
diff, Harbor results, image identities, progress journal and per-task reports.
The explicit agent `--session-dir` exports native journals to each trial's
`agent/pero-sessions/*.jsonl`; these do not live in the host's default
`~/.pero/sessions` directory. HTTP attempt audits, ACP JSONL and official CTRF
results are retained alongside them.

On completion, the finite local pipeline selects all 89 results, records any
zero-request setup recovery separately, generates native reports and a labeled
Better Harness Inspector, verifies benchmark input hashes, scans artifacts for
the configured credential value without printing it, and stops only this VM.
An interrupted main job does not trigger automatic setup recovery.

Official test reward, Harbor's reward-validity classification and agent stop
reason remain separate. Usage counts committed provider records once, including
cache reads; interrupted/unreported usage remains unknown. These are recorded
tokens, not an invoice. Full-01/full-02 QEMU attempts and the user-stopped capped
full-03 cohort remain separate from the new score and are included in a separate
all-attempt usage report. Earlier single-task smoke is excluded from that total.

The first uncapped launch accidentally retained full-03's output directory.
It was stopped during setup; both additional trials made zero model requests.
All prior result hashes remain unchanged. Its disposition and original logs
are preserved under full-04's `launch-path-error/`, and the fresh full-04 job
starts at the first task with its own corrected directory.

## Completed observations while the suite runs

- `build-cython-ext`: 11/11 official tests, normal `end_turn`, 88 requests and
  3,006,433 recorded tokens. The preceding capped attempt stopped at 32 and
  passed 10/11. A single stochastic pair does not establish a causal effect.
- `bn-fit-modify`: 7/9, normal end after 33 requests. Parent/child tuples are
  written under reversed CSV column semantics. After self-checks expose this,
  a later check reinterprets the columns instead of correcting the artifact.
  The requested alphabetical direction rule is also misapplied.
- `adaptive-rejection-sampler`: 0/9, ACP `max_tokens`. The implementation
  generation reaches the 8,192 response limit before a complete tool call can
  be committed. This is separate from request-budget exhaustion.
- `break-filter-js-from-html`: 0/1 after the official 1,200-second agent timeout
  and 82 committed responses from 83 HTTP attempts; required `out.html` is
  absent. The interrupted request has no committed usage. The earlier capped attempt
  passed, illustrating substantial attempt variance.
- `build-pmars`: 2/4 with a normal end after 23 requests; the earlier capped
  attempt passed 4/4. No aggregate improvement is claimed.
- `cancel-async-tasks`: 6/6, normal end after 56 requests and 1,291,775 recorded
  tokens, with no explicit tool failure. The capped attempt stopped at 32 and
  passed 4/6. The uncapped attempt remains independent of the earlier smoke.

Six Cython scratch failures masked by `tail` or trailing successful commands
have source/output-hash-bound reviews. An intentional BN dependency-availability
probe is marked separately. Neither changes shell exits or final judge results.

Two offline fixes are pushed separately from the pinned agent binary:
[ACP request-limit termination](../issues/2026-11-04-acp-request-budget-stop.md)
and [native turn-source attribution](../issues/2026-11-04-session-turn-error-attribution.md).
They do not retroactively change benchmark submissions or rewards. The latter
preserves a normal human turn followed by a plugin-notice error during ACP
shutdown; this attribution does not establish a lifecycle root-cause fix.
