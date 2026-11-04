---
kind: verification_report
status: verified
date: 2026-11-05
---

# Native sol provider and plugin acceptance

These are real requests to the operator's explicitly configured custom provider,
not an official OpenAI endpoint, benchmark score or complete Claude Code parity
claim. Private receipts and native Sessions originate under
`/tmp/pero-provider-compat-20261104/` and are preserved, with source hashes, under
`/Users/phodal/workforce/openstar-agents/reports/coding-benchmark-2026-11-04/provider-compatibility/`;
credentials and binaries are excluded from the evidence export.

## Protocol and model access

The advertised sol model accepts plain JSON Chat but returns 503
`NO_AVAILABLE_CHANNEL` for Chat functions. The same function succeeds through
Responses. The explicit JSON Responses adapter preserves call/item identity,
assistant phase and encrypted reasoning across native restoration. It uses
stateless requests and rejects unsupported output kinds; streaming and hosted
tools are outside this implemented subset. Server-supplied instructions and
metadata remain untrusted remote context.

The requested `gpt-5.6-terra` route returns 403 on its one actual request, with
no usable completion or usage. This is an access failure, not a reasoning
failure. Missing failed-request usage is unknown.

The first successful native sol task uses six requests and six paired tool
calls, passes all nine original ledger tests independently and preserves their
hashes. Claude-format skill expansion and pre/post command hooks execute.
Earlier failed Chat and Responses-replay attempts remain preserved.

## Deferred skill loading

A first paired task reveals that deferred loading silently omits slash skill
content. Although its implementation passes nine tests, result.json is missing:
that requirement appears only in the omitted skill. Its lower token count is
excluded from equivalent-success comparisons.

After the registration-availability fix, both modes receive the skill-content
user message at seq 9, pass all nine unchanged independent tests, write
`{"exit_status":0,"tests":9}` and execute hooks:

| Observation | Eager | Deferred |
| --- | ---: | ---: |
| HTTP requests | 7 | 9 |
| Recorded total tokens | 79,822 | 69,359 |
| Declared schema exposure, JSON bytes | 174,181 | 39,116 |
| Schemas never called in that Session, bytes | 153,776 | 4,048 |
| Prepared payload bytes | 262,648 | 159,883 |
| Paired tool calls | 6 | 9 |
| Explicit failed calls | 1 | 0 |

The eager failure is an `rg --files` search returning 1 for no matches, not a
failed final validation. This is one stochastic pair; different request paths
and cache use prevent a causal or general saving claim. Byte exposure is not
token attribution. Receipts: `*-pair-fixed-receipt.json` and independent
`*-pair-fixed-verification.json`.

## Context pressure and process restoration

The first successful five-phase fixture adds 300 synthetic historical rows per
phase to create context pressure, declares a 16,000-token capacity, and restarts
the ACP process after phase three. Both processes restore the same native
Session and exit cleanly. All 20 original parser/format/CLI/exact-integer tests
pass independently, input hashes remain unchanged, and checkpoint sentinel
`LGR-20261104-7F19` survives through phase five.

It makes 66 HTTP requests: 31 main responses and 35 summarization requests.
Fifteen summaries apply; 20 fail because they do not shrink the selected history.
The old binary retains no usage for those rejected summaries. The reanalyzed
695,413 recorded tokens include the 15 accepted summaries, with incomplete
coverage explicitly marked. This fixture also predates the deferred slash fix;
its explicit phase prompts establish long-task behavior, not combined skill
acceptance. An earlier metadata failure remains in `long-first-failed/`.

New responses retain compaction usage before validation. Pressure backoff avoids
repeatedly summarizing the same rejected selection; manual/overflow compaction
can still run.

The combined fixture in `long-fixed/` exposes a different problem: every
compaction republishes full skill instructions even when they remain visible.
The model repeats the first-read step without implementing the parser. This
attempt is intentionally stopped, retaining 29 HTTP attempts, 28 responses,
18 accepted compactions, six identical tool repeats and 513,570 recorded tokens.
The cancelled request has unknown usage; process cleanup exits zero. It uses
source `9c9f9e47` and binary SHA-256
`2483cb2cd6a0ab3c608670f3bc1c14c62ce4f4c92500aa1da9237f163e4f98aa`.

The surface-visibility fix restores only missing exact skill content. A short
activation notice does not count as a full body, and reminders explicitly
continue checkpoint progress. The multi-compaction runtime regression passes.
The fresh combined fixture in `long-fixed-02/` now completes five normal phases
and passes all 20 unchanged independent tests. Two processes exit zero and
restore Session `cb7af306-99ff-4684-a429-fa8dd7fb31a1` across the restart after
phase three. Checkpoint sentinel `LGR-20261104-7F19` survives through phase five.
The frozen source is `39b408e89cdd40313a1b92e700ebcb1ccd7da1f4`; binary SHA-256 is
`40b2b04e76558e8420465ba9b0da58c470baa9c7009baa1d2214ae77d803217c`.

All 68 HTTP requests have completed response usage: 42 main responses record
732,166 tokens and 26 compaction responses record 302,178 tokens. The total is
1,034,344: 380,477 uncached input, 613,760 cache read and 40,107 output tokens.
Twenty summaries apply; six fail to shrink but retain their usage and exact
error evidence. Twenty-seven identical pressure attempts are skipped. The trace
has no explicit failed tool calls or native turn errors; 11 identical calls
remain review observations. One original skill invocation requires six
restorations as content leaves the active surface. Receipts are
`long-receipt.json`, `native-freeze.json`, `independent-verification.json` and
`summary/summary.json` in the fresh fixture directory.

This establishes acceptance and complete recorded response usage for this
fixture. The older fixture has incomplete usage and lacks deferred slash skill
content, so these runs do not establish a token-saving comparison.

The synthetic capacity and archive pressure do not establish the custom
provider's real context limit. All provider fixtures remain excluded from the
Terminal-Bench cohorts and their separately frozen binaries.
