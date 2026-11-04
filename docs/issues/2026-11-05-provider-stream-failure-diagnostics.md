---
kind: issue
status: resolved
date: 2026-11-05
---

# Provider stream failures retain too little safe diagnostic information

The completed C4 benchmark Session ends with `TRANSPORT: openai adapter:
provider stream failed`. Its unfinished request has no response or usage.
The native turn preserves the public error, while the adapter keeps its live
cause private. The generic message loses the distinction between a network
timeout, DNS lookup failure, premature EOF and connection reset/refusal.
The old trace cannot establish which occurred.

Add fixed diagnostic labels for standard typed transport errors at the OpenAI
adapter boundary. Keep retry routing under the existing TRANSPORT code and
retain the private cause only in memory. Do not copy an error's URL, hostname,
query, headers, body or arbitrary text into the public message. Existing HTTP,
provider-event, malformed-payload and missing-DONE classifications retain their
precedence. This improves future native turn diagnostics, without replaying
requests or rewriting the frozen benchmark evidence.

## Verification

The adapter now appends a fixed DNS, timeout, premature-end, connection-reset
or connection-refused label when standard typed errors establish it. Unknown
causes retain the generic message. The existing TRANSPORT code and private
wrapped cause are preserved. Canary tests prove that credentials, query text,
private hostnames and arbitrary error messages do not enter the public failure.
A real loopback HTTP response truncated before its declared Content-Length
passes through the SDK and receives the premature-end diagnostic, with no
invented completion usage.

The complete OpenAI provider race suite, provider vet, standalone provider Bazel
target and Gazelle diff pass. This resolves future safe diagnostic loss for
these error types; the cause of the historical C4 request remains unknown.

## Reference receipt follow-up

CI run `41902835870` extracts 16 official DSH pairs and rejects the provider
classification pair because this fix changes its containing file. The selected
`httpErrorCode` callable is unchanged; the diagnostic labels are in
`normalizeStreamError`. Refresh the exact source receipt and verify all 17
pairs with the pinned official source and parser, retaining every landmark and
hash check. The unchanged mapping reproduces 16 extracted / 1 unavailable;
the updated receipt extracts all 17, with both classification landmarks
observed on each side. All 18 AST tests pass without skips. This is source
admission for review, not semantic equivalence.
