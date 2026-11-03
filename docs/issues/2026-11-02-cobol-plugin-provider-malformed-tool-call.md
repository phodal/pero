---
kind: issue
status: open
date: 2026-11-02
---

# Real COBOL plugin verification observed malformed model tool arguments

During the owner-built Point COBOL analysis App verification, one independent
`deepseek-flash` reject-path run ended with
`MALFORMED_RESPONSE: tool arguments must be a JSON object`.
The provider adapter rejected it at `harness/go/providers/openai/stream.go`; this
does not establish a Point domain or App receipt failure. No validation was relaxed.

The failed run preceded event capture in the migration driver, so its raw provider
response and whether it reached approval were not retained. Do not infer either.
A later fresh run with ACP event capture completed the reject path with one approval
and zero receipts; this is separate evidence, not a fix for the provider failure.
The allow run also completed with one content-bound receipt.

The driver now saves ACP events before asserting completion and retains a separate
failure record on session errors. A follow-up diagnosis needs a reproduced raw
provider response and must distinguish malformed upstream arguments from stream
assembly defects. Do not add automatic retries or dispatch malformed calls.

Evidence: `test-results/point-cobol-app/real-reject-events.json`,
`real-reject.json` and `real-allow.json`. The original failed attempt is recorded
here from its observed error; those success files do not reproduce it.
