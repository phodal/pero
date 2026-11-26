# DeepSeek Harness 0.2.3-alpha.2 alignment

This is a staged comparison, not a backend replacement. Keep the built-in Go
agent, its permissions and session format unchanged until a behavioral change
has evidence. Upstream source is `deepseek-ai/deepseek-harness` at
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
