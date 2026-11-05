# Tool-call efficiency verification

This follow-up fixes six findings from the DSH/Pi/Qwen source and Session audit.
It reuses the existing tool registry, scoped spill policy, ordered batch commit,
owned Bash lifecycle and native Session history.

| Finding | Resulting behavior |
| --- | --- |
| TaskStop also activated Agent/Bash | A complete registered tool name selects only that tool, case-insensitively; keyword and explicit multi-name queries retain their behavior. |
| Discovery repeated full schemas in history | Deferred receipts return bounded descriptions, activation/hash/pagination facts; complete schemas remain in durable metadata and the next request declarations. |
| Bash-only deferred requests lost timeout guidance | Short checks have explicit `terminate_on_timeout`; timeout cancels and joins the owned process. Default promotion remains available, with exact-handle recovery advice. |
| Argument repetition looked unproductive despite changing results | Turn-local advisory reminders require consecutive unchanged observed results, at counts 3/5/8. Changes, mutations, new turns and polling reset/exclude the chain. No effect is vetoed or replayed. |
| Parallel outputs exceeded individual caps | A live `agent-loop.toolOutputBatchBytes` text budget defaults to 65,536 bytes, zero disables it. Small results retain their share; larger results save full text before projection. Missing/quota-exhausted storage preserves evidence and records a budget miss. |
| Native search could not reach later files | Descriptor-rooted directory pages and query-bound Glob/Grep cursors continue past 256/512 entries and inside matching files, with root/nested `.gitignore` filtering. |
| A new Explore child could only search an empty catalog | Trusted child setup uses the deferred owner's authorized pool, preserving discovery for allowed capabilities. Parent denial, read-only restrictions and explicit no-tools remain enforced. |

Native CLI spill files live under the configured `--session-dir/tool-output/`.
`ReadToolOutput` reads exact Session-owned locators with bounded UTF-8 byte pages,
including after a cold store restart. It does not broaden ordinary workspace
Read authority. Deferred discovery can activate this tool by its exact name.

The batch budget measures text, excluding images and serialization overhead.
Failure flags and durable metadata survive projection. A result that cannot fit
its recovery pointer remains whole, so the budget is best effort with an explicit
`met` fact. Search enumerates live directories; directory mutations require a
restart. Tested nested ignore patterns do not establish complete Git parity.

OpenAI `request/wire-size` records the actual serialized body length/digest and
serialized tools/tool-result messages before HTTP. This reflects the selected
request after replacement/compaction. It is preparation evidence, not a sent
request receipt or provider token count; retries and auxiliary generations keep
separate records. Zero turn coordinates are omitted so auxiliary requests do not
break Session resume.

The offline reporter distinguishes changed/unchanged/unknown repeated results,
counts declaration exposure per committed response, and reports the contribution
from tools never invoked in that Session. It uses boundary records for retained
tool-result bytes rather than summing raw history. Older traces without those
records retain unobserved wire cost. Spilled/truncated previews cannot establish
equality of full returned results. Usage still comes only from committed provider
reports; printed failures remain review candidates without rewriting shell exit.

## Verification

- Full standalone Harness Go race suite, `GOWORK=off go test -race -count=1 ./...`.
- `go vet ./...`; all changed code files remain below 1,000 lines.
- All 35 standalone Bazel race test targets pass, including the final child
  allowlist correction. Gazelle diff and standalone agent build pass with
  `--lockfile_mode=error`.
- Reporter: 20 cases; benchmark judge acceptance: one table with five real
  subprocess verdicts; trial client: 18 cases.
- Real-process bounded timeout checks establish process termination and one
  owned effect. Loopback HTTP checks establish actual declarations, compact
  history, body size/digest and safe resume after auxiliary requests.

The audit baseline is four Sessions, 65 committed responses, 62 calls and
717,812 recorded tokens, including cache reads. A bounded same-task provider
follow-up is recorded separately below; it cannot establish causal savings.

## Same-task provider follow-up

The clean binary at `82c274190919277ff74a91b01c2dffcfe605fa21` recorded
`vcs.modified=false`, SHA-256
`d097534d4aab2766e4c1f6ee2b5201e0d658ee0a33875629c198282295223278`.
The same pinned datasets, four tasks, prompts, DeepSeek Flash, disabled thinking,
deferred discovery, provider-default sampling and serial execution were retained.
React kept 64 requests; QuixBugs kept 32 per task, 8,192 output tokens per request,
zero HTTP retries and at most one same-Session official-feedback repair.

| Task | First submission | Requests | Recorded tokens |
| --- | ---: | ---: | ---: |
| Polyglot react | 14/14 | 35 | 455,264 |
| QuixBugs shunting_yard | 6/6 | 7 | 31,285 |
| QuixBugs mergesort | 14/14 | 17 | 72,808 |
| QuixBugs kth | 7/7 | 8 | 32,750 |
| Total | Four of four; 41 tests | 67 | 592,107 |

