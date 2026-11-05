---
kind: verification_report
---

# Selected Terminal-Bench failures after runtime changes

2026-11-05. Three previously failed tasks were rerun with the real DeepSeek
provider. The first batch at `5a246b023590065edc941a115635b59cd3cfebf2`
passed two of three. A deferred service-discovery defect was then fixed at
`42d6029bb0f1ae98f974cdcedf788f222f8fc392`; a separate `pypi-server`
attempt passed. These are two source versions, not a uniform new-version 3/3
result. The frozen 89-task cohort and its score are unchanged.

## Configuration and provenance

All four valid attempts used the `deepseek-flash` alias, thinking disabled,
8192 output tokens, deferred tools and native ACP. Request/step/retry limits
were zero, with each task's official 900-second agent and verifier timeouts.
Explicit runtime options were a 1,000,000-token context window, tool-history
48,000/24,000-character watermarks with four recent results protected,
`--engineering-profile feedback`, `--request-timeout-ms 180000` and an
environment-owned service directory. The latter two options are opt-in;
ordinary Bash jobs retain Session cleanup.

The runs used the existing macOS arm64 Colima Rosetta VM, Linux amd64 task
images, the strict-stop adapter and the separately verified pinned verifier
bootstrap v3. Tasks ran sequentially. Official inputs, images and tests were
retained, and delivery contracts used only public requirements. No hidden
test content was supplied to the agent. Source/binary, runner, adapter and
input hashes are recorded in each attempt directory.

The preserved `runtime-rerun-20261105-01` setup attempt lost the credential
environment mapping while reconstructing the agent configuration. It made
zero provider HTTP attempts and is excluded from model verdicts. The corrected
runner preserves the environment mapping and checks it before agent setup.

## Official verdicts and usage

All three selected baseline rewards were zero. Each valid new attempt ended
normally; the verifier audit observed actual pytest execution and assertions.
No agent timeout or provider request deadline occurred.

| Task | Source | Reward | Responses | Tool calls | Failed calls | Recorded tokens | Official verifier |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| pypi-server | `5a246b02` | 0 | 49 | 63 | 6 | 753,438 | 1 failed in 8.65s |
| polyglot-c-py | `5a246b02` | 1 | 220 | 222 | 42 | 13,321,025 | 1 passed in 0.56s |
| fix-git | `5a246b02` | 1 | 15 | 18 | 0 | 125,256 | 2 passed in 0.06s |
| pypi-server, service fix | `42d6029b` | 1 | 27 | 32 | 1 | 277,736 | 1 passed in 1.56s |

The first batch records 14,199,719 tokens, versus 276,354 for the same three
baseline attempts. Including the service follow-up, all four valid new attempts
record 14,477,455 tokens. This does **not** demonstrate token savings. Counts
include cache reads and are not an invoice; all four new attempts have complete
reported usage. Unreported usage elsewhere remains unknown. Source, runtime
settings and stochastic model behavior changed together, so this is not a
single-factor causal comparison or a repeatable score/savings estimate.

## Service failure and recovery

The first `pypi-server` rerun found coding and background-job tools but never
ServiceStart. All four system prompt generations omitted that name. The model
left a Session-owned Bash server despite recognizing its lifetime limitation;
after agent exit, the independent probe found no environment services and
could not connect to port 8080.

Service guidance had required ServiceStart to be already declared, making it
invisible before deferred discovery. The fix consults the existing
caller-authorized deferred pool and supplies an exact ToolSearch query. It
neither activates the tool nor advertises it to restricted callers. A regression
failed before the fix; eager, deferred and restricted provider-boundary cases,
related native race suites, environment-service/CLI Bazel targets and vet pass.

In the separate acceptance, the model first searched for ServiceStart. Its
first call, native seq 1344/result 1349, returned `starting`, but the process
subsequently exited with code 1: pypiserver's `-a .` also required `-P .`.
The Bash readiness probe at seq 1532/result 1538 returned exit 7, the one
failed tool call in the table. These observations describe one recovery chain;
the successful asynchronous tool return did not prove application readiness.

The second ServiceStart at seq 1727/result 1732 added `-P .`. After the agent
process exited, the independent probe observed the exact second service as
`running` and HTTP 200. The official installation test then passed. The model
selected a two-hour service lifetime; Harbor deleted the task environment after
verification. Cleanup here is environment deletion, not a claimed ServiceStop
acceptance. The failed first service remains in the retained lifecycle evidence.

## Remaining limitations

`polyglot-c-py` passed after extensive quote/comment/compiler experiments, with
42 failed calls including shell exits and two Write errors. Of its 13,321,025
recorded tokens, 12,646,912 were cache reads. Its 162 tool-history replacements
are projection events, not model compaction; model compaction responses were
zero. The final prepared request was 380,590 UTF-8 bytes, including 112,700
bytes of tool-result messages. Bytes are not tokens and do not establish which
component caused the usage increase.

Progress advisories were zero in all four attempts. Changing commands/results
and intervening writes bypass or reset the current narrow repetition rules.
This run does not establish semantic-stall detection. The next optimization
needs to address repeated compile/patch experiments and growing history, while
preserving compiler diagnostics and the public specification.

Polyglot eventually removed temporary build artifacts and retested Python and
gcc; fix-git resolved its index conflicts. Both had public delivery contracts,
but neither triggered a feedback attempt. Their passes cannot be attributed to
an automatic contract repair. No uniform full-suite rerun, Desktop/default-mode
acceptance or independent x86 machine comparison was performed.

## Retained evidence

Local artifact root:
`/Users/phodal/workforce/openstar-agents/reports/coding-benchmark-2026-11-04`.
Large Session files and binaries remain outside the repository.

- `runtime-rerun-20261105-02/comparison.json` and `comparison.md`: first-batch
  baseline/result comparisons and failure references.
- `runtime-rerun-20261105-02/all-sessions/inspector.html`: Better Harness export.
- `runtime-rerun-20261105-03/final-comparison.json` and `final-comparison.md`:
  separate attempt rollup, official verifier source hashes and service evidence.
- `runtime-rerun-20261105-03/summaries/pypi-server/inspector.html`: follow-up trace.
- Each run's `manifest.json`, `runner-freeze.json`, `input-hashes.json`,
  `artifact-audit.json` and native `agent/pero-sessions/*.jsonl` preserve receipts.

Runner/input/binary and baseline result hashes were rechecked after reporting.
The final generated reports and changed documentation contain zero matches for
the configured credential literal. No containers for these rerun tasks remain;
unrelated pre-existing stopped containers and the running VM were retained.

Related: [runtime changes](reference-runtime-improvements.md),
[service incident](../issues/2026-11-05-background-service-lifetime-guidance.md),
[original failure review](terminal-bench-failure-repair-review.md).
