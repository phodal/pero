# Bounded Control Lab model acceptance

`tests/e2e/control-lab-live.mjs` is opt-in and requires a built Desktop, actual
Control Lab solvers, a prepared Python environment and an isolated display.
Run the deterministic Host and solver gates and the Linux Xvfb fixture in CI
before using a provider. The fixture uses an isolated ledger, a synthetic key
and a loopback-only provider; its outcome always has `realModel: false`.

For a separately authorized live run, supply a prepared `pero-agent-acp`
binary and its SHA-256, `PERO_CONTROL_LAB_LIVE_SCENE` (`p-golden` or
`active-filter`), `PERO_CONTROL_LAB_LIVE_RESERVATION` (1–6), and set
`PERO_CONTROL_LAB_REAL_MODEL=1`. The existing approved credential must already
be present in `DEEPSEEK_API_KEY`; do not put it in arguments or result files.
The launcher fixes the official DeepSeek endpoint, enables only the explicit
read-only Control Lab skill root, omits workspace/shell/coding/subagents, sets
`--max-tokens 8192` and `--max-retries 0`, and disables Computer Use in the
isolated Desktop settings. The Agent also advertises its normal chart and MCP
tools; the session record captures the complete advertised set.

All live ACP processes in this checkout reserve their whole per-process request
limit in `test-results/control-lab-live/attempt-ledger.json` before launch.
The first launch creates a ledger and adjacent attempt audit; they are shared
across scenes and are never automatically removed or refunded. A leftover lock,
corrupt ledger, a missing audit for an existing ledger, or an orphan audit
without its ledger fails closed. Do not delete or reset either file to obtain
more requests: if both are manually deleted, the launcher cannot distinguish
that from an initial launch. An append-only adjacent audit
records each transport attempt before it starts, so a crash in that small window
can conservatively overcount. This is an attempt bound, not a dollar limit.
Only provider-reported token usage is recorded; absent usage is `unknown`.

The receipt and exact exported evidence are written to a new scene directory.
A pass requires actual Skill list/read with matching digest, App tool calls for
the approved experiment, frozen rules and budget, complete final scenarios,
locked-candidate evidence, matching final report and independent export
re-evaluation. P golden must report its expected tracking FAIL. Exhaustion,
missing observations, cleanup errors or an incomplete Agent response fail the
live acceptance. A model's statement and a successful tool call are not a
scientific PASS. This process is not a blind evaluator: the same backend can
read both search and verification scenarios.
