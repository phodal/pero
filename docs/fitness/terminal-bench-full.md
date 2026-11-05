---
kind: progress_note
status: running
date: 2026-11-04
---

# Terminal-Bench 2.0: uncapped full-suite run

All 89 tasks are queued in a fresh run without a provider-request ceiling.
The run is still in progress. No full-suite score or completed artifact audit
is claimed. Individual completed results below are diagnostic observations.

Additional source-bound analysis of task incompletion, masked merge failures,
verifier assumptions and context growth is in
[the trace observations](terminal-bench-trace-observations.md).

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
- The pinned original binary still has the default 512-step turn ceiling;
  `dna-assembly` and `schemelike-metacircular-eval` reach it before their official
  deadlines. This is independent of the removed provider-request cap. The original evidence stays intact;
  [the explicit step-limit correction](../issues/2026-11-04-acp-turn-step-limit.md)
  is reserved for separately recorded follow-ups with a different binary.
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

A later [VM termination](../issues/2026-11-04-terminal-bench-vm-termination.md)
interrupts two live trials after 20 completed results. Their native Sessions
and all 21 infrastructure-affected trial directories are retained outside the
resumed job. All 20 result hashes remain unchanged; Harbor resumes the other
69 tasks after the dedicated VM and Rosetta controls are restored. These
interrupted requests contribute to all-attempt usage, not selected verdicts.

Two QEMU tasks later fail during ACP dependency installation, before agent
execution or any provider request. The old Debian 11 package URLs return 404;
their raw results are retained separately in
`debian-bootstrap-failure-20261104T1847/`. A hash-bound adapter-only control
bootstraps the supported ACP Python with the official image's existing
wget/tar/CA prerequisites and normal TLS validation. Recovery changes only that
setup adapter and keeps the original agent binary, task images and official
inputs. Both recovered agents execute and receive raw zero; their official
verifiers subsequently fail to install curl/uvx, so no functional assertions
run. A separate disposable-container control reaches the signed Debian archive
but then fails downloading the unchanged official uv installer asset. This is
not a successful candidate verification. See
[the bootstrap issue](../issues/2026-11-05-terminal-bench-legacy-debian-bootstrap.md).

A later separate v2 control repairs signed Debian archive access and GitHub
resolution inside a disposable container. Its exact generated ACP dependency
command imports successfully; the unchanged official verifier then runs and
produces CTRF (one expected failure on the unsolved bare image). This is runner
startup evidence, not candidate acceptance. Both QEMU cases are added to the
queued corrected follow-ups. The frozen v1 setup and original verdicts remain
unchanged, and the v2 GitHub mapping never changes host or VM DNS settings.

Official test reward, Harbor's reward-validity classification and agent stop
reason remain separate. Usage counts committed provider records once, including
cache reads; interrupted/unreported usage remains unknown. These are recorded
tokens, not an invoice. Full-01/full-02 QEMU attempts and the user-stopped capped
full-03 cohort remain separate from the new score and are included in a separate
all-attempt usage report. Earlier single-task smoke is excluded from that total.

Verifier execution stages are also reported separately from raw rewards. The
C4 trial receives raw zero after a network-dependent fixture setup error;
its official functional assertion is unavailable. Independent failed candidate
self-tests remain recorded. Completion of all 89 attempts and raw verdicts must
not be described as 89 completed functional verifications. See the source-bound
[fixture classification evidence](../issues/2026-11-05-benchmark-verifier-fixture-classification.md).

A later timestamp audit finds continued ACP activity after Harbor's agent
timeout in the COBOL trial. Its raw reward 1 is not a proven deadline snapshot.
Timeout trials without observed late activity also lack termination receipts.
The original running cohort stays intact; per-result timing audits retain
these limits. A [corrected adapter and actual Harbor control](../issues/2026-11-04-harbor-acp-timeout-cleanup.md)
confirm termination before verification, for separately recorded follow-up.

The first uncapped launch accidentally retained full-03's output directory.
It was stopped during setup; both additional trials made zero model requests.
All prior result hashes remain unchanged. Its disposition and original logs
are preserved under full-04's `launch-path-error/`, and the fresh full-04 job
starts at the first task with its own corrected directory.

## Partial checkpoint: 59 of 89 tasks

