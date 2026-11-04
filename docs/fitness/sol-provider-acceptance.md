---
kind: verification_report
status: running
date: 2026-11-05
---

# Native sol provider and plugin acceptance

These are real requests to the operator's explicitly configured custom provider,
not an official OpenAI endpoint, benchmark score or complete Claude Code parity
claim. Private receipts and native Sessions are under
`/tmp/pero-provider-compat-20261104/`; credentials are excluded from evidence.

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
A fresh combined fixture will run in `long-fixed-02/`, with an independent
source/binary freeze and unchanged original inputs. No saving claim is made
before its acceptance and coverage are checked.

The synthetic capacity and archive pressure do not establish the custom
provider's real context limit. All provider fixtures remain excluded from the
Terminal-Bench cohorts and their separately frozen binaries.
