---
kind: incident
status: resolved
---

# Headless Workflow intent cannot resume from JSONL

The first disk recovery test started an owned Workflow through the headless
API before a controlling model turn. Its intent serialized turn:0. Session
resume rejects any present turn number that is not positive, so the otherwise
valid JSONL could load but could not activate a new Agent.

The optional intent correlation now omits a zero turn, rather than inventing a
turn or relaxing Session validation. Calls within model turns still persist
their positive turn. Deduplication retains the same default-zero correlation
for headless calls. The disk recovery regression uses this actual admission,
a real member Write/approval and fresh runtime/persistence objects.
