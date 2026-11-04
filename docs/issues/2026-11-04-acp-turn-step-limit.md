---
kind: issue
status: resolved
date: 2026-11-04
---

# ACP retains a hidden 512-step ceiling after removing the request cap

The uncapped Terminal-Bench `dna-assembly` trial ends with
`harness: turn 1 exceeded 512 steps` before its official 1,800-second deadline.
ACP returns a request error, Harbor records `NonZeroAgentExitCodeError`, and
the official verifier returns reward 0. The original result and native Session
remain unchanged in full-04. Removing the provider request limit alone does
not make the run governed exclusively by the official timeout.

The harness defaults each turn to 512 steps, while ACP and its CLI do not expose
an override. Add an explicit unlimited step setting without changing the
bounded default. ACP must apply the host setting to both new and resumed
sessions. Unlimited steps must continue to honor cancellation and provider
budgets. Explicit child budgets remain with their existing owners.

The original cohort stays pinned. Step-limited and timeout-affected tasks need
separately recorded follow-ups with the corrected launcher and their official
timeouts; results must disclose the different binary and execution settings.

The fix adds `harness.UnlimitedMaxSteps`, propagates the host limit through new
and resumed ACP sessions, and exposes `--max-turn-steps` to ACP and print mode.
The default remains 512; zero explicitly disables it in the CLI. The Harbor
diagnostic launcher now supplies both `--max-requests 0` and
`--max-turn-steps 0`.

Validation includes all harness/ACP/subagents/CLI race tests and targeted vet.
Behavioral coverage passes the former ceiling, retains positive bounds for new
and resumed sessions, and preserves external cancellation. A real CLI process
with a local synthetic SSE provider completes 514 requests at zero, stops at
two with a positive limit, and rejects a negative operator value before any
request. The same controls also pass with the actual pinned Linux amd64 binary
under Rosetta: 514 calls complete, a positive limit stops at two, and negative
input is rejected. The isolated control has no container network, uses a local
synthetic provider, and retains its image identity, binfmt state and result
hashes. These synthetic requests are excluded from benchmark usage. The clean
source `561febe7` produces that binary; the original `2f02e684` binary and official
results remain unchanged.

The later original `schemelike-metacircular-eval` trial also stops at exactly
512 responses, after 2,001.2 seconds of its official 2,400-second agent limit.
It records raw reward zero and 85,891,880 committed tokens. Source-bound
`analysis-scheme-step-limit.json` under the full-04 artifact root preserves the
result, Session, task and report hashes. It is included in the same explicit
follow-up selection; this second occurrence does not change the original score.

## Cached-image corrections during registry outage

The two observed step-limit cases have unchanged official images cached. Run
these corrections before the remaining uncached baseline tasks, using the
already frozen unlimited-step binary and strict termination adapter. Keep a
separate Harbor job and result hashes. Pause registry-job admission until both
finish; do not exceed two concurrent trials. Final corrected selection includes
these results once and selects any additional affected cases after all 89
baseline slots finish. The baseline and full-suite completion guard stay intact.

## First real unlimited-step results

Both cached corrections complete at their official agent deadlines with raw
zero. DNA records 444 responses with the 1,800-second agent timeout and lacks the
required output file. Scheme records 686 responses with the 2,400-second agent
timeout and fails its aggregate
functional check (`failed == 62`). Both exact owned agents receive SIGTERM and
are confirmed stopped before their verifiers start; timing audits observe no
late responses, calls or returns. Actual container binary hashes match the
frozen unlimited binary. The raw original hashes remain intact. This validates
cap removal and termination on these runs, not correctness or general gains.
