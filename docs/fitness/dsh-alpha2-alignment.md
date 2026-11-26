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
