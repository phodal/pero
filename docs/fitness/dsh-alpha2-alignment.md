# DeepSeek Harness 0.2.3-alpha.2 alignment

This is an incremental Go port of selected upstream behavior, not a backend
replacement. Preserve Pero's permission boundaries, readable sessions and
Host/Project contracts; land behavioral changes with a regression case. Upstream source is `deepseek-ai/deepseek-harness` at
`4b399c39a6d1479cd84ca591b4d7c88e24d38a96`. Verify the release tag and
published package separately. The historical Skill hook/AST lane remains
pinned to its own source until deliberately migrated.

| Stage | Acceptance |
| --- | --- |
| ACP lifecycle baseline | Use both actual executables on disposable state; check initialization, new, close, list and resume without a model call. Record advertised capability and differences, rather than assuming all methods are shared. |
| Deterministic effect and cancellation | Drive each executable with a loopback model fixture; observe one authorized effect, close/reopen, no implicit replay, and cancellation before any additional effect. Compare protocol-visible outcomes, not complete event streams. |
| Long sessions and provider behavior | Compare selected-route versus last-answered-route compaction and interrupted streams; test pinned source/retained content. Compare model-quality outcomes separately from wire-format parity. |
| Product verification | Exercise the evaluated engine through Pero Host in an explicit configuration. Verify exact paper/source identity, permission and cancellation boundaries, and no new default engine or shared cloud state. |

First-pass checks should not use personal profiles or live provider credentials.
Unimplemented or unrun lanes are not parity claims.

## Reproduce the first baseline

Use Node 24.22.3 or newer and the repository's Go toolchain. Run from the
Pero checkout root on a development machine:

```sh
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
npm install --prefix "$scratch" --ignore-scripts --no-audit --no-fund @deepseek-ai/dsh@0.2.3-alpha.2
go -C harness/go build -o "$scratch/pero-agent-acp" ./cmd/pero-agent-acp
node scripts/harness/compare-acp-alpha2.mjs \
  "$scratch/node_modules/@deepseek-ai/dsh/package.json" "$scratch/pero-agent-acp"
```

The runner does not install packages. It checks the DSH manifest version,
starts each real process twice, uses separate disposable homes/workspaces,
sets a fake credential and loopback provider, and disables DSH telemetry.
Its provider request counter must remain zero. Read-only source comparison
confirmed `dsh-v0.2.3-alpha.2` resolves to the pinned commit above.

## First observed results

Linux x64; Node 24.22.3; Go 1.27.3; Pero base `32132b5a`. Both real
executables negotiated ACP v1. Both created and closed a session, listed it
after a clean process restart, excluded it from a different workspace's
list, rejected resume from that workspace, and resumed the original ID.
The empty session emitted no conversation message or tool call on resume.
Both processes exited cleanly on stdin EOF. The loopback provider received
zero requests. Go also advertised and accepted `session/load` on that
empty history; DSH did not advertise it. Do not remove Go load support to
equate these surfaces.

No prompts or tools ran. This does not cover nonempty history, in-flight
cancellation, remote effects, model quality, OS isolation, Host integration
or a released Pero package. Next, script one authorized write and one
interrupted turn against loopback Chat Completions and Messages fixtures.
Only then evaluate changes to model routing or durable recovery.

## Second observed results: one write, cancellation and restart

Repeat the command above with `PERO_ACP_EFFECTS=1` before `node`. This
opt-in mode runs both binaries against local SSE endpoints, Messages for DSH
and Chat Completions for Pero. Each binary makes exactly four provider requests:
tool selection, tool result, a turn cancelled while the HTTP response is
open, and a new explicit turn after restart. The fixture checks that the
provider connection closes after cancellation and that the next explicit
turn sees the earlier tool result. It counts one live ACP tool invocation,
checks the bytes, and then replaces the file with a sentinel so that replay
of the original write would be visible even if that write was idempotent.

Pero was explicitly switched to `workspace-write` and answered with one
allow-once response. Stock DSH wrote inside its disposable workspace without
an ACP approval request. These modes are not permission-policy equivalents;
neither production default changed. Resume emits no historical message or
tool-call update and makes no provider request; Pero's separate
`session/load` replays nonempty history without rerunning the tool.

