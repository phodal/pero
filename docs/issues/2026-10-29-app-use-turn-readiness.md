---
kind: incident
status: resolved
---

# App Use could arrive before the Host turn event

During the actual Electron ACP → MCP → App acceptance flow, the third prompt in
an existing session failed with `APP_SESSION_INACTIVE`. The Agent reused its
loopback MCP connection immediately, while the Host's asynchronous event writer
had not yet delivered `turn_started` to Desktop. The session existed and the user
had submitted a new prompt; the two transports had different delivery timing.

Desktop now records a trusted prompt and waits on the actual Host turn-start
signal, with a five-second failure bound. Cancel/close interrupts that wait.
It does not authorize a turn from App-supplied data or insert a guessed sleep.
The repeated-turn, standing-read, revoke and reapproval scenarios passed in
`tests/e2e/app-use.mjs`. Results are recorded in `docs/fitness/app-use.md`.


## Product draft selection before Host readiness

Final Product regression reproduced a separate ordering defect twice. Shared
Chat creates its scoped draft as soon as its Wasm surface initializes. The new
selection intent was forwarded to `product:session`, whose readiness check
rejected it before the Host was ready. The UI interpreted that rejection as a
session error and closed an otherwise valid unsent draft. Later Host readiness
could not make that closed draft sendable.

The Product shell now sends local selection through `product:app-use`, matching
the Workbench boundary. Only actual session commands wait on Host readiness.
Acceptance holds the real Host's startup output behind a file signal, initializes
Chat first, then releases the Host and uses that same draft. This makes the
ordering explicit instead of relying on machine speed.

The gated-start Product flow passed: the pre-Host draft remained `draft`, kept
its identity and completed the complete App Use/context/file/write sequence.

## Initial workspace binding after automatic preparation

The later automatic Agent-preparation change exposed a distinct startup
regression: the first Host workspace event replaced the existing unbound draft
as if the user had switched an already-bound session to another directory.
The gated-start App Use CI caught its thread identity changing before a prompt.

Initial workspace discovery now binds an unbound `Draft` in place. Existing
bound-session workspace changes retain their replacement behavior. The gated
acceptance keeps the original thread identity assertion and now waits for the
intended automatically prepared `idle` state, with the fixture session ID, no
error and no messages, instead of requiring the obsolete unprepared state.

Local verification: 27 Chat UI/contracts tests, the affected Chat UI Wasm
compile check, JavaScript syntax and diff checks passed. The complete Chat Web
check stopped on five missing generated font files; the local workspace also
lacks a built web distribution and Xvfb. The corrected real Electron gated-start
flow remains pending CI, rather than being reported as a local UI pass.


## Bounded observation content in the fixture

The next real Electron run (40924600214, tested merge e789050c) passed the
initial identity/preparation assertions and policy-denial scenario. Its full
observation then correctly returned a `content_reference` for 20,265 bytes.
The synthetic ACP fixture assumed every successful result was inline JSON,
then accessed `dom.find` on the reference rather than the observation.

The fixture now follows the advertised same-conversation `content_read` tool.
It consumes the complete observation needed by its existing assertions and
normalized transcript, without changing production result budgets. Reads remain
at 16 KiB, with a fixture-only ceiling of 128 KiB and eight requests; contiguous
UTF-8 byte ranges, artifact identity/size, final SHA256 and complete JSON are
required. Missing, malformed, truncated, nonprogressing or over-budget results
fail rather than being treated as an empty observation. No preview or host file
is used as a substitute. Existing DOM, stale-ref, approval and capture assertions
remain unchanged.

Ten local checks passed using the actual scoped `ContentArtifacts` reader,
including multi-chunk Unicode, inline values, cross-conversation rejection and
malformed/error/truncated/tampered results. Real Electron completion remains
pending the next CI execution.

## Actual capture preview geometry

Run40926789882 at head890b843 passed initial draft identity, denial, full App Use
operations and bounded content-reference retrieval, then failed opening the image
annotation dialog. The retained frozen-draft screenshot shows all three context
chips and the image Preview button. The fixed canvas-relative click targets empty
space after current typography wraps the chips; no capture or dialog error was
observed. Artifact12920773407 SHA256
`4146f86c26973084480c77c435da541d95e8b6dd690f5e4c9440a6903632cbb3`.

Reuse the existing painted ViewBounds diagnostic for attachment Preview controls,
keyed by current reference ID and pruned with composer attachments. The test finds
the single image reference and clicks its actual button center through the iframe
canvas origin. It retains the real dialog, undo, annotation, frozen-context and
ACP assertions, and checks the projection clears after submission. No layout,
preview action, timeout or acceptance predicate is relaxed.

A finite audit of the remaining Product and Workbench suites found their DOM
labels and App Use response contracts still present. Remaining canvas coordinate
clicks select composer, permission or navigation controls; they are not changed
without evidence of failure. Full remaining Electron execution is required.
Local Wasm compilation, Chat UI concept tests and JS syntax checks passed; this
environment still lacks the built Web distribution and Xvfb for native E2E.

## Full fixture completion budget

Repeated validation at head ea0d004 (run40959586302) passed Product App Use but
hit the Workbench full scenario's single 30-second result poll. The screenshot
shows the final `runPlan` still running; the subsequent retained state already
contains the successful full result, all 25 completed tool calls, the same
conversation and no error. This is not evidence of a missed submit or routing
failure. The first capture was at21:46:38.093Z and the final capture at
21:47:02.301Z, followed by stop/start/runPlan; the timeout was21:47:07.095Z.
Artifact12936275530 SHA256
`f8be8218c1bc1edae8ccfb4f2241222463dd685290d5a7587e90673b7266fc9f`.

Both full-scenario consumers now use the same finite fixture progress contract:
25 expected sequential tools, with only newly completed IDs advancing progress.
Old tool IDs and messages are snapshotted before submission; the original thread
and App scope remain fixed. Repeated status/text updates do not refresh a timer,
and tool/chat errors fail immediately. The no-progress bound stays30seconds,
except for the declared runPlan stage, whose existing operation bound is60seconds.
The explicit aggregate E2E ceiling is300seconds, aligned with one task grant's
five-minute duration, not a claim that the two-task scenario has one grant.
This deliberately replaces the old aggregate30second assumption; it does not
change production timeouts or extend a production authority. Other scenarios and
all original result, idle, DOM, permission and scope assertions remain unchanged.

Deterministic clock-value tests cover normal progress, stalled/repeated events,
old results, wrong thread/scope, errors, unexpected tools, runPlan completion and
the overall ceiling. Real Electron acceptance remains required on the new head.
