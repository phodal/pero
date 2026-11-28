# DeepSeek Messages text and tools

This package translates the text and local-tool portion of the [DeepSeek
Messages API](https://api-docs.deepseek.com/guides/anthropic_api/) into Go
harness values. The SSE decoder follows [the DSH alpha.2 translator at
4b399c39](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/llm/llm-deepseek/src/translate.ts).
It preserves block order and reconstructs fragmented tool JSON. Success
requires `message_stop`, a terminal reason and closed blocks. Partial tool
data can be observed as a delta but never returned as a completed call
from a truncated, refused, or malformed response.

The CLI can select this protocol explicitly with
`--api-format deepseek-messages --max-tokens 128` and a configured endpoint,
model and credential. The official base is `https://api.deepseek.com/anthropic`;
the adapter appends `/v1/messages`. The adapter sends
`thinking: {"type":"disabled"}` unless explicitly configured otherwise. This
default Messages mode supports text and local-tool history only. Images,
Files, hosted tools, and in-conversation system updates are not supported.
Desktop Host defaults and the existing Chat Completions and Responses
routes are unchanged.

Run `go -C harness/go test -race ./providers/messages ./providers/openai`.
See [the ACP fixture](../../../../docs/fitness/dsh-alpha2-alignment.md)
for the two-executable loopback check. These tests do not contact a model.

### Opt-in signed thinking

Add `--messages-replay-key-env PERO_MESSAGES_REPLAY_KEY` to a Messages CLI
launch and inject a separate, private 32-byte random key as 64 hex characters.
Retain the key in the same credential manager across restarts; it is not
the provider API key. The CLI removes it from the environment before
launching tools. It is neither transmitted nor written to the journal.

The signed mode preserves complete thinking blocks and opaque signatures
in the private session journal. The adapter scopes replay to the exact
endpoint, provider, credential and model. Changing any of them or the local
replay key discards the affected thinking block from outbound history, not
the original tool identity. The provider, not the local codec, validates the
signature. A real provider may reject tool continuation across routes;
the loopback test only verifies that private reasoning bytes do not travel
to the changed route. Signed thinking remains disabled in the Desktop default.
