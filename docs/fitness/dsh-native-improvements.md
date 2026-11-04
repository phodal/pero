---
kind: verification_report
---

# Native coding follow-up from DSH, Pi and Qwen

2026-11-04, macOS arm64. This follow-up targets three observed problems in
the [previous four-task sample](coding-benchmark-followup.md): empty capability
searches, repeated relative `cd`, and expensive or incorrectly reported local
validation. It changes the native contracts and capability-scoped guidance.
The optional engineering profile remains off unless explicitly selected.

## Pinned source comparison

Local source repositories under `/Users/phodal/ai` were read only.

| Reference | Revision | Mechanism used |
| --- | --- | --- |
| deepseek-harness | `8bd073392eef6f54e921a093b95076248eb08cbb` | `packages/shell/tool-bash/src/index.ts`: explicit invocation workdir resolved from Session cwd; actual exit status and separate execution guidance |
| pi-mono | `90b42bca6ed161b8e7ee40ceda9755205c2882ec` | `packages/coding-agent/src/extensions/tool-search/tool.ts`: authorized metadata, keyword coverage/name ranking and bounded discovery |
| qwen-code | `6fe83a82457def9ab8daa43bf833b4cfdf192bd2` | `packages/core/src/core/prompts.ts`: project-defined checks, diagnose before retry, report failed/unrun checks faithfully |

The referenced recovered Qoder templates are under
`workforce/openstar-agents/reports/qoder-prompts-2026-11-03`. The named G51
implementation identifies GPT51, not GLM51; the files do not establish a
GLM51 system prompt. G51/G54's focused verification guidance is a behavior
reference. The earlier engineering contracts, skills budgets and memory
attribution are already merged and are not reimplemented here. No recovered
third-party prompt body is included in Pero.

## Contract changes

- ToolSearch retains all-keyword matches when available. Otherwise it returns
  explicitly marked partial matches ordered by keyword coverage, then name
  matches. Exact selection, caller filtering, page/schema budgets and exact
  next-request activation remain with the existing owners. This is a small
  literal matcher, not Pi's full BM25 implementation.
- Claude Bash accepts optional `workdir`. Relative values resolve from the
  Session workspace, and explicit values neither read nor update remembered
  cwd. Foreground/background execution and durable identity use the same rule.
  A trusted `WithSessionWorkingDirectory` check retains its Session anchor.
- Execution guidance prioritizes project checks and focused verification,
  distinguishes self-test expectations from specifications, explains empty
  coverage, and makes pipeline status preservation concrete. Bash job guidance
  is present only when Bash, TaskOutput and TaskStop are all declared.
  No printed-output classifier or automatic command rewriting is introduced.

## Local verification

The complete Harness Go race suite passed in 35 packages; `go vet ./...` and
`git diff --check` passed. The existing cold-shell-recovery test twice rejected
the documented pending Dispose sentinel before reaching Drain. Its lifecycle
assertion now accepts only that sentinel and still requires successful Drain.
The corrected recovery table passed 30 consecutive race runs. Production
shutdown semantics, effect assertions and timing are unchanged.

Search tests cover partial results through actual provider HTTP declarations,
successful next-request calls, permission/retirement filtering and pagination.
Directory tests cover foreground/background, explicit/remembered paths,
invalid directory admission, trusted anchors and durable call identity.
Guidance tests cover capability withdrawal. These checks establish runtime
behavior, not token savings or model adherence.


## Real-provider follow-up

The clean source commit was `96cba6a4399431c4aaf535fd7352ec74c6b4634f` and Go build metadata
recorded `vcs.modified=false`. The binary SHA-256 was
`ab20f4a735a1284a22de8f72cfdfa8fdced190ac06d2124e232d77b7dcfef0ba`. The same four tasks, dataset revisions, deferred-tool
setting, DeepSeek Flash model, disabled thinking, provider-default sampling and
serial execution were retained. React kept its 64-request budget; each QuixBugs
task kept 32. Requests allowed 8,192 output tokens and zero HTTP retries, with
at most one same-Session official-feedback repair. Prompts and official tests
were unchanged from the previous sample. The later reporter casing fix changes
offline analysis only; it was not present in this binary.

