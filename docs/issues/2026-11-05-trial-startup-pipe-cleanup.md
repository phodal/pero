---
kind: issue
status: resolved
date: 2026-11-05
---

# Trial startup rejection leaves the agent input pipe open

The explicit HTTP admission regression emits a Python ResourceWarning after
the native agent rejects its endpoint before ACP initialization. The trial
client closes stdin only while the agent is running; an already exited agent
therefore leaves the parent-owned pipe open until garbage collection.

Close that pipe in the unconditional process cleanup path as well. Preserve
the rejected trial, zero HTTP requests and observed process reclamation.
Extend the existing actual CLI admission regression to collect resource
warnings after releasing the failed client, then run the trial suite.

Resolved: the unconditional cleanup closes stdin even when startup has already
exited. All 20 trial tests pass; both HTTP admission cases collect no resource
warnings and retain their expected 0/3 requests and reclaimed processes.
