---
kind: issue
status: resolved
date: 2026-11-05
---

# Coding failure recovery does not reach the next useful attempt

The offline 87-trial review identifies four incomplete Write calls ending at
8192 output tokens, long compile/edit loops with no progress advisory, and a
separate 103,829-token polyglot context below an 800,000-token compaction trigger.
Final-only delivery feedback cannot help before timeout. Original results stay
frozen; these changes need independent acceptance.

Use the existing owners: explicit ACP caller recovery starts a new attributed
follow-up after max_tokens, retaining the original turn stop and never executing
partial calls. Add absolute trigger/retention settings to the current compaction
configuration. Extend bounded progress observations across edits and check public
delivery requirements during long feedback-enabled turns, without a tool cap.

References (local source pins, read only): Qwen `6fe83a82` incomplete-write
rejection guidance and result-aware bounded loop windows; Codex `fc39cfca`
model_auto_compact_token_limit; Pi `90b42bca` keepRecentTokens and valid
tool-call/result cut points; DSH `8bd07339` sticky max-tokens turn outcomes.
Do not copy recovered prompt bodies or create another compaction engine.

Verification must cover default no-recovery behavior, safe smaller follow-up
writes, exhausted recovery, cancellation/provider budgets, diagnostics across
edits, productive/polling counterexamples, mid-turn public delivery observations,
and compaction at an absolute budget despite a large advertised model window.
No benchmark score or token saving is inferred from synthetic acceptance.

Implemented with existing owners: explicit ACP recovery and a synchronous
plugin follow-up sharing the outer execution lifetime, absolute CLI compaction
budgets, a cross-edit 24-operation diagnostic window, and bounded PreStep public
acceptance reviews. Session reporting retains original stops, recovery attempts,
committed follow-up messages and mid-turn review references separately.

Acceptance: five related race suites and Bazel targets, vet/build, 26 reporter
tests and 18 AST parser tests pass. All 17 pinned mappings extract after the
three changed ACP file receipts are refreshed. An unchanged 222-operation
polyglot replay now emits two diagnostic advisories (original zero), first at
seq 20020. No paid/model benchmark run was added; task correctness and token
savings remain unmeasured for this change. See
[runtime verification](../fitness/reference-runtime-improvements.md#2026-11-05-follow-up-acceptance)
for the exact settings, source pins and limits. The broader benchmark's normal
spec/algorithm failures and verifier/environment issues are not closed here.
