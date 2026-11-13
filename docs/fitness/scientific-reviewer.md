# Scientific evidence Reviewer verification

Date: 2026-11-13. Source: independent branch
`codex/science-p0-scientific-reviewer`, based on
`c4f4ecdaf85b0a23dc3b04e1581bd680bba67b23`.
Runtime implementation: `38e2397d`, `6f8251e0`, `a7e85ed6`, `368a6c15`.
Task: [bounded evidence reviewer](../issues/2026-11-13-scientific-evidence-reviewer.md).

## What the feature does

The built-in Go Agent advertises a separate **Scientific Reviewer** setting in
the existing shared Composer controls. Manual is the default. Automatic reviews
once after the original ACP prompt, including existing bounded continuations,
settles normally. `/review` explicitly requests a fresh review. Host-added App
Use workflow text does not accidentally route that command to the main model.
Attachments must first be submitted in a normal message; the command explains
this boundary instead of silently ignoring them.

The private existing Harness child receives only `structured_output`, a fresh
context and a hashed packet. It cannot run tools, spawn reviewers, request
approval or change workspace data. Packet limits are six recent text answers,
forty evidence records and a 48,000-byte encoded budget (domain maximum 64 KiB).
Omitted or truncated records are marked. Exact Host artifact delivery receipts
retain artifact ID, version and SHA-256; receipt metadata does not supply bytes
that were never read.

The review has at most two model steps, at most 4096 output tokens per step
(or the parent's smaller ceiling), ninety seconds and twelve findings. Existing
provider request/retry budgets still apply. There is no repair loop. Later
user-requested turns receive open findings and can record a concrete correction
or not-applicable reason through `scientific_review_disposition`. `/review
resolve|dismiss <finding-id> <reason>` provides the same state transition.

Structured reports and dispositions live in the original session journal.
Shared Chat renders them; Save reply uses the existing versioned session
artifact store and Scientific Viewer/Inspector. Updating a disposition preserves
the original message quote, packet and exact evidence references. A response
marked resolved remains an unverified response to a model opinion.

## L0: values and actual Harness/ACP wiring

Passed:

```sh
go -C harness/go test -race ./scientificreview ./scientificreviewer ./acp ./cmd/pero-agent-acp
go -C harness/go vet ./scientificreview ./scientificreviewer ./acp ./cmd/pero-agent-acp
git diff --check
```

Domain tables exercise no findings, numerical conflicts, missing execution,
unsupported citations and approved-plan omissions as constructed records. They
reject invented message/evidence IDs, nonmatching quotes, invalid certainty,
unversioned artifact references and dispositions without reasons. These tests
validate the contract, not a model's scientific judgment.

Actual Harness tests exercise structured child output, absence of executable
authority, default-off and explicit automatic/manual modes, unavailable output,
next-turn guidance, reasoned dispositions, durable resume, exact Host receipt
identity, escaped-history bounds and retained user/approval/planning facts. A
real injected continuation takes two parent steps within one turn; no review
runs at its intermediate stop, one review runs after final `turn/end`, and a
duplicate settlement consumes no additional model call.

ACP tests cover persisted settings and discovery, idle admission, rejection of
invalid/busy configuration, manual command bypass of the main model, extra Host
workflow text, actionable attachment rejection, and live/history projection.

## L1: actual development Electron

The isolated checkout built its own Host, Harness, shared GPUI Wasm, Web,
Desktop and Scientific Viewer bundle. Existing installed JavaScript dependency
directories were reused read-only; no source or build output from the original
working tree was copied into this checkout.

Command:

```sh
node tests/e2e/scientific-reviewer.mjs
```

Passed. Actual shell output retained `mean: 2`; the scripted main answer said
`mean: 9`. Automatic and manual Reviewer calls each produced an anchored open
finding. A later user turn received the open findings and corrected the answer.
Both frozen reports received explicit resolution reasons. The actual Save reply
control saved a Markdown artifact, which was opened and read in the real
Scientific Viewer/Inspector in light and dark themes. Restart retained the mode,
report text and exact saved bytes; reopening the report spent no requests.

The model in this test is an explicitly scripted loopback provider: five total
requests, three main-Agent requests and two Reviewer requests, no page or
provider errors. The shell, Harness, ACP, Host, shared UI and artifact store are
real development components. Final local evidence is in
`test-results/scientific-reviewer/`:

- `result.json`, `frozen-packets.json`
- `reviewer-menu-auto.png`, `open-finding-light.png`
- `saved-report-inspector-light.png`, `saved-report-inspector-dark.png`
- `restored-report-dark.png`

Saved artifact `7a033200-8187-4fd3-8fa7-039d444e3853`, v1, 1643 bytes,
SHA-256 `90299d7118e0079a8ef5cd237ce3afecd9251955400cec316fb40c321cda3c25`,
source `message:11`, was unchanged after restart. Earlier `failure-*` files are
diagnostics from the now-fixed schema/admission issues; final `result.json` and
the final screenshots are the acceptance evidence. Screenshots and generated
reports remain untracked; no binary files are committed.

## L2: available real provider

Passed `TestScientificReviewerLive` with explicitly supplied existing provider
configuration: **DeepSeek `deepseek-flash`, one actual HTTP request**, no retries.
The test runs the real native shell to compute `(1+2+3)/3`, writes and reads
`results.json` with `mean: 2`, then retains the deliberately incorrect answer
“the saved mean is 9”. The real Reviewer returned a completed `numeric_conflict`
finding anchored to that exact original answer and the real native tool result,
including the observed approval decision. This validates this particular
evidence-consistency interaction, not research correctness or model reliability.

Reproduce only with explicit opt-in and an existing credential in the environment:

```sh
DEEPSEEK_REAL_API=1 go -C harness/go test -count=1 -run '^TestScientificReviewerLive$' -v ./scientificreviewer
```

The smoke has a four-request hard ceiling, zero retries and a 110-second test
deadline. Its optional absolute `PERO_REVIEW_LIVE_REPORT` path saves only the
frozen report and nonsecret metadata. The observed sanitized receipt is
`test-results/scientific-reviewer/live-provider.json` (local, untracked).

## Acceptance limits

All findings are `model_review`: model opinion is distinct from mechanical
checks, independent recomputation and human scientific acceptance. Empty
findings never display scientific PASS. Correctness, citation entailment and
plan coverage beyond the bounded packet remain unverified. The real-provider
smoke specifically covers the arithmetic contradiction; other concern
categories have constructed-record contract coverage.

No Native GPUI application or signed release package was tested. No real
research project, external account, remote cluster, GPU, deployment or
scientific acceptance is claimed. Non-Harness providers retain their existing
capabilities; they do not gain this built-in Agent setting automatically.
Restarted historical Electron chats retain the existing closed/read-only
behavior, so the Electron restart check proves retained viewing, not submitting
a fresh review in that closed chat. Actual session resume and further review
commands/dispositions are covered separately at the Harness/ACP boundary.
