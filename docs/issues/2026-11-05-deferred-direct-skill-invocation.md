---
kind: issue
status: resolved
date: 2026-11-05
---

# Deferred tools silently omit direct user skill expansion

The same real sol ledger task passes in eager mode, but deferred mode omits
the entire skill-invocation message. The model passes nine implementation
tests yet misses result.json, whose requirement exists only in the skill.
Its lower token count is therefore not a valid equivalent-success comparison.

Slash expansion and post-compaction reattachment check the Skill registration's
model-visible executable view. Deferred presentation hides that definition
until discovery, although the user has explicitly invoked an authorized skill.
Provide a registration identity check against the authorized pool before
deferred discovery. Keep scoped restrictions, shadows, owner lifetime and
other authoritative presenters effective. Do not activate model tools merely
because a slash command or reattachment is accepted.

Extend direct invocation controls with deferred, denied and shadowed cases,
then repeat the real paired task and independently check every artifact/test.

## Resolution and verification

Direct expansion and reattachment now use exact authorized registration
availability before deferred discovery. Denied/shadowed controls remain
unavailable. Skills/core race tests, vet, standalone Bazel and Gazelle pass.

Both real sol Responses tasks now contain the skill-content user message at
seq 9, pass all nine unchanged independent tests, and produce result.json with
exit_status 0 and tests 9. Eager used 7 requests / 79,822 recorded tokens;
deferred used 9 requests / 69,359 tokens. Declared schema exposure was 174,181
versus 39,116 bytes. This single stochastic pair establishes functionality and
an observed difference, not causal or general token savings. The failed first
pair remains preserved and is excluded from the equivalent-success comparison.

Private receipts: /tmp/pero-provider-compat-20261104/*-pair-fixed-verification.json.
