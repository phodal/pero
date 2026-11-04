---
kind: issue
status: active
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