At 20:52 UTC on November 4, 59 actual-started tasks have selected official raw
results: 22 reward one and 37 reward zero. This is not a full-suite score.
There are 56 pytest-reported results, one C4 fixture setup error and two QEMU
runner bootstrap failures. The remaining 30 slots need uncached official images;
normal Docker registry/auth TLS fails from both host and dedicated VM. The
finite readiness controller makes no model request while waiting.

The hash-bound `partial-baseline-59/` Inspector and receipt retain all 59 result
and native Session hashes. Its 7,145 committed responses record 702,677,790
tokens, including 695,309,943 cache-read tokens. Interrupted requests may have
unknown usage; this is not an invoice or all-attempt accounting. Strict deadline
and step-limit corrections and the separate service-lifetime acceptance remain
pending. Earlier checkpoints and setup failures are preserved.

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
- `chess-best-move`: normal end after 65 requests, reward 0, with no required
  `move.txt`. This cohort's launcher does not declare image input. The model
  attempts pixel-to-ASCII reconstruction and ultimately requests a FEN instead
  of submitting a move. The ACP CLI already provides `--image-input`; the
  provider's API documents image content parts. Neither establishes an actual
  visual success in this run. A separate capability diagnostic is needed;
  this failure cannot be attributed only to coding prompts.
- `caffe-cifar-10`: 1/6 after the official 1,200-second timeout. Dependency
  installation takes about 406 seconds; a foreground dataset download takes
  about 600 seconds before curl times out. Two `make -j8` attempts print fatal
  build errors while `tail` returns zero. Task metadata specifies one CPU and
  2,048 MiB, while `nproc` reports eight visible CPUs. One compiler is killed,
  but there is no retained cgroup OOM receipt establishing the cause. The last
  TaskOutput is incomplete at agent timeout; it is not evidence of an invalid
  tool schema.

Six Cython scratch failures masked by `tail` or trailing successful commands
have source/output-hash-bound reviews. An intentional BN dependency-availability
probe is marked separately. Neither changes shell exits or final judge results.
Two Caffe builds have the same kind of hash-bound review. The offline analyzer
now flags terminal GNU Make error summaries as review candidates; reanalysis
adds two candidates while preserving the 35 responses, 380,379 recorded tokens
and two explicit failed tool invocations. See the
[build evidence fix](../issues/2026-11-04-build-failure-trace-signal.md).

Two offline fixes are pushed separately from the pinned agent binary:
[ACP request-limit termination](../issues/2026-11-04-acp-request-budget-stop.md)
and [native turn-source attribution](../issues/2026-11-04-session-turn-error-attribution.md).
They do not retroactively change benchmark submissions or rewards. The latter
preserves a normal human turn followed by a plugin-notice error during ACP
shutdown; this attribution does not establish a lifecycle root-cause fix.

## Separate cached corrections completed

The two cached step-limit corrections finish with raw zero at the official
1,800/2,400-second deadlines: 444 DNA and 686 Scheme responses. Both have exact
termination receipts before verifier startup and no observed late activity.
The original 59 unique task results stay intact; these are two additional
attempts, not 61 completed tasks. Source hashes, usage, failed calls and a
visually checked Better Harness report live in
`strict-timeout-followup/early-results/`. The remaining 30 original slots are
still blocked on uncached images.

The finite registry controller now resumes readiness checks without model
calls. After successful official-image pull, it admits the remaining task job.
After the full baseline, queued strict/legacy-bootstrap corrections and the
independent service acceptance finish, `verify_after_service.py` runs final
integrity checks and failure triage before writing `FINAL-SUMMARY.md`. None of
those full-suite completion files exist at this partial checkpoint. Registry
wait expiry records an incomplete pipeline and stops only an idle dedicated VM.

## Mirror prefetch and early QEMU follow-up

Docker Hub remains unreachable, but a public mirror passes a cached-image
transparency check: its manifest hash equals the previously recorded original
RepoDigest. The exact-digest HF image download then succeeds with normal TLS.
Only the dedicated VM receives the mirror-CDN address correction; host DNS and
default Docker settings are unchanged. The remaining 30 manifests total 26.52
GiB of compressed layers before deduplication. Their digests are recorded before
download; each downloaded digest and architecture is checked before staging the
unchanged official name locally. New tag digests cannot be independently queried
at Docker Hub during the outage. This transport limitation remains explicit.