All four passed their first official submission. The five native Sessions
include one real Explore child; its 4,777 tokens are included in mergesort's
total. Recorded usage is 49,601 uncached input + 526,720 cache read + 15,786 output.
All 67 HTTP attempts have committed usage and matching prepared-wire records.
This sample used 17.51% fewer total tokens than the preceding 717,812-token
sample, while requests increased from 65 to 67 and tool calls from 62 to 70.
This is a stochastic diagnostic comparison, not evidence of repeatable savings.

The new boundary measurements total 2,273,296 serialized payload bytes, including
818,937 serialized tool-result message bytes retained across selected requests.
Older Sessions lack these boundary facts, so a wire/history comparison is
unobserved. Fourteen discovery receipt texts total 12,585 UTF-8 bytes, versus
20,278 bytes in five earlier receipts. The new model receipts contain no input
schemas; complete discovery metadata remains durable. Different query mixes
prevent treating these byte differences as an isolated token effect.

## What remains visible in the trajectories

- Three repeated-argument calls all changed their observed result; no runtime
  no-progress reminder fired. No live result required batch projection and no
  Bash call opted into bounded termination. Those new branches have process,
  storage and continuation contract coverage, not live activation evidence.
- Broad model queries still activate unused tools. Compact schema exposure rose
  from 382,022 to 384,501 bytes; exposure from tools never invoked in their
  Session rose from 114,885 to 159,363 bytes. Exact Bash/Edit queries return only
  those tools. Exact-name correctness does not optimize arbitrary model queries.
- Six explicit failed calls remain: React used unavailable `python`, called
  unactivated Edit and failed one scratch assertion; mergesort read two absent
  files and exposed a temporary implementation failure. These are recovered
  intermediate calls, not six official task failures.
- Seven React scratch executions failed behind successful `head`/`tail` shell
  pipelines. Source/result/stdout-hash-bound reviews preserve those findings
  without rewriting exit status or counting each assertion as another defect.
  Shunting yard's empty doctest is separately reviewed as zero validation
  coverage, not a failed process.
- Mergesort's Explore child made five empty ToolSearch calls. This revealed a
  runtime defect: child restrictions were derived from already activated parent
  declarations. The [canonical incident](../issues/2026-11-04-deferred-subagent-tool-pool.md)
  and subsequent repair keep the original cohort intact. A loopback HTTP table
  now proves child discovery/read success without parent Read/Bash activation,
  inherited denial, a restricted custom child and explicit no-tools behavior.

The offline verification script passed 81 checks, including 30 byte-identical
official test/support copies, four frozen submission/judge pairs, immutable
native sources, provider/ACP usage agreement, compact receipts with durable
metadata, review binding and clean process exit for all four task agents.
Credential scanning passed for the generated artifacts. There is no OS sandbox;
raw judge passes do not certify procedural isolation. Evidence and rerunnable
verification live under `reports/coding-benchmark-2026-11-04/tool-efficiency/`
in the analysis workspace, including the reviewed Better Harness Inspector.

One simultaneous Go/Bazel run failed two existing LSP timeout/shutdown
assertions. A subsequent complete Go race run and vet passed with no LSP source
change; both standalone Bazel runs passed all 35 targets. No LSP root-cause fix
is claimed. Repository-wide Paper failures from earlier CI are separate from
these local Harness checks; fresh pushed CI must be assessed independently.

## Subsequent child-pool and guidance checks

The child-pool repair binary at `8f0b02fa` passed its deterministic HTTP table,
then ran a separate 32-request mergesort spot check. Explore successfully
discovered and used Bash in three responses, with zero empty searches. The
parent then delegated implementation and verification to two more children.
Children consumed 27 of 32 responses, exhausting the shared provider budget
before any official submission. The run retained four Sessions, 226,651 recorded
tokens, clean process exit and the budget error. It is a failed run, not a judge
pass, and is not substituted into the earlier comparable four-task cohort.

Claude discovery guidance now gives the concrete standard-name selection
`select:Read,Write,Edit,Bash,Glob,Grep` and advises direct native operations for
small local tasks. Independent substantial work can still use Agent; no
scheduler, policy, effect or budget is overridden.

A new same-budget mergesort spot check used clean source
`16d6ac9d0fef3b6b54c1406b68d34dae7bc21591`, binary SHA-256
`0367c2068a33187ac7123d404eecf387db08811a3484f2ff15e518f9b8882652`.
It selected exactly those six tool names, used Read/Bash/Edit directly and
passed 14/14 on first submission: nine requests, 43,641 recorded tokens
(6,788 uncached input + 35,072 cache read + 1,781 output), no child Sessions,
empty searches or zero-exit validation candidates. One local check exposed the
base-case defect and the following edit/check recovered. All nine observations
have usage and prepared-wire records. One repeated call changed its result.
The preceding failure remains in `child-fix-mergesort-01`; this successful
follow-up is in `direct-tools-mergesort-01`. This stochastic pair does not prove
causal or repeatable improvement. The final readonly child pool also retains
Session-owned ReadToolOutput; explicit custom tool lists retain their limits.
