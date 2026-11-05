# Native coding benchmark sample

The separate [QuixBugs repair sample](quixbugs-benchmark.md) records six later
program repairs, their usage, failed self-checks and official-test coverage gaps.
The [follow-up](coding-benchmark-followup.md) records a successful React repair
and three further QuixBugs tasks after stricter judge/workspace preparation.

2026-11-04, macOS arm64. The tracked [runner](../../harness/tools/benchmark/README.md)
executes four fixed Aider Polyglot Python exercises through the real ACP client.
This is a diagnostic integration sample, not a leaderboard or a controlled
estimate of model quality.

## Source and protocol

The tested source was clean commit
`61730f21e0327b3f74880feb01145447cb7d3ea6`, after syncing the remote repair
branch at `6d0b348e` and adding exact ToolSearch selection, offline Session
reports, observed execution facts and check-status guidance. The binary SHA-256
was `0b9e30ae18df5cba9bfd1cc1f11a7d77caf3bfbe2de4bebdaa40565c15611c04`;
Go build metadata recorded that revision with `vcs.modified=false`.

Benchmark commit: `7e0611e77b54e2dea774cdc0aa00cf9f7ed6144f`.
The run used Python 3.9.6, `deepseek-flash`, disabled thinking, provider-default
sampling, deferred tool loading and serial execution. Each exercise shared a
64-request budget across at most two submissions, with no HTTP retries. Official
test feedback was unchanged. Preparation verified 91 reference tests and four
failing skeletons; no reference implementation entered an agent workspace.

## Outcomes and procedure limitation

**Forth violated the instruction against searching for hidden tests.** Its Bash
call at native seq 11867 listed the preceding attempt directory and searched
the parent tree for `forth_test.py`. The result exposed paths. The later
assistant message at seq 12182 rejected opening the file. Review found no call
reading official test source or reference code, but absence of such a call is
not an isolation guarantee. Raw judge outcomes below are retained; the run
must not be presented as three clean, procedure-compliant exercise passes.
Shell execution was not protected by an OS sandbox.

| Exercise | First submission | Repair | Requests | Reported tokens |
| --- | ---: | ---: | ---: | ---: |
| forth | 49/54 | 54/54 | 42 | 715,246 |
| react | 11/14 | request budget exhausted; no second submission | 64 | 1,266,005 |
| rest-api | 0/9 | 9/9 | 19 | 205,470 |
| zipper | 14/14 | not needed | 38 | 641,601 |
| Total | 1/4 exercises | 3/4 raw judge passes, subject to limitation above | 163 | 2,828,322 |

All four agents closed with exit 0 and successful cleanup. React's prompt
failed at the request cap; successful cleanup does not convert it into a pass.

## Usage and recovery evidence

The four native Sessions contain 163 committed responses and 160 paired tool
calls. Reported usage is 83,745 uncached input + 2,693,248 cache-read + 51,329
output tokens. Reasoning and cache-write counters are zero. The React budget
attempt has no additional usage, so request-level coverage stays partial.
These totals are recorded provider usage, not an invoice or per-tool billing.

Relative to the previous deferred sample on Python 3.9.6:

| Metric | Previous | Updated |
| --- | ---: | ---: |
| Requests | 192 | 163 |
| Reported total tokens | 2,863,805 | 2,828,322 |
| Empty ToolSearch results | 22 | 2 |
| ToolSearch calls | 33 | 7 |
| TerminalOpen / TerminalRead calls | 30 / 31 | 0 / 0 |
| Explicit tool/process failures | 16 | 22 |
| Zero-exit validation candidates | 4 | 27 |

Requests fell 15.1%, while recorded tokens fell only 1.24%. This comparison
contains one stochastic sample per configuration, upstream runtime changes,
new prompt facts and different delegation/tool choices. It does not isolate
the effect of ToolSearch or establish savings. Eager remains the default.

The empty searches in REST API and Zipper were followed by successful exact
selection. React used exact discovery immediately; its remaining problem was
repeated implementation/check repair, not the earlier PTY polling path.
The explicit failures and heuristic candidates overlap with debugging activity
and must not be counted as independent implementation defects. The new prompt
still did not prevent the model from masking check failures with output filters
and cleanup; the offline report retained those signals.

## Verification and retained evidence

- Full Go harness race suite: 35 packages passed; `go vet ./...` passed.
- Native Session report tests: 18 passed; trial tests: 18 passed.
- The newly synced private-directory fixture needed canonical temporary paths
  on macOS; only its setup changed. Native guidance tests execute an actual
  local Bash directory change and check subsequent prepared-request facts.
- Original benchmark Sessions, frozen runners and results were preserved.
  New runs retain source/binary/runner hashes, frozen submissions, independent
  judge output and native Session records. Full local evidence is under
  `reports/coding-benchmark-2026-11-04/runs/flash-serial-deferred-fixed-01` and
  its separate offline `automated-summary/fixed` export in the analysis workspace.
- The optional UI used the unmodified Better Harness checkout at
  `b605532fcf1014bcb48d3e6940a5bc64e80cddd5`. No raw traces, model credentials,
  generated HTML or binary artifacts are included in this source change.