Both modes now create through a directory alias and verify the physical
directory is persisted and returned after restart. The alias regression
failed with old Pero `b8e2697` and passed after `da08985`. A fresh Pero
session canonicalizes an existing path before the configured admission
check and MCP setup; old sessions are not migrated. The dual-executable
checks, syntax check and Go `acp`, `cmd/pero-agent-acp`, and `nativetools`
tests passed on Linux. This is a clean stop and restart, not a power-loss,
queued-inbox, live-model, macOS or Windows verification.

## Release acceptance matrix

Use the published alpha.2 package and a separately built Pero binary. The
reproduction above runs the empty lane; replace its final command with
`bash scripts/harness/check-dsh-alpha2.sh "$scratch/node_modules/@deepseek-ai/dsh/package.json" "$scratch/pero-agent-acp"`
to run every loopback lane. The Linux scheduled/full CI lane uses this same
runner. It fails for a wrong package version, extra inference, repeated file
effects, or any required scenario that does not pass. It intentionally does not
use a real provider key, user profile, or private research data.

| Surface | Covered by this branch or existing behavior | Still open / deliberate difference |
| --- | --- | --- |
| Native ACP lifecycle | New/list/close/resume, canonical workspace, cancellation without replay; Pero `session/load` also restores the saved model and effort through the Host runtime. The ordinary Desktop composer explicitly reconnects through the original Host thread. | App/Project/Automation retain their own lifecycles; signed-package and Native UI acceptance are separate. DSH does not advertise Pero's ACP load capability. |
| Messages and Files | Text/tool SSE, signed replay at the same credential and route, explicit image upload/reuse, fallback and stale-ID handling; Rust Host restart and Paper source-provenance contracts. | Live DeepSeek round trip, broader DSH Files file lifecycle/quota/budget behavior, and real Desktop Paper link navigation remain open. Pero deliberately avoids widening uploads or retrying ambiguous stale IDs. |
| Compaction, Skills and policy | Latest-request pressure, explicit summary override, frozen source identity; existing Skill catalog/permission tests and separately pinned AST comparison. | Pero intentionally does not choose a last-answered model implicitly or adopt DSH's dynamic filesystem Skill roots. Source/AST extraction is not whole-runtime execution. |
| Goal | Explicit ACP start/status/edit/resume/complete, durable admission, cancellation, scoped descendant waits, and model stop with configurable blocker threshold. One-shot `/goal delegate` enables the model to create, edit, pause, complete or block the exact Goal; it can resume only an active checkpoint. | Pero requires explicit delegation instead of inferring permission from ordinary chat. Upstream's separate model wrap-up is not ported. Shipped Electron/Native controls and live-model acceptance remain open. |
| Team / subagents | Root mode and exact-ID board reads, optimistic claims/reassignment, dependencies and advisory scopes. Model guidance follows the effective Board tools. | Named member routing and the DSH subagent control tool family are not equivalent, and there is no shipped Desktop Team panel. Existing delegation and board state do not imply those features. |
| DSH product/runtime distribution | Go has its own composition; Pero already owns permissions, Host/Project research workflows and Task/Run. | DSH Web/live settings, compatible Cordis plugin loading/hot reload, SDK distribution and PTC execution are not supplied by this PR. Do not claim parity for them based on the ACP wire suite. |

Treat “implemented,” “verified locally,” and “verified on a shipped surface”
separately. Keep actual package/environment/Run receipts for each acceptance
lane. Do not mark the whole release aligned while any intended row remains open.

## Ordinary Desktop history reconnect

Open an acknowledged ordinary chat in Sessions and choose **Reconnect**. This
does not create another conversation, resubmit the last prompt, or clear the
current draft. Host reads the persisted thread origin, workspace and exact ACP
session ID, independent of the currently selected workspace or Agent. The
loaded model remains authoritative. A missing/moved workspace, unsupported
Harness, lost ACP identity or removed model fails without creating a new
session. Project, scoped App, Automation and sessions with frozen marketplace
Skill selections are not reconstructed through the ordinary-chat route.

The built-in Go Harness advertises revision 1 of `pero.quietLoad`. The opted-in
Host uses it only on `session/load`, and will not downgrade to a load that
could activate queued work. Existing ACP load/resume behavior without the
option is unchanged. Durable inbox inputs stay parked on quiet load and are
not discarded; the next explicit normal prompt can drain that existing work.
Host already has the timeline, so ACP history notifications are not appended
as new messages. This is not a promise to roll back prior tool effects.

