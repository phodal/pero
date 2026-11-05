---
kind: issue
status: resolved
date: 2026-11-05
---

# Coding recovery needs diagnostic and validation context

At `32d2af55` bounded failure reminders, output recovery and absolute compaction
budgets exist, but repeated experiments have only count-based feedback. Failed
tool text is always retained, model launch settings are assembled manually,
Edit accepts one replacement, and Session reports do not group recovery chains.
The retained polyglot attempt needed 220 responses, with 206 Bash calls among
222 operations. No additional benchmark score is inferred from this incident.

Implement six scoped changes using existing owners: diagnostic categories and
fingerprints; validation progress tied to settled contract evidence and input
digests; opt-in duplicate error projection with original readback; explicit
versioned model launch profiles with CLI overrides; atomic same-file disjoint
batch edits; and offline per-recovery-chain usage accounting. Preserve official
timeouts, permission admission, full original Session evidence, tool-call/result
pairs and unknown usage. No hidden tests, automatic model routing or new request
ceiling. References are the pinned Qwen, Codex and Pi sources documented in
`docs/fitness/reference-runtime-improvements.md`.

Acceptance must cover changed/unchanged validation evidence, category hints and
unknown/uncertain results, duplicate error readback after restore, profile/model
mismatch and overrides, overlapping/failed batch edits with no write, and chain
accounting without double counting cached or missing usage. Run relevant Go
race/Bazel suites and offline Python tests before updating PR #116.

Implemented all six scoped changes. Verification: seven relevant Go race suites
and seven standalone Bazel targets; final CLI/tool regressions rerun after
additional profile/reused-ID cases; related vet and native build; 30 offline
reporter tests and 21 trial tests; 18 pinned AST parser tests with 17 selectors
available after refreshing the unchanged physical-read selectors' file receipts.
No paid benchmark was rerun. Full limitations, flags and retained polyglot
recovery-window evidence: [verification](../fitness/validation-driven-coding.md).
