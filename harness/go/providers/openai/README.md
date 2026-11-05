# Explicit chat-completions provider

This is the text/tool-call slice of the pinned DSH Go port. Configure endpoint,
credential, provider ID and exact model catalog explicitly. No default provider,
model discovery, credential lookup, anonymous identity, session-log telemetry,
Files API upload, UI, or Point service is included. HTTP is accepted only for
numeric loopback fixture servers by default. An operator can explicitly set
`Config.AllowHTTP` (CLI: `--allow-http`) for a supplied plaintext provider endpoint;
this does not change TLS verification or other services' endpoints. Redirects
and SDK retries are disabled. Retry decisions remain owned by the harness.

Unknown model/provider, unsupported media, content extensions, request extensions and
unadvertised reasoning settings fail before network dispatch. The provider
supports streamed text/reasoning, tool-call argument assembly, tool results,
usage, cancellation and structured provider failures. It rejects truncated SSE,
missing terminal finish reasons and incomplete tool calls. Limits are 1 MiB per
SSE line/buffer and 16 MiB per response. Error bodies and remote request IDs are
not copied into public diagnostics.
Typed DNS failures, transport timeouts, premature EOF and connection reset/refusal
receive fixed public labels under the existing TRANSPORT code. Their original
causes remain available in memory; URLs, private hostnames and arbitrary transport
error strings are not copied into the public failure or native turn error.

The transport/assembly and error taxonomy are adapted from the source recorded
in SOURCE.json; the explicit constructor and bounded request encoder are a
narrow replacement for product-specific initialization and media routing. The
upstream DeepSeek notice is retained in DEEPSEEK_LICENSE.txt. Tests use only local
HTTP servers and literal fake credentials. They do not certify real models.

## Explicit raster input

Models are text-only unless explicitly declared with `InputModalities:
["text", "image"]` (headless CLI: `--image-input`). This is an operator declaration
of provider capability, not automatic model discovery or a new file/network
permission. User images and standard MCP tool-result images become typed
`image_url` content parts with canonical base64 **data URIs**, never plain text.
Text-only message wire shapes remain unchanged.

For text-only models, tool-result images stay intact in the journal and ACP
conversation for display. The provider projects each image to an explicit
unread-pixels notice alongside the tool's text metadata and display reference.
This permits caption-based answers with inline figures without claiming a visual
read. User image attachments still fail when image input is not declared.

Only in-memory PNG/JPEG bytes are accepted: full decode, exact MIME match,
at most 4 MiB each, maximum width/height 2048, and 16 MiB of image bytes per request.
Remote URLs, local paths, SVG, audio, file uploads, incomplete images and missing
image bytes fail before HTTP. No image is fetched, executed or uploaded through
a separate Files service. This bounded local adaptation is not full upstream
media-routing parity. DeepSeek's current model capability and content-part schema
must be checked separately before real inference:
[models](https://api-docs.deepseek.com/quick_start/pricing/),
[chat completions](https://api-docs.deepseek.com/api/create-chat-completion/).
