---
kind: issue
status: resolved
date: 2026-11-05
---

# Read reports a plugin error for scratch files outside the workspace

The partial 59-task Terminal-Bench snapshot contains five Read failures for
`/tmp/out.png`, `/tmp/design_copy.py`, `/tmp/model.py`, `/tmp/ref.png` and
`/tmp/viz/masks.png`. The launch workspace is `/app`. The Claude Read adapter
routes absolute paths outside that workspace to the selected plugin-resource
reader, which rejects them with a plugin-only message. The denial is correct,
but the diagnostic describes an irrelevant plugin selection problem and gives
no recovery action for a scratch file.

Keep workspace and exact plugin-resource authority unchanged. State both Read
scopes in the denied-resource diagnostic and tell the agent to place scratch
files inside its configured workspace. Do not add a broad external-file read,
a Bash fallback, automatic copying or task-specific runtime instructions.

Evidence: `partial-baseline-59/display-summary.json` under the full-04 artifact
root retains source hashes and native call seqs 3492, 14880, 2491, 64642 and
3128 respectively. This is a diagnostic correction; token or success gains
require a separate evaluation. Frozen benchmark binaries remain unchanged.

## Validation

The full native tools and ACP CLI package suites pass with the race detector:
`GOWORK=off go -C harness/go test -race ./nativetools ./cmd/pero-agent-acp`.
Existing cases retain denied outside reads/writes, selected read-only plugin
resources and workspace authority. This change only replaces the diagnostic
string; no new benchmark or reduction in failed calls is claimed.
