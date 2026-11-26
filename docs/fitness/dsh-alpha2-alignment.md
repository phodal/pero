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

## Remaining implementation order

1. Pin restart behavior separately for a cancelled turn and an intentionally
   queued inbox item. Do not suppress legitimate queued work to make a
   cancellation test pass.
2. Keep the latest durable request as the default summary recipient. Use the
   explicit summary route when an operator wants another model. The persisted
   routing contract below deliberately does not implement DSH's implicit
   last-answered recipient.
3. Compare the DeepSeek Messages stream, model/reasoning options and file
   behavior against the pinned release. Keep Chat Completions available for
   existing deployments. Treat new remote file uploads as an explicit policy
   decision, not an automatic consequence of compatibility.
4. Evaluate bounded Goal continuation and plugin/skill behavior against
   existing Go Workflow and Host controls. Close the alignment with a Host
   test that reopens the same research evidence after restart. Track any
   unported scope explicitly rather than changing defaults to imitate it.

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

The remaining Goal work is to own objective/revision, round cap and stop state,
and wire an explicit Goal resume. Persist round accounting at admission, not
when reserving a queue slot. Keep restored and forked goals disarmed while
preserving ordinary ACP inbox recovery.

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
stale-ID recovery. Quota reclamation, adaptive backoff, cross-process
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
