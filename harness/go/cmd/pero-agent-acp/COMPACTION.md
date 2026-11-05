# Headless long-session compaction

Add `--context-window <provider-documented-token-capacity>` to the existing
`pero-agent-acp` launch. This is an explicit operator declaration, not a model-name
lookup. The same configuration is applied to print mode and new/resumed ACP sessions.
Omission preserves no-compaction behavior; `--disable-compaction` disables it even
when capacity is declared. Capacity must be between 1 and 1,073,741,824 tokens,
and must leave usable output, headroom and retention budgets.

Defaults when enabled:

- `--compaction-threshold .8`: start at 80% of declared capacity, or earlier
  when output reservation plus headroom requires it.
- `--compaction-retain-ratio .16`: retain the newest 16% of the message budget.
- `--compaction-summary-tokens 0`: resolve to `min(8192, context-window/8)`,
  further limited by the existing provider hard `--max-tokens` cap.
- Headroom equals the resolved summary cap. The main model output reservation
  is the explicitly configured `--max-tokens`; if omitted it is unknown/zero,
  not an invented provider default. Set it for a known output reservation.
- Existing engine defaults remain one pressure retry and one overflow retry.

The existing Point-derived native compactor, token meter, balanced tool ranges,
durable replacement brackets and cancellation behavior are reused unchanged.
Summaries use the same configured provider/model and process request budget;
compaction can therefore consume additional provider requests. A spent budget
cannot be bypassed by a summary call. Empty, non-shrinking or canceled summaries
do not replace prior history. Automatic pressure failures preserve the ordinary
turn path; overflow recovery retries only after durable surface progress.

Token measurement is an estimate, not a provider-tokenizer guarantee. A single
oversized uncompactable message or exhausted request budget can still fail.
No GUI, Projects, account settings, discovery, tools, or model switch is added.

Tests use only synthetic in-process providers and a loopback SSE fixture. They
cover CLI-to-ACP activation and reactivation on resume, pressure, overflow retry
bounds, empty summaries, cancellation, and durable JSONL round trips.

Historical tool text clearing is separately opt-in via `--tool-history-chars`,
`--tool-history-low-watermark` (default half the high watermark), and
`--tool-history-keep-recent` (default four). It runs without model compaction,
protects failures/recent results and retains original Session events for
ReadToolOutput. It requires a native workspace. Checkpoint file-operation
metadata and limitations are documented in
[runtime follow-up](../../../../docs/fitness/reference-runtime-improvements.md).
