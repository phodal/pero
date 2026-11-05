---
kind: analysis
date: 2026-11-03
updated: 2026-11-05
title: Agent startup latency, Connector MCP failure and recovery gaps
---

# Agent startup performance (Preparing Agent)

## Current diagnosis: 2026-11-05

The Native Preview's 17–23 second preparation is reproducible in the builtin
Connector MCP mount. It is not the cost of the ACP handshake or model inference.
The earlier hypothesis that history replay dominated this particular delay is
superseded by the isolated measurements below. Implementation and verification
are recorded separately below.

Inspected checkout: `6b75aa6d962cf7a6865d376a3f60010593de6247`, with an existing
unrelated `Cargo.lock` modification. Probes used the actual debug binaries and
the bundled `packages/connectors/helpers/pero-connectors-host.mjs`. The Agent
binary was built on November 3; its build metadata reports revision
`6715e7f290062698a54ec90d7a00a0e0a0dcdd81` with `vcs.modified=true`. These
measurements establish current binary behavior, not an exact clean build of the
inspected checkout.

All new probes used disposable state, loopback HTTP and a synthetic credential.
They sent no model prompt, called no external connector tool and changed no
existing user session or credential.

### Observed costs

| Probe | Initialization / session creation | Total to ready |
| --- | --- | --- |
| Builtin Harness, no MCP | 8.0 ms / 18.7 ms | 29.4 ms |
| Harness + loopback MCP exposing 27 actual App manifest tools | 7.1 ms / 20.1 ms | 29.1 ms |
| Harness + actual Connector MCP only | 6.3 ms / 22,261.4 ms | 22,270.0 ms |
| Harness + actual App Use only, disposable manifest catalog response | 7.4 ms / 24.5 ms | 33.4 ms |
| Harness + actual Connector MCP and App Use | 6.6 ms / 20,035.4 ms | 20,043.8 ms |
| Connector MCP through a diagnostic proxy answering SSE GET with 405 | — | 45.1 ms |

The App Use probe supplied enabled App manifests at the Native `apps/list`
effect; it did not exercise real App backends or package installation. The final
probe changed only the disposable proxy response, not the application source.

The existing Native journal corroborates this: sessions created at
07:26:53.091712 UTC and 07:27:28.856875 UTC took 23.197435 and 17.060981 seconds
respectively from their Harness header to `session/acp-controller`. Both
receipts require client MCP. That interval includes Agent activation/MCP mount;
it does not measure renderer presentation latency.

### Why an asynchronous connector blocks preparation

The critical path is:

`prepare_chat` → Host `create_session` → spawn ACP process → `initialize` →
`session/new` → `Agents.Create.Configure` → `MountMCPServers` → initial
`supervisor.connect` → tool discovery → `session_ready`.

`harness/go/harness/mcp.go` mounts servers sequentially. In
`harness/go/mcp/connection.go`, the initial `supervisor.connect(ctx)` runs
**before** the background supervisor is started with `run.Go`. The Node
process/request handlers are asynchronous; the initial connection remains a
dependency of `session/new`. Reconnection after mounting is separate.

The captured Connector HTTP sequence was:

1. `server/discover` with version `2026-07-28` → HTTP 400, unsupported version.
2. Fallback `initialize` → HTTP 200, negotiating `2025-11-25`.
3. Client opens the optional SSE `GET /mcp` → HTTP 403.
4. Roughly 19.8 seconds later, the MCP observation reports `error`, no tools;
   nevertheless `session/new` succeeds.

`packages/connectors/src/mcp.ts` combines the non-POST check with authentication
checks and returns 403 for all of them. `headerRoundTripper` in
`harness/go/harness/mcp.go` turns 401/403 into a sticky authentication error.
The Go MCP SDK's `connectSSE` retries transport errors with jittered exponential
backoff (default five retries), including that local sentinel. Later retries
are rejected locally, explaining why the trace contains only one network GET.
The outer Harness supervisor eventually classifies authentication as terminal
and does not reconnect it.

