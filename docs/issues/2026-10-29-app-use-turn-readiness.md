---
kind: incident
status: in_progress
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

## Final Electron acceptance (2026-10-30)

Standard CI [40962596409](https://github.com/phodal/pero/actions/runs/40962596409)
passed all 16 jobs for head `26c371fad79ff6bb60ff32d7e3a383c9ba3e182f`,
testing merge `7beb3d9eeaf842eb2a899c1506ebf8bc37e2f15a`. All four Linux
Electron suites completed with `errors: []`, including both App Use consumers.
The full Product scenario completed in 4,792 ms and the full Workbench scenario
in 22,784 ms, with 25 completed tools each. The original draft identity, policy,
content, capture, scope and final-result assertions remained enabled.

These real samples are below the old 30-second aggregate limit. The extended
runPlan and coalesced-progress cases are covered by deterministic tests, not by
claiming that this CI run exercised a longer real-time sample. Screenshots and
results are retained in
[Desktop artifact 12936827324](https://github.com/phodal/pero/actions/runs/40962596409/artifacts/12936827324),
ZIP SHA-256 `0b6e3ec3c12e86d0f442da92dd2d3b6d8daf22f8bedd3081325e6d920c99ac80`.
This closes the pending Electron checkpoints above. macOS and Windows Desktop
E2E were skipped under existing workflow conditions; no native E2E acceptance
is inferred for those platforms.

## Workbench chat launch acknowledgement (2026-10-30)

Run40994868420 (head b7b9d80, merge f3f8fe75) failed the initial Workbench
`app-use:full` composer assertion. Artifact12951321477 SHA256
`d491836a3ba3be720d00cb0e6f20a609c6c52993039f37e77c649b588133f8b1`
shows the exact text already visible in the failure screenshot and retained
state, in the sole `virtual-cell/main` chat `chat-1793329796417-1`, idle with
fixture session `app-use-fixture` and no error. This is late delivery, not
observed intent loss. The artifact does not timestamp individual launch stages.

The test posted a fire-and-forget message then immediately started a five-second
composer poll. The shared launcher first opens/selects a scoped draft (its own
five-second readiness bound), awaits main-process context freezing and App status
RPC, and only then queues the insertion for the Chat render. Agent preparation
can interleave with this flow; it does not own the insertion or its destination.

Use the existing correlated `pero:app:chat-result` acknowledgement for both direct
Workbench chat launches before asserting the rendered effect. Match the parent
source, origin, request ID and response type; reject errors without resending.
Use the SDK's existing 125-second request deadline, not a longer composer poll.
This explicitly permits a longer acknowledged launch window in this test; it
does not claim the old total five-second wall-clock budget is unchanged.
Keep the original exact-text five-second assertion, scoped chat identity and all
App Use/default-deny checks. Real Electron acceptance remains pending.

Local validation: all 34 fixture tests passed (including seven launch cases:
acknowledgement after the former five-second window, wrong source/origin/id/type,
negative response and deadline cleanup), with no sleeps or resends. The actual
serialized browser callback is tested with explicit reply events and clock
values. JavaScript syntax and diff checks passed. The SDK launch is enclosed in
a React hook rather than an importable browser request helper; this fixture
implements only its wire contract, without changing production code. The
Workbench now also checks the acknowledged thread and exact App scope before
submission, and the original thread acknowledgement on return. This environment
has no built Web distribution/Xvfb; real Electron execution is still required.


## Product fresh-selection query after merge (2026-10-30)

Post-merge run40998415271 (merge `3cd756c08e0a9e010ab946d33f11055f0388b903`)
failed Product's first `app-use:deny` context handoff. Artifact12953055017,
ZIP SHA256 `8d7d820a18e9811f44fa373bc71feb0c863245ef4baf6ddba131d93d2474c576`,
contains an empty composer, one idle `virtual-cell/main` draft
`chat-1793331942357-1`, fixture session `app-use-fixture`, no messages and no
session error. Runtime logs show `AppChatContext.freeze` rejecting its initial
fresh-selection check with `APP_DRAFT_CHANGED`. Unlike the prior Workbench
late delivery, this context was actually rejected.

The guard does not read the main process's `authority.select` acknowledgement.
It executes `window.peroAppUseThread`, which asks the Chat iframe for its current
selection a second time. That message query resolves `undefined` after two
seconds without a reply, indistinguishable from an actually empty selection.
The retained incident has no timing for that query: timeout is a reproduced
failure mode, not a proven timestamped cause of this CI failure.

The Desktop adapter now reads a fresh snapshot directly from the current
window's exact `pero://chat/chat.html` direct child frame, like the existing
Workbench snapshot read. It rejects duplicate frames and checks the location
inside the executed read; missing, not-ready, navigated or destroyed Chat cannot
authorize a context. It does not use App frames, cached selection, selection
ACKs or an App-supplied thread as evidence. Both `AppChatContext` guards remain
unchanged, as do original-draft delivery and capture checks. No retry, replay,
context fallback or production timeout increase is introduced.

Product E2E now awaits the existing correlated App chat acknowledgement before
its unchanged composer assertion and checks the original destination and scope.
A rejected launch fails immediately rather than appearing as an empty-composer
poll failure. Deterministic tests hold the fresh read past the former two-second
window, test actual selection changes, frame ownership/lifecycle failures,
pre-capture switching and original-draft asynchronous delivery without replay.
The App Use unit suites are bundled for the existing Linux CI stage because
plain Node type stripping cannot load their existing parameter properties and
extensionless imports. All 10 bundled unit tests, 34 fixture tests, full
`npm run check`, JavaScript syntax and diff checks passed. Restoring only the
old selection implementation in a temporary test bundle makes the deterministic
delayed-read case fail with the original `APP_DRAFT_CHANGED`; the new path passes.
Real Electron acceptance for this change remains pending.
