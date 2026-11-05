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


Reopened during follow-up review: recovery accounting lets unrelated running
operations prevent a matching repair from resolving, and late process lifecycle
failures can reopen an ended turn and consume the next turn's usage. Both have
value-based and native JSONL reproductions. Linux Go race and standalone Bazel
CI at `c4251a64` both hit the 130-step review fixture's 10-second deadline.
A local CPU profile attributes 37.9% to context-plan construction versus 0.16%
to validation review: repeated surface-message decoding is the observed hot path.
Memoize immutable committed message decoding within Session while replaying and
validating projections as before. Test preview isolation, caller mutation, image
omissions and restored equivalence; retain raw benchmark evidence and deadlines.

Recovery follow-up implemented: only actual failures enter the unresolved set;
late outcomes stay owned by their original turn and cannot consume or interrupt
the next turn's recovery. Three added regression methods cover value tables and
native JSONL with asynchronous process receipts. All 33 reporter tests and 21
trial tests pass. Reanalysis preserves the retained polyglot source hash, usage,
42 windows and 210 assigned/10 outside responses exactly.

Context follow-up implemented in Session's existing plan builder: immutable
committed-message decoding is reused across requests without caching preview
admissions or derived image/prompt state. Repeated local race runs of the same
130-step fixture improve from 5.81–5.83 seconds to 0.88–0.90 seconds without
changing its deadline. All 36 Go package race suites, three relevant standalone
Bazel race targets and related vet pass. Preview isolation, caller mutation,
image/prompt/surface updates and restore equivalence are covered. New Linux CI
results remain separate evidence; no new paid benchmark or score is claimed.


## Live recovery and discovery follow-up

The retained native follow-up contains nine reviewed validation failures whose
shell exits were zero. The runtime currently treats these as ordinary settled
successes, so it supplies no warning and may clear earlier diagnostic history.
Distinct read/search arguments also evade the existing repetition reminders;
unchanged complete file reads repeatedly occupy model context.

Implement three bounded changes: advisory observations of structured validation
failure text despite exit zero (never a fabricated failed exit); one reminder
per continuous discovery phase without limiting requests; and reuse of identical
complete native file-read content only while its full anchor remains visible.
Explicit ranges, partial/media/plugin-resource reads remain full. Fresh reads
must still happen, original results remain recoverable, and removing an anchor
through pruning/compaction must restore content before the next model request.
Test real shell output, changed content with preserved timestamps, context
replacement/restore, mixed discovery operations and mutation/new-turn resets.


Live follow-up implemented and verified. Masked checks retain factual exit status
and attributed warnings; complete fresh reads reuse only visible content with
raw recovery and partial-summary expansion; distinct discovery arguments now
receive one phase reminder. Incremental surface receipts avoid re-copying old
stream events, and replacement size includes metadata. Seven related race
packages, five standalone Bazel targets, related vet and 34 reporter tests pass.
The frozen five-task native follow-up remains 4/5, uses 58 requests and 420,212
recorded tokens, and retains one explicit plus two reviewed masked check failures.
The live warning reaches the model; this does not establish acceptance repair.
Full version boundaries, limits and evidence: [live coding feedback](../fitness/live-coding-feedback.md).