With the Host and Go harness built, run
`node tests/contracts/desktop-chat-reconnect.mjs`. It uses two real Host
processes and a real Go ACP child with a loopback provider, changes the Host
working directory, checks exact thread/ACP identity, model B despite a registry
default of A, zero model requests on reconnect, and one copy of each message.
Removing model B is a negative control. After building Desktop/Wasm, run
the same fixture with `--electron` to click the history row and Reconnect, retain
a typed draft, and submit the next turn through the composer. The Linux
conversation CI job runs both; Native window interaction and released
installation are separate acceptance lanes.

## Goal restart boundary

The [pinned upstream Goal driver](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/goal/goal-round-driver/README.md)
counts a round only when its message enters session history. It does not
automatically arm a restored or forked goal.

Pero's ACP restart regression exercises the existing native follow-up seam,
not a Goal driver. The fixture saves both an unadmitted guarded continuation
and an ordinary durable inbox item. Resume drops the guarded input and runs the
ordinary item once. A fresh explicit native admission then writes its round fact
alongside the matching user message. A second restore retains that fact and
does not send either input again. The test uses a scripted provider, with no
network or tools.

The native Go ACP harness now has an opt-in bounded Goal slice. Start
`pero-agent-acp` with `--enable-goal`, then send one text block via
`session/prompt`:

- `/goal start 2 Verify the recorded result` starts a new revision and runs up
  to two rounds in the same conversation.
- `/goal status` reads the current objective, consumed rounds, stop status and
  exact `id@revision`.
- `/goal edit <id@revision> <rounds or -> [objective]` updates the cap and/or
  objective in place. Use `-` to retain the cap. Edits require an idle prompt
  slot, preserve consumed rounds and completion, and never schedule work.
  Increasing an exhausted cap makes remaining rounds available to an explicit
  `/goal resume`. A stale reference is rejected; a pre-revision journal is
  read as revision 1.
- `/goal resume` explicitly runs the remaining rounds. Session resume/load
  alone does not start a goal; ordinary durable inbox recovery still works.
- `/goal complete` records an operator's completion decision while idle.
  `session/cancel` stops active execution without refunding a round that already
  entered history.

The cap is 1–10 rounds per goal revision, not a request/token quota. Provider
budgets, tool policy, permissions and configured scientific review still apply.
Refusal, truncation, execution failure and cancellation stop continuation. A
round's journaled admission is flushed before model dispatch. A fork cannot
count an admission fact severed from its matching message, and does not carry execution authority.

After enabling Goal, the native tool catalog exposes `pero_goal_stop` only
inside the exact active Goal turn. A model can record `completed`, `blocked`,
or `paused` after reporting what it found. A successful tool result and normal
turn settlement are required; plain text, a failed tool, an ordinary chat,
or a child Agent cannot stop the Goal. The journal distinguishes a model
assessment from operator completion; it is not independent scientific
review. Only the operator can resume a blocked/paused goal, within the
original cap. Completed goals cannot resume.

A model can complete or pause on round one. `blocked` requires a nonblank
`blocked_reason` and at least three admitted rounds by default, matching the
pinned DSH version. With `--enable-goal`, supply
`--goal-block-after-rounds N` to set a different positive floor. The prompt,
tool description, and stop validation use the same value; the round cap is
independent. This is a trusted process-launch setting, not a per-goal journal
field. The model remains responsible for judging whether the blocker persisted. Below that threshold, an operator decision can
be requested via `paused`. Pero saves the accepted reason and displays it in
the closing status and after restart, without another inference. DSH instead
asks the model for a closing explanation.

Unlike DSH's editable live service, Pero only accepts edits as explicit ACP
commands outside an active prompt. An old revision's delayed admission or
stop does not apply to an edited goal. The model cannot make edits. When subagents are enabled,
Goal joins its own progressing descendants before reserving the next round.
Idle descendants with parked input and other sessions do not block it.
Cancelling while waiting disarms the Goal without consuming another round.
The ACP regression gates a real in-process child after round one, keeps an
unrelated session's child active, and checks that only settlement (or explicit
resume after cancellation) leads to one admission and one model request for
round two. A gated inbox callback additionally verifies that published waking
work is not treated as parked while the child still reports idle during
admission. The default slash-command path is unchanged.
Goal stays disabled for external harnesses and profiles with specialized
prompt preparation. The ACP server advertises `/goal` in the same complete session command
snapshot as `/review` on eligible native sessions. Official DSH alpha.2 has
interactive discovery through its Web profile, not ACP; this is a Pero
extension. Desktop UI, production model service and packaging remain
unverified.

