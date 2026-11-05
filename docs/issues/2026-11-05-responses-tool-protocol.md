---
kind: issue
status: resolved
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

The first real native trial reached three successful Responses requests and
four paired tool calls, then failed before request four. A Write argument
containing `->` was HTML-escaped during durable message serialization while
the provider replay string retained the original character. Comparing compact
JSON bytes incorrectly classified the equivalent strings as different.
Compare parsed JSON values with `json.Number` to preserve numeric precision,
and exercise escaped text plus an integer above 2^53 in the restoration test.
The failed receipt and native journal remain in the private compatibility run.

The corrected native sol trial completed six actual Responses requests and
six paired tool calls (two each Read, Bash and Write). Its unchanged nine-test
suite passed independently, result.json reported the observed exit status and
test count, and the Claude-format skill plus pre/post hooks executed. This
establishes this protocol and plugin subset; hosted tools and streaming remain
unsupported, and long-context/resume acceptance is tracked separately.

References: https://developers.openai.com/api/docs/guides/function-calling and
https://developers.openai.com/api/docs/guides/migrate-to-responses . Pi's
`openai-responses-shared.ts` likewise retains reasoning signatures, call/item
identity and assistant phase; this is a reference, not runtime equivalence.