The diagnostic proxy's 405 response completed the same setup in 45.1 ms and
produced `connected` with `connectors_list` and `connectors_call`. The preceding
400 version fallback still occurred, so that fallback is not the long delay.
The scoped fix belongs in Connector HTTP method handling: after authenticating
the request, an unsupported SSE GET must report method unavailability. Do not
disable SSE for every MCP server; other servers use it for tool-list changes.

### P1: MCP failure can look like a healthy Agent

ACP's `decodeMCPServers` leaves `FailOnStartupError` false. `MountConnection`
therefore accepts an initial connection failure and publishes an Agent without
that server's tools. This may be appropriate for an optional server, but
readiness does not communicate that the tools failed.

The Host builds `McpRuntimeSession.servers` only from `managed_mcp.servers` in
`crates/pero-runtime/src/acp/session.rs`. Builtin Connectors, App Use, operator
servers and plugin dependencies are not included unless they are also in that
managed list. `acp/mcp_runtime.rs` drops observations whose server is absent
from the list. A real Host probe with a healthy builtin Connector MCP returned
`session_ready` and an observable runtime snapshot with `servers: []`. The
failing Connector probe likewise reached Agent readiness without its two tools.

Distinguish Agent readiness from optional tool readiness, expose actual mounted
server identities, and define which App dependencies must succeed. The current
plugin `required` check only checks HTTP capability, not mount success. Moving
all mounts to the background without this contract would hide missing tools.

### P1: Event-tail restoration drops conversation identity

`crates/pero-host/src/agents.rs` reads the full journal, then retains only its
last 5000 event lines. It persists every streaming `session_update`. The current
Native journal contains 15,572,923 bytes / 33,776 events; 33,313 are updates.
The last 5000 lines contain 4961 updates.

After deletion filtering, 4979 events remain. One non-deleted conversation has
2718 retained events but no retained `session_created` or user message. Its
earlier user message remains in the full file. `receive_chat` in
`crates/pero-chat-ui/src/chat.rs` creates a restored conversation only on
`session_created` and ignores later events for unknown identities. Thus the
current restore input cannot reconstruct that conversation. This is a replay
correctness issue; the on-disk history has not been deleted.

An isolated Host using a copy of the real journal measured 34.3 ms to Host ready
and 69.9 ms from `list_agents` to the 1,117,112-byte replay response. Empty
history measured 6.1 ms and 26.9 ms respectively. Renderer application was not
timed. Restore complete conversation identities/final content rather than
cutting raw streaming events at an arbitrary line boundary. During a live Host
process the in-memory history also grows without the startup cap.

### P2: Native development can run a stale Harness

`scripts/dev/native.mjs` builds Connectors, the Connectors App and Rust Host /
Worker, then builds the native UI. It never calls `scripts/build/harness.mjs`.
Its watcher observes only `crates/pero-ui`, and the hot rebuild only builds the
native UI. Harness and Host changes are not included in that hot rebuild.

The running Host was built on November 5 while the Agent binary was built on
November 3. An existing binary hides the missing build dependency; a fresh
checkout without one leaves the default Agent unavailable. Ensure the Native
entry builds its declared runtime dependencies and watches the sources intended
for live iteration. A source edit alone does not establish that Native uses it.

### P2: Preparation exposes no stage or dependency result

`chat.preparing` represents the entire `SessionState::Connecting` interval.
Host events expose no per-stage duration, and builtin MCP observations are
currently omitted as described above. Each ACP setup operation has its own
45-second timeout; this is not one 45-second overall startup deadline. The
Native App request wait can be 660 seconds, although the Agent's session setup
wait can time out sooner.

Empty draft selection or workspace/Agent retargeting cold-starts another
process. That amplifies a slow dependency on every replacement, but the measured
healthy process/ACP cost is tens of milliseconds. Pooling processes or removing
ACP is not justified as the first remedy for this incident.

### Recommended order

1. Correct authenticated unsupported-method responses and verify actual
   Connector tools are connected, not merely that `session_ready` arrived.
2. Expose actual MCP failures and define required versus optional dependencies;
   keep optional startup work off readiness only with that behavior explicit.
3. Restore complete conversation identities/content instead of arbitrary event
   tails; preserve the existing journal during migration.
4. Add the missing Native runtime build dependency and useful stage timing.