### Model-facing Goal checkpoint read

With opt-in Goal enabled, the current native root model turn can call
`get_goal` without providing a session ID. Like the pinned
[DSH Goal tool](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/goal/tool-goal/src/index.ts),
it returns a null goal or the exact id, revision, objective, phase, and round
counters. Activation is live, not durable authorization: an owned automatic
round reports armed, while an ordinary prompt after restoring the journal
reports disarmed. Reading never reserves a round, resumes a goal, or changes the
revision. Another root, a child, or a disabled runtime cannot use it to read
this Goal. This does not implement model-mediated create, edit, resume, or
the DSH wrap-up turn.

## Team task board: opt-in native slice

The [pinned DSH Team contract](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/team/agent-team/README.md)
puts shared task ownership in the live root session, not in individual member
sessions. Pero now has a separate native board; the existing Claude
`TaskCreate`, `TaskUpdate`, `TaskGet`, and `TaskList` remain session-local.

Launch native `pero-agent-acp` with `--enable-subagents --enable-team`.
New and loaded eligible roots expose the `team` ACP select (off/on). Change
it while idle with `session/set_config_option`; it neither changes the
current model nor submits a prompt. The existing `commands/execute`
path (`agentId` and `line: "/team on"`, `off`, or `status`) shares the
saved mode. Off hides the tools without discarding the board. Launch flags
never enable a session automatically. The two-root ACP wire regression
isolates the setting and model, then reloads and re-enables the board
without inference or changes to task identity or revision.

A Host can discover `agentCapabilities._meta["pero.teamBoard"] = 1` and
read `_pero/team/board` with only `{sessionId}` for an active, eligible root.
The response combines mode and task summaries from a single journal read.
Off returns an empty list; re-enabling reveals the same saved IDs, revisions and
owners. Summaries exclude descriptions and deleted tasks. This ACP read does not
mutate the journal, dispatch a prompt, or let children inspect a root via their
own session ID. Model-side Team tools for owned members are unchanged. The
desktop task panel and reconnect flow are not part of this transport slice.

For Host callers that already reopen a saved ACP session, `session/load`
keeps the session's model and reasoning effort instead of reapplying the
registry's new-session model. Host history remains the displayed timeline:
historical messages and tool records from ACP load are not appended again.
The lifecycle fixture distinguishes a configured default (A) from the loaded
model (B), then verifies that the first explicit follow-up still uses B.
The Team panel remains separate from the ordinary Desktop reconnect below.



One stable system prompt section explains claiming, revision checks,
disjoint scopes, and coordination without granting workspace access or promising
a message/wake. It is rendered only when all four Team tools are admitted for the
current model request. Mode off, unrelated roots, or masked tools do not advertise
it. The prepared tool policy remains separate from prompt text.

- The live root and its owned children see `team_task_create`, `team_task_list`,
  `team_task_get` and `team_task_update` only while opted in. Unrelated roots
  and ordinary forks never gain access to the source board. A fork can still
  contain historical tool messages as normal conversation history.
- New tasks are unowned and may depend on existing tasks. Claim requires a
  pending task with completed prerequisites and the current task revision.
  The saved owner is the exact caller's session ID, never supplied by the
  model. The owner or Lead can release or complete an in-progress task. The Lead
  can also assign a ready pending or in-progress task to itself (`lead`) or a
  reachable continuable child by exact session ID, or omit the target to
  unassign. One-shot and archived children are not eligible. Selected Claude
  continuations can be resolved from their saved descriptors without waking
  them, even after restart.
- Two owned children racing the same revision yield exactly one committed
  owner. Mode, owner and revision survive reloading the root's JSONL journal.
  Updating tasks does not submit prompts, wake teammates, or grant file or
  shell access. This is an in-process board, not distributed Task/Run.
