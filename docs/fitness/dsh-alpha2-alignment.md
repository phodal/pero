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
2. Compare compaction pressure and summary routing with independent
   two-model fixtures, including summary-route override and retained source
   attachments. A compatibility mode must not silently send research inputs
   to a different provider when the operator changes route.
3. Compare the DeepSeek Messages stream, model/reasoning options and file
   behavior against the pinned release. Keep Chat Completions available for
   existing deployments. Treat new remote file uploads as an explicit policy
   decision, not an automatic consequence of compatibility.
4. Evaluate bounded Goal continuation and plugin/skill behavior against
   existing Go Workflow and Host controls. Close the alignment with a Host
   test that reopens the same research evidence after restart. Track any
   unported scope explicitly rather than changing defaults to imitate it.