These probes do not establish packaged-product, external-service or real-model
acceptance. The following November 3 analysis is historical background; its
prioritization and speculative latency attribution are superseded above.

## Implementation: authenticated HTTP methods

On November 5, Connector MCP now authenticates the conversation before returning
405 with `Allow: POST` for unsupported methods. Invalid credentials, unknown or
retired conversations and browser origins still return 403. The transport test
also connects the real TypeScript MCP client and discovers both Connector tools.

An additional loopback probe connected the existing Go Agent binary directly to
the changed endpoint: ready in 34 ms, MCP status `connected`, both
`connectors_list` and `connectors_call` present. No model prompt was sent.
`node --test packages/connectors/test/mcp.test.mjs` and `npx tsc --noEmit` passed.

## Implementation: actual MCP observations

The Host snapshot now includes operator, managed, plugin and builtin Connector
servers; App Use joins it when actually included in `session/new`. The retained
ready receipt carries that snapshot, so its startup observations survive history
replay. Optional server failure is distinct from Agent readiness. Domain tests
cover visible failures, disconnected states and unobservable/closed sessions.

The actual Electron/Host/Go probe observed both builtin servers connected and a
controlled optional endpoint failed. Core Rust suites and repository checks
passed. The Chat presentation and recovery are verified separately below.

## Implementation: visible optional-tool failure and recovery

Chat now shows failed MCP names and a recovery instruction. An empty conversation
can retry using the existing replacement path, retaining its draft. Workbench
forwards runtime observations to both Settings and Chat instead of consuming
them in Settings. Submitted conversations keep their existing binding.

`node tests/e2e/agent-startup.mjs` passed with the actual builtin Connector and
App Use endpoints, a controlled failed optional MCP and pointer-driven retry
after its configuration was repaired. Light/dark, Chinese, the supported minimum
1000px window, keyboard focus and warning wrapping were captured and inspected.
Screenshots and the sanitized receipt are in `test-results/agent-startup/`.
No prompt or external connector call was made. The test copies its Host binary
to its disposable profile so another local build cannot replace it mid-run.

## Implementation: required App dependencies

App dependency MCPs and the App Use endpoint needed by an App declaration now
carry a Host-owned required set. The runtime's domain readiness check rejects
session readiness when the negotiated observations do not confirm those
connections. It reports the missing names and closes the unsuccessful session;
optional failures continue to show the warning described above.

Domain tables and the ACP lifecycle table cover required connection failure,
successful discovery and an external Agent without the observation extension.
Contracts, runtime, Host and Worker suites passed. External Agents without this
extension retain standard ACP readiness and their explicit unobservable status;
these checks do not claim independent verification of those Agents' mounts.

## What the UI is waiting on

### Implementation: complete compact history

`SessionHistory` now owns replay and deletion. Host reads the journal in order
without the arbitrary 5000-event cut and uses the same fold for live events.
Only adjacent plain message/thought text chunks with identical thread and event
headers are combined; role, turn, tool, metadata and annotated-content boundaries
remain intact. Deleted threads and late events stay excluded. The append-only
source journal is not rewritten or rotated.

Contracts, Host/runtime suites and Host protocol conformance passed. The real
Electron test `tests/e2e/session-history.mjs` restored a conversation with over
6000 chunks, its original title/user message, tool evidence, reasoning and final
answer. It checked deletion and verified the original journal hash did not
change. The resulting screenshot was inspected.

A probe using a disposable copy of the actual Native journal preserved every
message/thought text byte and all 83 non-deleted conversation identities:
33,803 source events became 3500 replay events / 8,842,102 bytes. Host readiness
took 329.7 ms and replay delivery 217.3 ms. This full-history response includes
older conversations omitted by the former 5000-event tail, so its size/time must
not be compared as equal scope to the former partial replay. Receipts are in
`test-results/session-history/`; no original user journal was changed.

`chat.preparing` is shown while `SessionState::Connecting`. Auto-preparation
(`prepare_chat`) runs as soon as the chat is visible, Host-connected, history
replayed, and workspace non-empty. It issues `new_session` before the first
prompt ([agent-preparation](../fitness/agent-preparation.md)).

