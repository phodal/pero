---
kind: issue
status: active
date: 2026-11-05
---

# Sol tool calls require Responses rather than Chat Completions

The operator's sol endpoint accepts plain JSON Chat requests but returns
`NO_AVAILABLE_CHANNEL` when they include a function. The same model and
function succeed through `/responses`, returning a valid function call.
The current official function-calling guide also requires Responses for sol.

Add an explicitly selected Responses protocol to the existing provider seam.
Keep manual, stateless context (`store: false`), retaining message phase,
function-call identity and encrypted reasoning items in durable block
extensions. Tool outputs must pair by call_id across process restart. Reuse
existing attempt limits, cancellation, argument/truncation validation and
bounded HTTP transport. Do not infer the protocol from an alias or replay a
failed Chat request. Initially support complete JSON responses explicitly;
reject unsupported streaming selection and output kinds.

Verify a two-request loopback tool round trip including persisted restoration,
reasoning/phase retention, malformed and truncated outputs, then repeat the
original real sol plugin task with independent tests. Freeze benchmark binaries.

References: https://developers.openai.com/api/docs/guides/function-calling and
https://developers.openai.com/api/docs/guides/migrate-to-responses . Pi's
`openai-responses-shared.ts` likewise retains reasoning signatures, call/item
identity and assistant phase; this is a reference, not runtime equivalence.