- The owner or Lead can edit a task's subject and description, replace its
  prerequisites using `set_dependencies` (an empty `blocked_by` clears them),
  reopen a completed task without carrying forward the owner, or delete a
  task no other non-deleted task references. A rejected cyclic, missing, or
  stale update leaves the previous revision untouched. List and get derive
  readiness from current prerequisites, so reopening one task reblocks a
  pending dependent without changing that dependent's revision. Deletion
  retains a readable tombstone but removes it from list, count, and new
  dependency selection. IDs are never reused; Pero's 256-task lifetime
  bound includes deleted records, unlike DSH's active-task ceiling.

- Create and edit accept advisory `write_scopes`; edit with `[]` clears
  them. Pero stores up to 32 normalized relative prefixes (each up to 256
  bytes), rejecting absolute paths, drive letters, empty and dot components.
  Get, list, and successful create/update results warn a pending or
  in-progress task about overlapping scopes of another in-progress task.
  Mutation results project readiness and warnings at the same journal
  snapshot that accepted the change; no extra read is required. Matching uses
  slash boundaries: `src/foo` covers `src/foo/a.go`, not `src/foobar`.
  Completing the other task removes the
  warning without changing this task's revision. Scopes neither lock files
  nor block claims, grant tools, or modify file permissions.

List filters by status, exact owner session ID or `lead`, unowned, and
readiness before applying a zero-based cursor. Owner and unowned cannot be
combined. The default is 50 summaries, with an explicit limit of 1–100;
get returns the full description. Readiness and write-scope warnings are
still calculated against the whole board. DSH agent-name aliases beyond
`lead` and a Desktop task panel remain open. The ACP setting is ready for
clients that surface generic settings; the shipped Desktop launch and GUI
are not verified here. The Team regression transfers
A's claim to a continuable B, rejects A's late completion, and reassigns to B again
while cold without making a model request. The graph regression exercises
the actual model tool dispatch and a JSONL restart: a two-task cycle and a
referenced delete are rejected, reopening reblocks the dependent, and
clearing that edge allows deletion. The deleted row and edited successor
are read back after restart. No change to checkout or artifact boundaries
is implied.

## Compaction route and evidence

The Go regression writes a JSONL session, removes the active agent, loads
the journal through a fresh persistence instance, and resumes it before
compaction. Model A answered; model B has the latest durable request header
and a 512-token output reservation but no answer. Resume itself makes no
provider request. Pressure selects B and
does not reuse A's 128k context capacity. The pinned DSH source also uses
the latest request route to calculate pressure, but its summary target
and summary-policy overrides follow the last model that answered. The Go
summary uses B by default; an explicit summary override selects A. An
exact B model policy can override the global summary route. The summary
budget still comes from B's policy, even when the operator explicitly
chooses A to write the summary.

Do not infer an opt-in destination from the last assistant message.
The durable provider/model strings identify the recorded route, not
the current adapter endpoint, credential, or permission to send old
research input there. A stable same-provider name alone is not enough
to establish a safe fallback after a restart or configuration change.
A separate loopback HTTP contract verifies default cross-provider routing
delivers the excerpt to B only, while an explicit override can send it to A.
This is a deliberate compatibility difference, not runtime parity.

A request hook in the same fixture moves an explicit A summary to B,
without changing the provider. Before the fix the adapter received B,
but both the response and summary recorded A. Go now records the model
and provider from the request passed to the adapter. This matches the
observable upstream receipt contract without changing how providers are
selected by default. The fixture checks the recent synthetic PDF
reference survives compaction with the original event sequence, attachment
ID, file name and byte count. No file was resolved, sent or uploaded.

Run `go -C harness/go test -race ./harness -run TestCompactionRouteAndRetainedSource -count=5`.
This verifies the local Go adapter and durable receipts; the DSH behavior
was checked against the pinned implementation and upstream tests, not
against a live provider or a second run of the upstream suite.

## Opt-in Go Messages HTTP round trip

With the two executables from the baseline above, rerun the same script with
`PERO_ACP_MESSAGES=1`. DSH keeps its normal Messages route. Pero uses its
Go adapter via `--api-format deepseek-messages --max-tokens 128`. The
loopback fixture checks Pero's path and auth/version headers, the explicit
disabled-thinking field on every request, and the exact tool call and
matching user-role result in the next request. A separate trial returns a
complete-looking tool call but omits `message_stop`: no permission prompt,
file creation or automatic retry may occur. The lane also exercises
cancellation at the provider connection, nonempty history after restart,
and load without another tool execution. Nine HTTP requests in total are
expected (four DSH, five Pero).

