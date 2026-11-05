---
kind: issue
status: active
date: 2026-11-05
---

# Compaction promotes assistant protocol metadata into a user checkpoint

A real sol Responses run committed its first pressure compaction, then failed
before the next request with `unsupported Responses replay metadata`. The
summary's text block retained assistant output item identity and phase while
the compactor inserted that same block into a synthetic user checkpoint.
The provider correctly refuses to replay assistant metadata as user content.

Materialize checkpoint summary blocks as plain text at the existing framing
boundary. Preserve original completion blocks in the compaction audit events;
retained assistant history must still keep its own opaque protocol metadata.
Do not relax adapter admission or change the frozen Terminal-Bench binaries.

Extend the real CLI pressure/restore control with Responses output metadata,
then repeat the actual model context-pressure and process-restart fixture.
