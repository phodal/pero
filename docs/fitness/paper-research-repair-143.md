---
kind: verification_report
date: 2026-11-11
github_issue: 143
github_url: https://github.com/phodal/pero/issues/143
source_revision: b1b952939f8986c150eb9d1b7d63166411657a63
---

# AutoResearch saved-run repair

Offline engineering verification on macOS arm64. Worktree:
`/Users/phodal/workspaces/pero-issue-143`; branch
`codex/paper-143-terminal-budget`. No live inference, scientific acceptance,
Electron/Native UI inspection or issue closure is claimed.

## Retained failures and repair

The November 9 ledger remains untouched at
`/Users/phodal/workspaces/pero/test-results/paper-program-live/handoff-143/README.md`.
A completed 0/3 rounds before MaxTokens; B completed 1/3 before its 60-request
limit. B's later searches also consumed candidate capacity with off-topic hits.
This repair does not establish better retrieval or guarantee three real rounds.

The original B report contains multiple quotations for each passage used in the
seven quote-rejected claims. A quote reconstructed from PDF lines differs from a
saved report quote and must remain rejected. The tool nevertheless required that
reconstruction and gave no usable selection route. PDF claims now accept a stable
`evidenceIndex` within that immutable report (section evidence followed by matrix
evidence); errors return the matching indices and their exact saved quotations.
The model chooses which source supports its claim. Unique references may omit
both quote and index; ambiguous references cannot silently select the first.
Explicit quotes, when supplied, must still match exactly. HTML rules are unchanged.
No claim is promoted from `needs_review`.

The bundled Skill also uses the existing finish-reason enum, and advises bounded
per-subquestion reports instead of one oversized review. This is guidance, not
proof that the model will stay under 4096 output tokens. A focused Harness case
proves MaxTokens sends neither a continuation feedback call nor another model
request. The hard stop and approved request/token/round limits are unchanged.

The live runner's old uncommitted startup patch is restored: enable the installed
App before resolve, use the current resolve contract, write/read the seed receipt
at the App data root, and retain case/model/revision/timing on failure.

## Observed verification

All paths below are relative to this worktree unless absolute.

| Check | Observed result | Evidence |
| --- | --- | --- |
| Program Python suite | 24 passing tests; includes line-range CRLF report → claim → reopened Store | `test-results/paper-143-repair/program-tests.log` |
| Claim selection | 13 table rows pass: exact/omitted/indexed quote, duplicate, matrix ambiguity, invalid selectors, foreign identities and quote/index conflict | `test-results/paper-143-repair/claim-tests.log` |
| Retained B replay | All 7 original quotes still rejected; all 7 require a choice; every returned choice resolves to exactly the saved bytes | `test-results/paper-143-repair/saved-claim-replay.json` |
| Real Python/Host/Harness, scripted model | 3 rounds, 25 loopback requests, 4 content reads, 4 artifacts × 4 versions; indexed claims cross the actual tool schema; no status polling | `test-results/paper-143-repair/three-rounds.log`, `test-results/paper-program-python/evidence.json` |
| Discovery/pause/restart/resume | Same ACP session, 1 download, cumulative model requests 11 → 18, 4 artifacts × 3 versions | `test-results/paper-143-repair/journey.log`, `test-results/paper-program-journey/` |
| Host/Harness terminal delivery | 8 loopback requests, 6 research requests, 4 artifacts × 2 versions; failed-delivery retry, late cancel and durable budget boundaries pass | `test-results/paper-143-repair/harness-terminal.log` |
| Go research checks | Focused race suite passes, including MaxTokens stop and durable request limits | `test-results/paper-143-repair/go-tests.log` |
| Quality machinery | 9 Python collector/scorer tests, 7 Node finalization/preflight/cleanup tests, adapter budget contract pass | `test-results/paper-143-repair/quality-tests.log`, `node-tests.log` |
| Live backend boot | Actual process emits readiness, publishes the seed at the App data root and exits cleanly; zero model/source requests | `test-results/paper-143-repair/live-bootstrap.json`, `verify-live-bootstrap.py` |
| Live readiness | All 5 engineering prerequisites pass; no live opt-in, provider credential or selected model in this executor | `test-results/paper-143-repair/preflight.json` |