The new route reuses the Go request audit and budgets, connected provider
selection, cancellation, idle/deadline handling, and no-redirect transport.
Tool execution is still gated by ACP and the existing workspace permission
policy. Images, signed thinking, native Files, hosted provider tools, moving
system instructions during a conversation, real models and Desktop Host
acceptance are outside this lane.

## Opt-in signed thinking over HTTP/ACP

Rerun the two-executable fixture with `PERO_ACP_SIGNED=1`. DSH still
tests the text/tool baseline; the Go executable opts into signed thinking
with a separate synthetic local key. The Messages peer checks the signature
and tool-call ID during the tool result round trip and again after an ACP
restart from the same private session directory. A third Go process uses
a different synthetic provider credential at the same endpoint: no thinking
text or signature may be transmitted, the previous tool ID is still present,
and the already executed write must not run again. Neither replay key nor
signature enters ACP surface events. Expect ten loopback requests total.

This is synthetic protocol and session-restart evidence. Real DeepSeek
acceptance, Files and Desktop Host wiring are separate; signed mode remains
opt-in and existing launch defaults are unchanged.

## Upstream-only Files replay and fallback baseline

Run without a Pero binary:

```sh
PERO_ACP_DSH_FILES=1 node scripts/harness/compare-acp-alpha2.mjs \
  "$scratch/node_modules/@deepseek-ai/dsh/package.json"
```

This lane starts the actual alpha.2 ACP executable three times. It uses a
disposable profile patch to select the upstream catalog's image-capable
`deepseek-flash` route and serialize uploads for the test. The stock ACP
profile did not advertise image prompts against the loopback catalog.
Only two synthetic PNG swatches and fake credentials are used.

1. The first process uploads both images and sends both returned file IDs.
2. Resume with the same credentials makes no request on its own. The next
   prompt sends the same two IDs from durable history without uploading.
3. Resume with changed credentials again makes no request on its own. The
   next prompt attempts both uploads under the new credential. The fixture
   accepts one and rejects the other. The resulting Messages request uses
   inline base64 for **both** images, with exact byte equality and no file IDs.

Expect four upload requests and three Messages requests. This measures
upstream behavior only. It does not show that Pero supports Files or that
the live service behaves like the fixture. The
[upstream attachment contract](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/attachment/attachment/README.md)
also distinguishes raster inputs from generic files such as PDFs, which
stay local and are read on demand. No PDF or user file is part of this test.

## Pero opt-in inline Images

The Go CLI can now generate a Messages request with bounded inline rasters
using the explicit `--api-format deepseek-messages --image-input` flags. ACP
uploads the input to the private local attachment store, not the provider's
Files endpoint. Resolved rasters can be sent to the explicitly configured
model in prompt blocks or nested in tool results. Raw paths and URLs are not
accepted. The HTTP image budget is 20 occurrences and 16 MiB of raster bytes
before base64. Existing model and protocol defaults remain unchanged.

Run the same ACP fixture with `PERO_ACP_PERO_IMAGES=1` and both binary paths
from the baseline. It confirms two distinct image blocks, the same wire
bytes after a real process restart, no requests from resume alone, and zero
Files uploads. Durable provider file IDs, provider fallback, live service
acceptance and Desktop Host integration remain separate.

## Pero opt-in Files transport

With Messages and `--image-input` configured, use
`--messages-files-key-env NAME` to explicitly enable remote upload of
admitted raster bytes. Set the named variable to 32 random bytes encoded as
64 hex characters, separate from the provider credential and signed
thinking key. The CLI removes the variable before assembling tool child
environments. The operator must treat this as remote data retention, not
just the existing inline inference request. Nothing uploads by default.

Pero keys its private disk cache by normalized Files endpoint, provider and
credential, using the independent local key; entries represent exact raster
bytes and MIME. A seven-day requested lifetime, bounded locally by creation
time, is refreshed with an hour left. Identical images in one request reuse
one ID. Missing, near-expiry or invalid records need a new upload. Failed
upload resolution leaves the whole model request inline, including any
images successfully uploaded earlier in that attempt. The already-reserved
inference budget stays available; uploads consume the same attempt budget
and audit gate. Files and Messages reject HTTP redirects.