`prefetch_mirrored_images.py` and `resume_after_mirror_prefetch.py` replace the
idle origin-only readiness wait. The original 30-task recovery configuration
and its hash stay unchanged. Admission requires all 30 staged images, unchanged
official inputs and no active agent containers. Two cached QEMU candidates run
first with the separately frozen v2 bootstrap, unlimited requests/steps and
official 900-second agent deadlines. The later correction queue reuses these
attempts rather than paying to run them again. Their original raw-zero results
remain intact. At launch, no new QEMU verdict or full-suite completion is claimed.

All 30 aliases subsequently finish staging and verification. The first mirror
completes 19 images before a manifest-content-type failure and rate limiting;
the remaining 11 resume through a second mirror whose manifest bytes match the
frozen digests exactly. The first failure is preserved. The original 30-task
configuration is admitted at 22:40 UTC, with actual image-ID receipts recorded
before agent execution. This recovers transport readiness; full results remain
pending.

The image audit incorrectly derives the dotted Windows trial's container name,
causing a zero-request diagnostic failure. A real Compose control verifies the
correct project/service-label lookup. The other 29 slots continue; Windows is
queued separately with the original binary/configuration and deduplicated by
the completion guard. See the [canonical incident](../issues/2026-11-05-benchmark-compose-container-identity.md).

Both early QEMU corrections finish with raw zero. Alpine ends normally but its
verifier cannot download the exact pinned uv 0.9.5 asset, so no functional
assertion runs. Startup reaches its official 900-second deadline with confirmed
process cleanup, then its unchanged verifier executes and fails 0/1. Together
they retain 382 responses, 25,513,649 recorded tokens and 36 explicit failed
tools in `strict-timeout-followup/bootstrap-early-results/`. These two extra
attempts do not add baseline slots. Rosetta unsupported-syscall diagnostics
occur in 110 tool-output observations, which may reread the same log; that is
not a count of independent crashes or proof of the sole failure cause. The
report and usage view are visually checked.

A subsequent zero-model [syscall control](../issues/2026-11-05-rosetta-qemu-signalfd.md)
reproduces the Rosetta abort with the official image's existing QEMU binary and
an empty machine, before any candidate implementation is involved. A minimal
amd64 signalfd-282 probe also exits 133; its native arm64 equivalent succeeds.
This establishes an independent environment obstacle. Native x86 acceptance
is still unavailable; original rewards and the local full queue stay intact.

## Pinned verifier dependency readiness

The v3 setup correction now passes fresh Debian 11 and Debian 12 controls and
an actual Harbor install/upload trial. Exact upstream uv 0.9.5 and CPython
3.13.9 archives are staged before setup; pytest uses the official versions and
default verifier cache. With GitHub disconnected after setup, the unchanged
official scripts execute one and five assertions on bare images, failing as
expected without candidate work. All three controls make zero provider
requests. This proves runner readiness, not candidate acceptance or reliable
network transport. See the [canonical dependency issue](../issues/2026-11-05-benchmark-verifier-uv-transport.md).

The main queue currently has 69 unique actual-started official raw verdicts,
including 25 reward one; the full 89-task run is still unfinished. One
zero-request Windows image-audit failure remains queued for isolated recovery.
Only idle downstream controllers are replaced with the frozen v10 pipeline.
After baseline completion, it reuses the four completed early corrections and
uses v3 for the remaining selected timeout/step/verifier-bootstrap corrections
and the independent current-code service acceptance. Original results and all
earlier freezes are retained. Final integrity checks, failure triage and the
full summary remain gated on every required phase finishing.

## Final image alias readiness correction

At 76 actual-started verdicts and 29 raw reward-one results, `overfull-hbox`
fails before setup with zero requests: the final original alias retains the
first mirror's `application/octet-stream` descriptor. The second-mirror
reference has the correct manifest type and layers. Earlier architecture
checks establish readiness of that mirror reference, not every final alias.
A fresh inventory finds this defect on only one of the 30 original aliases.

Replacing only that alias descriptor preserves its frozen digest and image ID;
an actual disposable container starts the original alias and exits zero.
The unrelated main queue resumes. The idle setup-recovery controller now
queues both this slot and Windows after the main queue; both zero-request
failures remain retained and counted. Candidate verdicts and full completion
are still pending. See the [canonical alias incident](../issues/2026-11-05-benchmark-image-alias-media-type.md).