Host path for that command:

1. Resolve agent (`pero` → `pero-agent-acp`), load managed MCP, bind connectors,
   freeze App plugin instructions when scoped.
2. Spawn a **new** ACP stdio process per conversation.
3. `initialize` → `session/new` (mount App Use / connectors MCP when configured)
   → optional model select → `session_ready`.

## Measured cost (local, 2026-11-03)

| Stage | Time |
| --- | --- |
| `pero-agent-acp` process spawn | ~1–2 ms |
| ACP `initialize` | ~5–6 ms |
| ACP `session/new` (empty `mcpServers`) | ~12–15 ms |
| End-to-end to ready (empty MCP) | **~20–25 ms** |
| HTTP MCP to refused port | still ~20 ms (`session/new` does not block on live tool listing failure for that case) |

Bare ACP handshake is not the multi-second delay. Setup timeout is 45s
(`SETUP_TIMEOUT` in `crates/pero-runtime/src/acp/session.rs`).

## Real bottlenecks before / around Preparing

1. **Eager preparation product rule**  
   Opening Chat (or switching Agent / empty-draft workspace) always cold-starts
   an Agent process. The empty state still looks “stuck preparing” even though
   no prompt exists. This is intentional Zed-style prep, not a protocol
   requirement.

2. **One ACP process per conversation**  
   Architecture keeps a runtime/process per live conversation; App Use/MCP is
   not multiplexed onto one Agent ([agent-preparation](../fitness/agent-preparation.md)
   Boundaries). Empty draft replacement closes and respawns.

3. **History replay gate**  
   `prepare_chat` waits for `replayed`. `ListAgents` sends the full visible
   journal (cap 5000 events). Local Desktop journal
   `~/Library/Application Support/@pero/desktop/sessions.jsonl` was **~2.8 MB /
   7230 lines**; the retained window was **5000 events ≈ 1.5 MB JSON**, of which
   **~4966 were `session_update` streaming chunks**. Serialize/parse alone is
   tens of ms. Renderer application was not timed; the original hypothesis
   that it dominated preparation is not established by those observations.

4. **App-scoped session extras**  
   Desktop always configures `PERO_APP_USE_*` / connectors when available.
   `create_session` uses `start_app` whenever App Use exists, so `session/new`
   carries Host MCP endpoints even for ordinary drafts. Paper Agent itself has
   no `agentPlugin` MCP package; App tools are Host writes via App Use after
   the Agent is up.

## Do we need ACP?

**Yes for the conversational Agent.** The built-in `pero` Agent *is*
`harness/go/cmd/pero-agent-acp`. Chat, cancel, approvals, model options and
tool turns all ride ACP. Removing ACP means a second Agent transport, not a
toggle.

**No for App UI alone.** Paper panel reads/writes do not require an ACP
session. ACP is only needed when a model Agent must call those tools through
Host-mounted MCP / App Use.

**Eager ACP before the first keystroke is optional.** Protocol does not require
pre-spawn; the current UX chose readiness-before-prompt. Lazy start on first
send (or a shared warm process) would remove most empty-state “Preparing”
time without dropping ACP.

## Earlier design hypotheses (superseded by November 5 measurements)

1. Journal retains raw stream deltas and replays them wholesale on every chat
   connect — wrong shape for startup.
2. Empty-draft auto-spawn conflates “panel open” with “Agent process ready”.
3. Per-thread process + App Use mount makes every new draft a cold path.
4. ACP itself is the right harness boundary; blaming ACP for ~20 ms of work
   misattributes the delay.

## Earlier suggested follow-ups (not implemented; reassess after the MCP fix)

- Compact or omit `session_update` from connect replay; restore titles /
  messages / tool finals only.
- Defer `new_session` until first prompt (keep draft editable; queue send as
  today) **or** keep one warm Agent process and create sessions in-process.
- Avoid remounting App Use/connectors on drafts that cannot use them yet.
- Cap / rotate `sessions.jsonl` in development profiles.

## Related commits

- `56fba4e2` — paper HTML review hide for local PDFs (unrelated leftover landed
  with this pass).
