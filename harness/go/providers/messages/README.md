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
`thinking: {"type":"disabled"}` on every call. This first version supports
text and local-tool history only. It does not support signed thinking,
images, Files, hosted tools, or in-conversation system updates. The
Desktop Host defaults and the existing Chat Completions and Responses
routes are unchanged.

Run `go -C harness/go test -race ./providers/messages ./providers/openai`.
See [the ACP fixture](../../../../docs/fitness/dsh-alpha2-alignment.md)
for the two-executable loopback check. These tests do not contact a model.

The separate `ReadSignedStream` and `EncodeSigned` codecs preserve completed
thinking and opaque signature bytes through the canonical message JSON, in
their original order before a tool call. Replay requires the exact same
locally admitted scope and model; a different model or scope receives no
thinking block. The codec does not verify provider signatures. A future HTTP
integration must own route/credential scope creation and verify that a real
provider accepts replay and route changes. The existing CLI and Host do not
call these codecs and still run with thinking disabled on this route.