Run the same fixture with `PERO_ACP_PERO_FILES=1` and both binary paths.
It exercises three real Pero processes with the same assertions as the
upstream baseline: four uploads, three model requests, reuse after
restart, credential separation and full inline fallback. The inline and
signed lanes still run independently. See below for bounded provider
stale-ID recovery. A provider upload timeout skips future cache-miss requests within that
endpoint/credential adapter, with a bounded 1/2/4/8-request cooldown. Cached
files remain usable, skips do not consume an upload attempt, and a successful
upload resets the cooldown. User cancellation does not start backoff and
the inference fallback remains fully inline. Quota reclamation, cross-process
concurrent upload deduplication and full upstream vision budget/offload
parity are not implemented. Live provider and Desktop Host acceptance are still unverified.

### Rejected remote file IDs

If the Files-mode Messages request receives HTTP 400, 404 or 410 before
streaming, and the structured error explicitly identifies one used ID as
expired, deleted, missing or invalid, Pero tombstones that ID in the
current endpoint/credential cache. It retries the same inference at most
once, entirely inline. Each dispatched payload has its own budget slot,
HTTP audit and durable wire-size receipt. Later Files requests may upload
fresh bytes for the rejected mapping; unrelated IDs and credentials are
unaffected. An unnamed or ambiguous rejection, other provider failure,
or a truncated SSE stream does not trigger this fallback.

The pinned
[DSH implementation](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/llm/llm-deepseek/src/request-files.ts)
may invalidate unnamed mappings and attempt replacement uploads during the
same inference; Pero deliberately uses the narrower inline retry. A
loopback Go adapter test checks exact body hashes, audit counts, restart
cache behavior and the no-retry cases. Live-provider acceptance remains open.

## Project Agent Host acceptance for Messages Files

Build `pero-host` and `pero-agent-acp` as in the CI job for the official
MCP conversation, then run `node tests/contracts/dsh-messages-files.mjs`.
The regression uses the actual Host stdio surface shared by the desktop
runtime, a disposable Project/profile, and a separate explicitly selected
Agent registry entry. Only the provider is scripted and local. The built-in
Pero (DeepSeek) route and its defaults are unchanged.

The first Project prompt negotiates ACP image support and sends two different
synthetic PNG swatches. The loopback provider records exactly two uploads and
one Messages inference with the two returned file IDs. After a clean Host and
Harness restart, opening the original Project Agent loads the same ACP
session and sends no provider requests. An explicit follow-up reuses both
IDs, with exactly one new inference and no new uploads. This lane passed five
consecutive times on Linux. The existing Project Agent Host contract (nine
behaviors, including delegation and cancellation) also passed.

This is a Host contract, not a Desktop renderer, Paper source/PDF provenance,
packaged Native/Electron, or live DeepSeek acceptance. No real provider
credentials or research files are used.

## Paper source-side provenance over Messages Files

The separate `vision-files` Paper campaign uses the actual Go Harness,
Rust Host, Desktop App Use broker, and Paper parser with synthetic source/PDF
transport. It verifies one safe PNG upload with the exact persisted preview
digest, not the metadata-bearing original, and the returned file ID inside
the corresponding typed tool result. The Paper records retain the original
archive/member identity, preview digest, literal caption match to the
independently acquired PDF's first page, and validated PDF citation. The
reference-only first turn acquires no bytes. No files are sent to a real
provider. Dependencies and invocation are in the
[fixture guide](../../tests/runtime/paper-study/README.md#opt-in-messages-files-provenance).
Desktop click-through, packaged runtime and visual-model acceptance remain
separate. The built-in DeepSeek route is unchanged.


## Model-mediated Goal through ACP

Use `/goal delegate <instruction>` in an opt-in native durable root. The
ordinary chat model still has only `get_goal`. The explicit operator turn has
`create_goal` and `update_goal`, with a 1–10 round cap (default 3); the grant
belongs to the exact live user message and expires before synthetic output
recovery. In a Goal round the model can complete or block only the exact
revision, under the existing minimum-round blocker policy. A paused or
blocked Goal needs operator `/goal resume`. Edits do not refund used rounds
or start work. The original tool result and originating turn must settle
before a proposed mutation or continuation is committed.

Run `node tests/contracts/dsh-goal-delegation.mjs <pero-agent-acp>` for a
two-process loopback acceptance: unauthorized ordinary and recovery turns,
create, early-block rejection, pause, revision edit and stale-ref rejection,
quiet load, model resume rejection, explicit resume and model completion.