| Task | First submission | Final submission | HTTP attempts | Recorded tokens |
| --- | ---: | ---: | ---: | ---: |
| Polyglot react | 7/14 | 14/14 after feedback | 38 | 594,912 |
| QuixBugs shunting_yard | 6/6 | 6/6 | 9 | 45,389 |
| QuixBugs mergesort | 14/14 | 14/14 | 8 | 34,198 |
| QuixBugs kth | 7/7 | 7/7 | 10 | 43,313 |
| Total | Three of four tasks | Four of four; 41 official tests | 65 | 717,812 |

Recorded usage is 44,154 uncached input + 653,952 cache-read + 19,706 output
tokens. All 65 observed HTTP attempts have committed response usage. Compared
with the preceding same-task sample, attempts fell from 78 to 65, tool calls
from 78 to 62, and recorded tokens from 965,302 to 717,812 (25.64% lower).
This single stochastic pair does not establish repeatable or causal savings;
cache-read tokens are included and these counters are not an invoice.

## What the actual trajectories show

- All four tasks used exact-name batch discovery. React also searched TaskStop
  and stopped its promoted job by the exact task handle. There were no empty searches. No
  live query exercised partial fallback, so its evidence remains the provider
  wire regression rather than this model sample. Kth selected an unknown List
  alongside four valid names; the unknown name remained absent.
- Actual Bash arguments used explicit workdir 21 times: React 15, mergesort
  three and kth three. No repeated relative-cd failure occurred. Kth still
  constructed an invalid `/tmp/../$PWD` path, failed to create its self-check,
  then recovered with a workspace-local Write. Workdir does not validate
  arbitrary paths embedded inside shell code.
- React generated an infinite loop in a scratch check, waited for the default
  120-second foreground promotion, then used TaskStop to cancel that exact
  process. This is one interrupted invocation, not a second failed TaskStop.
  It also repeated its callback API assumption and still needed official
  feedback. Self-test expansion and `.pero` inspection remain avoidable costs.
- Mergesort had one explicit failed call exposing its remaining recursion
  base case; the next edit and checks passed. The protocol, lifecycle and exit
  counters describe this same invocation and must not be added as three bugs.
- Five local check executions failed behind shell exit zero: React's malformed
  scratch script, a temporary implementation TypeError and three assertions in
  a generated suite; kth's invalid scratch path; and shunting yard's incorrect
  precedence oracle. React's three unittest assertions are one check execution.
  The latter React suite and shunting-yard oracle were corrected without
  another implementation edit before rerunning. These are not five independent
  product defects. Shunting yard's following doctest ran zero tests.
- Shunting yard created `/tmp/check_sy.py`, copied it into the workspace and
  later removed the external scratch file. This violates the task's workspace
  instruction even though its official submission passed. Recorded calls show
  no official-test/reference reads or external search; execution still has no
  OS sandbox, so raw passes do not establish enforced procedural isolation.

The original automatic export had four zero-exit candidates. It missed React's
uppercase `EXIT=1` after IndentationError; the existing marker regex accepted
only lowercase. A separately tested reporter correction recognizes the marker
without case sensitivity. Offline reanalysis finds five candidates; all five
have source/result/stdout-hash-bound reviews confirming unsuccessful local
checks. Shell status and independent benchmark scores remain unchanged. The
original automatic report and raw Sessions are preserved.

An offline audit passed 67 checks: 40 official test/support copies were
byte-identical to pinned upstream sources, five frozen submissions matched their
judged solutions, usage was recounted from native messages, old raw traces were
unchanged, credentials were absent from reports/changed source and all benchmark
agents closed successfully. The reviewed Better Harness Inspector contains all
four Sessions, 62 paired calls, one explicit failure and one interruption.
Local evidence lives in `reports/coding-benchmark-2026-11-04/dsh-improvements`
and `automated-summary/dsh-improvements/reviewed` in the analysis workspace.
Raw traces, generated HTML, credentials and binaries are not committed.

## CI at the tested source

[CI 41775742522](https://github.com/phodal/pero/actions/runs/41775742522) passed
Go tests and Harness Go contracts. Standalone Harness Bazel passed 34 of 35
packages, including nativetools, but failed the Workflow cancel-child terminal
fact assertion. The unchanged case passed 230 local race repetitions; that does
not establish a fix or a master-baseline failure. Its unresolved evidence is in
the [canonical incident](../issues/2026-11-04-workflow-cancellation-terminal-fact.md).

The fast and Linux core jobs also reproduced the same six Paper failures
previously verified on pure master `2b84243e`. This follow-up changes none of
those files. The repository-wide gate is not green.
