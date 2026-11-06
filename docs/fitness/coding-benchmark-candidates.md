---
kind: analysis
date: 2026-11-04
---

# Coding benchmark candidates after the tool-call audit

Start with Terminal-Bench 2.0 through Harbor's existing ACP integration, then
add SWE-bench Verified or Lite for real repository repairs. The existing
[Polyglot](../../harness/tools/benchmark/README.md) and
[QuixBugs](../../harness/tools/benchmark/quixbugs.md) runners remain the ready
local controls. This note records source research and a proposed bounded
sample; no new benchmark agent run or score was produced by this research.

The subsequent [Terminal-Bench cancellation smoke run](terminal-bench-smoke.md)
verifies the ACP integration and records a failed one-task provider submission,
its controls, usage and reviewed trajectory separately from this research.

## Candidates

| Benchmark | Verified scope | What it adds to Pero's current sample | Integration / execution condition |
| --- | --- | --- | --- |
| [Terminal-Bench 2.0](https://github.com/harbor-framework/terminal-bench-2) | 89 task directories in the inspected source tree; containerized terminal tasks with independent verifiers | Longer shell/debugging sequences, builds, file processing and recovery after failed checks | Harbor already supports ACP, including a local registry entry. Requires an agent binary inside the task container and a working container backend. |
| [SWE-bench Verified](https://huggingface.co/datasets/SWE-bench/SWE-bench_Verified) / [Lite](https://huggingface.co/datasets/SWE-bench/SWE-bench_Lite) | 500 / 300 test instances, confirmed through dataset size metadata | Issue-driven search across real repositories, multi-file edits and regression tests | Produce a patch from the task's base commit, then use the official Docker evaluator. Current v5 docs support local task-repo image builds on ARM, but still label ARM support experimental. |
| [SWE-bench Pro V2](https://github.com/scaleapi/SWE-bench_Pro-os/tree/66f92766bba642462d4bbe5479e83f91f9211862/v2) | 642 validated tasks across 11 repositories; HARD-51 subset | Long-horizon repo navigation, changes across components and request-budget pressure | Harbor task format, public linux/amd64 images, 50-minute task budget. Official locked protocol requires model-endpoint-only network access and patch re-grading in a fresh sandbox. |
| [RepoQA SNF](https://github.com/evalplus/repoqa) | 500 tests: five languages × ten repositories × ten needle functions | A controlled repository-understanding/retrieval comparison | Original benchmark supplies code as long context and judges function similarity. A filesystem/Glob/Grep adaptation must be reported as a separate variant; it is not an official SNF score. |
| [EvalPlus](https://github.com/evalplus/evalplus) | HumanEval+ and MBPP+ add substantially more correctness checks than their base suites | Cheap edge-case correctness controls alongside agent traces | Primarily function generation, so it provides limited evidence about repository tools. Native ACP generation would need an adapter; the existing model-generation CLI does not test Pero. |
| [BigCodeBench-Hard](https://github.com/bigcode-project/bigcodebench) | 148 tasks from the 1,140-task full benchmark | Complex Python instructions, library APIs and dependency/validation mistakes | Package-heavy execution environment and a native-agent generation adapter are needed. The benchmark's “function calls” refer to generated code's API use, not model tool calls. |

## Harbor can reuse ACP

The inspected Harbor revision has a generic
[ACP agent](https://github.com/harbor-framework/harbor/blob/8c6bdacc9b9cd5342508179f1296bcbae5f1df36/src/harbor/agents/installed/acp.py)
and [ACP documentation](https://github.com/harbor-framework/harbor/blob/8c6bdacc9b9cd5342508179f1296bcbae5f1df36/docs-mintlify/agents/acp.mdx).
Its `registry_entry_path` option accepts a local agent description, including
`distribution.local.cmd` and `args`. A public ACP Registry listing is therefore
not required for an initial Pero trial. The command names an executable inside
the container; this option does not copy a host executable into it.

Package a pinned Linux Pero binary plus its existing provider/plugin launcher
inside the environment, configure the model through that launcher, and retain
the native `--session-dir` under the exported agent logs. A macOS binary cannot
be substituted for the Linux binary. Check authentication, working directory,
ACP permission handling, shutdown and exported Session readback on a trivial
task before recording a coding score. This compatibility is a source-level
finding; Pero-to-Harbor execution has not yet been verified.

Harbor writes `acp-events.jsonl`, `acp-summary.json`, `acp.txt` and an ATIF
`trajectory.json`. Export those alongside Pero's native Session JSONL and run
the existing [Session reporter](../../harness/tools/session_report/README.md)
on the native files. Protocol event logs and ATIF do not replace provider usage
or native tool-result metadata. Missing usage remains unobserved; reconcile
root and child Sessions before summing tokens.

## Proposed first sample

The following task instructions and configurations were inspected at the
Terminal-Bench revision below. Keep official verifiers unchanged and start
with one attempt per task, concurrency one, no HTTP retries and the same
DeepSeek model/thinking settings as the existing sample.

| Task | Diagnostic value | Upstream agent timeout |
| --- | --- | ---: |
| `cancel-async-tasks` | Implement and debug bounded asynchronous work with cancellation cleanup; inspect failed local checks and recovery | 900 seconds |
| `db-wal-recovery` | Inspect damaged data, distinguish partial from complete results, and validate the recovered artifact | 900 seconds |
| `large-scale-text-editing` | Process a million-row CSV with constrained Vim macros; inspect broad reads, output volume and adherence to the required tool workflow | 1,200 seconds |

Use a shared 32-request ceiling per task as an explicit diagnostic override;
retain a timeout/budget exhaustion as a failed attempt. These three tasks and
the altered request ceiling constitute a smoke sample, not a Terminal-Bench
leaderboard result. First verify the selected container/verifier setup with
the upstream reference and no-op agents. A cancellation task tests the agent's
generated program; native process-ownership and TaskStop contracts still need
their own tests. Large files also do not guarantee a spill or cursor branch was
exercised: report those only when native trace metadata proves it.

Record independent verifier results, frozen output/patch, exit reason,
HTTP attempts and committed responses, uncached/cache-read/output tokens,
explicit and reviewed masked failures, changed/unchanged repeat calls,
declaration exposure and actual prepared payload bytes. Preserve every attempt,
including infrastructure failures. Keep byte measurements separate from tokens
and use repeated matched samples before claiming an efficiency improvement.

SWE-bench Verified/Lite is the next step after this integration. Choose and pin
a small cross-repository set before running agents, generate predictions at the
specified base commits and judge with official tests. Use a distinct run ID for
every prediction set: the current evaluator caches by run ID and instance ID.
Pro V2 should follow after a Linux backend and the locked-protocol probes are
verified. Generic ACP alone does not establish that its offline/re-grading
protocol is satisfied; retain both initial and fresh-sandbox verdicts.

## Observed local readiness

On the current macOS arm64 host, Docker CLI is installed, but `docker info`
cannot connect to the configured Colima daemon. Harbor is not installed.
Homebrew Python 3.13 is available and satisfies the inspected Harbor requirement
of Python >=3.12. No Docker VM was started, image downloaded, cloud environment
created, credential copied or paid model request made for this research.

The current SWE-bench README recommends x86_64, 120 GB free storage, 16 GB RAM
and eight CPU cores for broad evaluation. Its ARM image-build path is not
evidence that all selected instances work on this host. Pro V2 explicitly
publishes linux/amd64 images. Run readiness checks before promising either
suite locally.

## Source snapshots

Official READMEs, task metadata and the cited ACP source were fetched on
2026-11-04. Task counts for Terminal-Bench and Pro were also checked against
their repository trees. Dataset split counts for Verified/Lite were queried
from Hugging Face's dataset size endpoint. Upstream descriptions and release
gate claims are not local execution results.

| Source | Inspected revision |
| --- | --- |
| Terminal-Bench 2.0 | `2fd12b88aafdd04a52c298e3940bcb189f9766d6` |
| Harbor | `8c6bdacc9b9cd5342508179f1296bcbae5f1df36` |
| SWE-bench | `02e7a74ffd0b707aab73d203fe87bdc7c76afc8e` |
| SWE-bench Pro | `66f92766bba642462d4bbe5479e83f91f9211862` |
| RepoQA | `ae876deb1365dbf5a15b0533723c8ed123eee586` |
| EvalPlus | `26d6d00bb1fd0fa37f39c99d5290da67891d1c5e` |
| BigCodeBench | `09dd993f46c3fbf3a799465bb96d524edcb0b199` |

Pin the evaluator and actual registry dataset release/revision together for a
run; a moving source checkout is not automatically the `terminal-bench@2.0`
registry release. Preserve task/config hashes in the run manifest.

## Harder concrete tasks, 2026-11-06

The follow-up selects cancellation, WAL recovery, C/Python polyglot compilation,
gRPC deployment and constrained compression. These add observable tool chains
and process/data contracts beyond five HumanEval+ functions. Upstream labels
cancellation and compression hard, and the other three medium. Selection is
diagnostic; a short prompt or a difficulty label does not establish the number
of files, model requests or reasoning steps actually needed.
The independent outcomes and execution settings are recorded in the
[Sol verification](terminal-bench-sol-complex.md).

Public instructions also identify these deeper follow-up candidates:

| Task | Work required | Upstream agent timeout |
| --- | --- | ---: |
| `fix-ocaml-gc` | Repair a major-heap sweeping change that crashes compiler bootstrap; build the compiler and run its basic testsuite | 3,600 seconds |
| `make-mips-interpreter` | Implement a JavaScript MIPS ELF interpreter and system calls sufficient to boot DOOM and save the checked frame | 1,800 seconds |
| `build-cython-ext` | Repair and build pyknotid 0.5.3 Cython extensions against NumPy 2.3.0, retaining its package layout and relevant tests | 900 seconds |

These three are researched candidates, not new Sol acceptances. SWE-bench
Verified remains the separate route to issue-driven repairs across real
repositories; Pro V2 adds a longer budget and a stricter evaluation protocol.
Terminal-Bench native-tool verdicts also do not replace an original plugin's
full Workflow development/review/merge acceptance.