The replay tests every offered quotation mechanically; it does not choose a
quotation on the original author's behalf or certify entailment. Old result and
review packet digests are unchanged. No completed human review form is created.

Runtime journeys reused existing local executables, not a rebuilt desktop:

- Host SHA-256: `9fa3ce64d462609fc7f4cf7a36a4b68aeaaa783506ba248c37a72fd5ce35466d`.
- Harness SHA-256: `b1965f56e418370464f2586a82cc6fb9fa6132f24efb0cd2d4a35a7bc344faed`.

They load this worktree's current Python, App schema, Skill and TypeScript adapter.
The changed Go test runs against this worktree's source. Binary hashes identify
what ran; they do not attest an unrecorded binary build revision.

## Reproduction

Prepare the canonical parser package with the normal build helper:

```sh
node --input-type=module -e 'import {packageSourceParsers} from "./scripts/build/source-parsers.mjs"; await packageSourceParsers(process.cwd(), "paper-agent")'
```

Use Python 3.12 with the existing pinned PDF dependencies (`pypdfium2==5.0.0`,
`Pillow==12.0.0`). This run used
`/private/tmp/pero-paper-review.gwadvk/cp312/bin/python`.
The system Xcode Python 3.9 cannot import the domain's union types. A fresh
checkout also needs the parser packaging step above; the first integration
attempt retained `failure.json` for that missing prerequisite before the pass.

```sh
PYTHONPATH=apps/paper-agent/backend "$PERO_RESEARCH_PYTHON" -m unittest discover -s apps/paper-agent/test -p 'test_*program*.py'
PYTHONPATH=apps/paper-agent/backend "$PERO_RESEARCH_PYTHON" -m unittest discover -s apps/paper-agent/test -p 'test_research_rounds.py'
"$PERO_RESEARCH_PYTHON" -m unittest discover -s tests/runtime -p 'test_research_quality.py'
node --test tests/runtime/research-quality/*.test.mjs
node tests/contracts/paper-research-budget.mjs
go -C harness/go test -race ./cmd/pero-agent-acp -run 'Test(PaperResearch|ResearchRequest|OrdinaryRequest)' -count=1
node tests/runtime/paper-program-python.mjs
node tests/runtime/paper-program-journey.mjs
node tests/runtime/paper-program-harness.mjs --no-status-poll
node tests/runtime/paper-program-live.mjs --preflight
```

For these journeys set `PERO_RESEARCH_HOST` and `PERO_RESEARCH_AGENT` to the
executables listed above (here `/Users/phodal/workspaces/pero/target/debug/pero-host`
and `/Users/phodal/workspaces/pero/target/debug/pero-agent-acp`). The last command
exits 1 when live prerequisites are absent; it makes zero provider requests.

## Remaining acceptance

The user subsequently authorized one new attempt for each of the two cases with
DeepSeek Flash and the unchanged limits below. The authorized preflight at
`test-results/paper-143-repair/preflight-authorized.json` passes every local check
except `providerCredential`: this executor has no `DEEPSEEK_API_KEY`. No provider
request has been sent. Authorization is settled; execution awaits secure credential
configuration in this executor. The prepared comparison keeps both frozen
cases and all original limits: each has 3 rounds, 60 model requests, 100 App
calls, 4096 output tokens/request, 12 minutes, 4 searches, 12 candidates,
16 reads and 3 downloads/30 MiB. There is no dollar-denominated cap in this
runner. Keep failures and measured/unknown usage, then collect new digest-bound
review packets. Never overwrite the November 9 attempts or change thresholds to
make either attempt pass. Public retrieval, real model performance, monetary cost,
independent human entailment/counterevidence review and UI/platform acceptance
remain separate and unverified in this increment.
