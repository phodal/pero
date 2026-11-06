---
kind: issue
status: open
date: 2026-11-06
---

# A successful local check leaves an invalid delivery file set

The fresh Sol Responses `polyglot-c-py` attempt at `fbc8c668` ends normally,
but receives official reward zero. The original verifier stops before testing
Fibonacci values because `/app/polyglot` contains both `main.py.c` and the
model's local compiler output `cmain`, while it accepts only the source file.
The public request asks for a single file and gives a compiler command that
creates `cmain`; final directory hygiene therefore matters independently of
the observed compiler/program checks.

Native seq 75 compiles the program. Seq 87's self-check returns exit zero after
38 Fibonacci cases, leading zeros and invalid-input checks on both programs.
The model then submits without removing the executable. The only nonzero tool
exit in this attempt is an earlier file search with no matches, not a compiler
or validation failure. No masked validation failure or cleanup defect explains
the official rejection.

This attempt uses native deferred tools with the optional engineering profile
off and no delivery contract. The earlier DeepSeek polyglot acceptance used
feedback plus a public delivery contract. It is not a matched regression of
that opt-in feature. Existing feedback/contract implementations remain owned by
`engineeringprofile`; do not add benchmark-specific cleanup to Bash or delete
agent outputs in the evaluator.

Retain this first submission. A future, separately frozen experiment can test
the existing final public-requirement review against a broader task set.
The model must infer cleanup from public requirements; hidden verifier results
must not be supplied as repair instructions for a scored retry.

Evidence: `test-results/claude-openapi-complex-20261106/`,
`jobs/polyglot-c-py-sol/polyglot-c-py__HE9WRps/`, with native Session
`1f90946a-9a6d-460d-88d9-f64b2099885b`, identified by its source hash in the
[verification report](../design-docs/harness-complex-sol-evaluation.json).
