---
kind: verification_report
date: 2026-11-06
---

# Sol Responses on selected Terminal-Bench tasks

This follow-up expands the earlier five HumanEval+ functions to cancellation,
binary data recovery, dual-language compilation, a deployed gRPC service and
constrained compression. The original independent verifiers accept **4/5
tasks**. These are selected task samples, not a full-suite score or a causal
comparison with the earlier DeepSeek runs.

## Frozen configuration

The Linux amd64 binary is built from master `fbc8c66848ce3cb5102a3538e16fadede9406401`,
with `CGO_ENABLED=0`; its embedded Git metadata records `vcs.modified=false`.
SHA-256: `95abda5596b5b3e7facedf485f069c7d11c59bbe334847b266c7dd99200f3828`.
Harbor is pinned at `8c6bdacc9b9cd5342508179f1296bcbae5f1df36`.
The existing cached Terminal-Bench 2.0 task inputs, original solutions and
verifiers are frozen by file hashes. All five task images are amd64; their
content IDs and registry digests are retained in the machine-readable report.
Publication incorporates the later master `332b282c` architecture/GPUI updates;
its `harness/go` Git tree is identical to the evaluated snapshot.

The configured model is `gpt-6.1-sol` at
`http://187.124.157.143:8989/v1`, using nonstreaming Responses and explicit HTTP
admission. The ignored `.env` supplies the key, forwarded by environment variable.
No reasoning override is sent. Each task has one submission, zero retries,
128 provider requests maximum, a 16,384-token output cap and the original
900-second agent/verifier timeouts. Request timeout is 180 seconds.

The native Claude-style tools use deferred discovery and a neutral plugin.
Tool history uses 48,000/24,000-character watermarks and protects four recent
results. Model compaction is off. The environment service directory is explicit.
The optional engineering profile is off, and no public delivery contract is
added. This differs from older feedback/contract-enabled runtime reruns.

The dedicated Colima Rosetta VM initially reported running while Docker and
SSH were unavailable. Restarting that profile restored access. Its qemu-x86_64
handler was disabled again, leaving Rosetta enabled. The default Docker context
was preserved. This readiness recovery precedes all scored attempts.

## Controls and attempt order

Every task first runs its unchanged reference solution and an empty submission
in separate fresh containers with the same bootstrap and original verifier.
All five references pass and all five empty submissions fail, with zero model
requests. The first four tasks were frozen together. Compression was selected
and frozen as a separate additional hard task before any model submission.
Only credential-free controls overlapped; all model attempts run serially.

The retained bootstrap v3 provisions the original verifier's pinned uv 0.9.5,
Python 3.13.9 and pytest packages. The strict-stop adapter retains deadline
cleanup ownership. No task solution or hidden verifier feedback is inserted
into the model prompt; Harbor supplies the original public instruction.

## Reviewed evidence

| Task | Upstream difficulty | Official tests | Reward | Requests | Tools / failed calls | Reported tokens |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| `cancel-async-tasks` | hard | 6/6 | 1 | 6 | 6 / 0 | 45,747 |
| `db-wal-recovery` | medium | 7/7 | 1 | 9 | 8 / 1 | 70,500 |
| `polyglot-c-py` | medium | 0/1 | 0 | 8 | 7 / 1 | 60,131 |
| `kv-store-grpc` | medium | 7/7 | 1 | 10 | 9 / 0 | 77,411 |
| `write-compressor` | hard | 3/3 | 1 | 8 | 9 / 1 | 72,828 |

All five end with ACP `end_turn`, and independent post-agent probes confirm
their agent processes stopped. Totals are 41 HTTP attempts, 41 reported
responses, 39 tool calls and 326,617 reported tokens, including cache reads.
Usage is reported for every completion; no price or invoice cost is inferred.
All 39 calls have results. No request deadline, interrupted call or zero-exit
validation candidate is detected. The three failed calls are retained shell
exits: missing `python`, an empty file search and missing `file`.

The cancellation submission passes 6/6 official tests. Its local checks and
the independent verifier exercise concurrency/cancellation cleanup in the
generated Python function. This is separate from native TaskStop or Workflow
cancellation acceptance.

The WAL submission passes 7/7. One Bash call returns exit 127 because `python`
is absent. The model inspects installed interpreters, uses `python3`, validates
the repaired WAL and writes the complete recovered JSON. The failed call is
retained in the counts.

The polyglot submission receives reward zero. Both compiler and local numeric
checks succeed, but the model leaves `cmain` beside `main.py.c`. The unchanged
official verifier rejects the file set before checking Fibonacci outputs.
Its one nonzero tool exit is an earlier empty file search. Local program checks
therefore do not establish accepted delivery. See the
[open delivery record](../issues/2026-11-06-coding-delivery-residue.md).
The submission is not cleaned up or retried using the hidden failure.

The gRPC submission passes 7/7. It generates the protocol files, installs the
requested packages and starts the server with ServiceStart. After ACP returns,
the independent probe confirms the agent has stopped and the exact service
receipt is environment-owned and running. The original verifier then calls
that server successfully. A running receipt alone is not the readiness proof.
Harbor deletes the container after verification; this is not a ServiceStop
acceptance.

Compression passes 3/3. The generated stream is 2,374 bytes, below the public
2,500-byte cap, and the independent verifier confirms exact decompression.
The model's local byte comparison also observes all 4,868 original bytes.
An optional `file` inspection returns exit 127 because that command is absent;
the model proceeds using the supplied decoder source and Python. The offline
reporter retains this as one unresolved missing-dependency chain: the absent
inspection utility was not installed, but it was not needed for the accepted
artifact. This diagnostic does not override the independent verdict.

## Relation to earlier evaluations

The [HumanEval+ follow-up](evalplus-native.md#sol-responses-follow-up-2026-11-06)
passes 5/5, and the original coder review acceptance exercises four Workflow
members. This sample adds filesystem and service delivery contracts and
exposes a failure despite successful self-checks. It does not expand the
original coder review into full development/review/merge acceptance or prove
complete Claude Code/Workflow SDK compatibility.

The old DeepSeek polyglot rerun passed with feedback and a public file-set
contract, using 220 requests. The fresh native attempt uses a different model,
output/request budgets and feedback settings. Neither its smaller request count
nor its failed verdict is a controlled measurement of those runtime features.
No automatic prompt/runtime change follows from this single submission.

The researched next step includes OCaml GC repair, a MIPS interpreter that
boots DOOM, Cython/NumPy source compatibility, and SWE-bench repository repairs.
Their source requirements and execution limits are in the
[candidate note](coding-benchmark-candidates.md#harder-concrete-tasks-2026-11-06).
They are not additional completed Sol tasks.

## Retained evidence

Private artifacts remain under this worktree's ignored `test-results/`:

- `claude-openapi-complex-20261106/`: four-task controls, submissions, native
  Sessions, original verifier output, image IDs and independent lifecycle probes.
- `claude-openapi-hard-20261106/`: separately frozen compression controls and
  submission.

Each root retains `manifest.json`, `input-hashes.json`, `runner-freeze.json`,
receipts and audit results. The
[machine-readable report](../design-docs/harness-complex-sol-evaluation.json)
links each verdict to its result and Session hashes. Binaries and raw traces
are excluded from Git. Both final audits confirm unchanged official inputs and
frozen runners, with zero credential-literal matches. No sample containers
remain. Credential values are never report fields.
