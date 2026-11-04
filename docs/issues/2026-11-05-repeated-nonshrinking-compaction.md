---
kind: issue
status: active
date: 2026-11-05
---

# Pressure checks repeat summaries that cannot reduce the selected history

The real five-phase context-pressure fixture makes 35 summarization requests:
15 summaries apply, while 20 fail because their framed output is at least as
large as the selected history. Pressure checks run before every model step, so
an unchanged old checkpoint can be summarized repeatedly while recent messages
remain inside the retained tail. These failures consume requests and tokens.

Remember the last nonshrinking automatic pressure selection and its resolved
policy. Skip another pressure request for the same selected content and policy;
retry when that selection grows/changes or policy changes. Explicit compaction
and actual context-overflow recovery remain available. Record the skip in the
Session. This is an agent-local optimization, not persistent policy or a change
to the frozen Terminal-Bench binaries.

## Verification

The loop regression proves repeated identical pressure checks consume no new
summary request; changed selected history retries; explicit and overflow
compaction bypass the pressure backoff. Actual JSONL response usage survives
restoration for rejected summaries. CLI and core/skills/plugin-runtime race
tests, standalone Bazel and vet pass. A fresh real five-phase fixture is needed
to measure observed skips and acceptance; no token-saving percentage is claimed.
