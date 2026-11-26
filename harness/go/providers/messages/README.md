# DeepSeek Messages wire decoding

This package is a transport-neutral Go SSE decoder for the text and tool-use
portion of DeepSeek Harness `dsh-v0.2.3-alpha.2`. The reference implementation
is [the upstream translator at 4b399c39](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/llm/llm-deepseek/src/translate.ts).
It preserves block start order and reconstructs fragmented tool JSON.
Success requires a complete `message_stop`, a terminal reason and closed
blocks. Partial tool data can be observed as a delta, but is never returned
as a completed call after truncation, refusal or malformed input.

This package is not yet selected by the CLI, Host, or a provider adapter.
It neither issues an HTTP request nor uploads files and rejects unsupported
content such as signed thinking blocks. The existing Chat Completions and
Responses routes are unchanged. Next: add an explicitly configured HTTP
adapter with a typed request encoder and a loopback ACP tool round trip;
add faithful reasoning replay before advertising that capability.

Run `go -C harness/go test -race ./providers/messages`. These tests use
synthetic SSE only and do not contact a provider.
