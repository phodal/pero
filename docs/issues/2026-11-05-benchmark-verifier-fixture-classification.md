---
kind: issue
status: active
date: 2026-11-05
---

# Raw benchmark rewards hide verifier fixture failures

The completed `reshard-c4-data` trial has raw official reward zero, but its
only pytest case errors during fixture setup. Hugging Face network/TLS requests
fail, and the held-out C4 shard has no local cache. The functional assertion
never runs. CTRF maps that setup error into one failed test; reward alone cannot
distinguish it from a failed candidate assertion.

There is independent candidate failure evidence: the last self-test reports
`FileNotFoundError` and unequal output files. Its next provider request ends
with a generic stream transport error. Neither fact establishes the outcome of
the unavailable official functional check, and the transport's underlying cause
is not retained. Preserve the original reward, inputs, trace and verifier log.

Add source-bound verifier-stage evidence to both benchmark exports and their
Inspector labels. Keep raw reward accounting separate from setup/collection
errors. A completed 89-task attempt cohort must not be described as 89 successful
functional verifications. Do not reconstruct a deleted candidate from tool
history or substitute synthetic data for the official held-out shard.

## Reporting implementation and control

The external benchmark exporter now attaches result/stdout/CTRF hashes, pytest
terminal summary, verifier stage and whether passed/failed assertions were
observed. Both the baseline and mixed correction export retain raw rewards and
show the stage in Inspector labels; final verification checks the derived
evidence against retained files. A control over the 51 available verifier logs
identifies 50 ordinary pytest reports and exactly this fixture setup error,
with no observed assertion. The receipt is JSON round-trip stable. Final
89-task export verification is still pending; the data retrieval error itself
is not claimed fixed.
