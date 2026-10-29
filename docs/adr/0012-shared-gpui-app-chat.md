# Shared GPUI App Chat

Status: implemented in source, 2026-10-29. Extends ADRs 0007 and 0008.
Runtime and package acceptance are recorded separately in
[App Chat verification](../fitness/app-chat.md).

## Context

Apps need a conversation beside their domain UI, and standalone Products may
need the same Composer without the Workbench navigation. Keeping the conversation
inside `impl Workbench` would require a second implementation for each shell.
Copying the Workbench Wasm into every App would also bind product delivery to
unrelated navigation and project UI.

The composition unit is a Rust UI library. A separately delivered Wasm entry is
a shell choice, not a new Agent runtime or a second owner of session state.

## Decision

### Shared component and two composition roots

`crates/pero-chat-ui` owns `ChatPanel`, its retained Composer, conversation
projection, streamed message rendering, tool and reasoning disclosure, context
selection UI and usage display. It emits typed `ChatAction` values. It does not
start a GPUI Application, an ACP process or a Host. Theme and asset definitions
used by both shells are shared through this crate.

- **Workbench:** `pero-ui` holds one `Entity<ChatPanel>`. Ordinary conversation
  pages and the active App's chat column render that same Entity at different
  times. Opening, collapsing or moving to an App view does not create another
  Wasm instance, Composer or Agent connection. A wide window reserves a right
  column up to 420 px and at most 55% of the content region. Below 1050 px the
  open chat occupies the content region and the App iframe is hidden but retained.
  The App iframe viewport excludes the chat region.
- **Standalone:** `pero-chat-web` is a small GPUI composition root depending on
  `pero-chat-ui`. The Product shell mounts its chat-only Wasm in
  `pero://chat/chat.html`; the domain App remains at `pero-app://<name>/…`.
  Only the trusted shell has Electron preload access. Host events, typed commands,
  theme, locale and active state cross the bounded shell bridge. The chat frame
  has its own Wasm memory, GPUI Application and Entity; it shares implementation
  with the Workbench, not live in-process state.

This does not introduce dynamic Wasm linking, GPUI Entities shared between Wasm
instances, multiple GPUI runtimes in one Workbench document, or a portable
adapter for the whole Zed Agent UI dependency graph.

### Conversation scope and authority

`AppChatScope { app, panel }` associates a conversation with its originating
App panel. The shared panel remembers the last conversation selected for each
scope, including the ordinary unscoped chat, and keeps drafts with their
conversation. Host session history retains the association so replay can
restore it. Changing scope selects or creates a draft; it does not submit work.

A scope is a UI/session association. It grants no domain tools, file access,
credentials, backend authority, Task/Run membership or cross-App permission.
The Host remains the owner of ACP sessions, provider configuration, authentication,
permission responses, workspace write leases, cancellation and durable history.
The shell carries out `ChatAction`; App code does not receive Host handles or
create another general conversation backend.

### App SDK entry

`useAppChat()` supplies two actions:

- `open()` reveals the Host conversation for the sending App panel.
- `compose(text)` reveals it and places the supplied text into its draft.

The shell derives App and panel identity from the sending managed iframe before
selecting its scope, rather than accepting a caller-supplied App name. Neither
action sends a prompt. The person reviews and submits through the same Composer.

Agent → App semantic operations, bounded DOM fallback, task grants and panel
evidence are implemented separately by [ADR 0014](0014-app-use.md). Structured
Composer object references, workflow execution and result registration remain
separate interfaces. Chat availability alone grants no App operation.

### Reported usage

`SessionUsage` distinguishes context occupancy (`context_used` and
`context_capacity`), optional input/output token readings and optional provider
session cost. The ACP adapter maps reported usage into the Host event/history
path; the shared UI projects that data. Unreported fields remain absent.
Context occupancy is not accumulated token consumption. Provider cost is a
cumulative session reading, never the sum of repeated UI snapshots; the UI does
not invent a monetary amount from message length or an assumed model price.

### Product selection and build

`Product.chat` is a validated boolean defaulting to `false`. A Product that
enables it includes the chat-only Web/Wasm output and existing Agent adapters;
it still excludes Workbench navigation. The App-only default retains its
existing delivery path. Chat activation does not change Python/Node runtime
selection or grant remote control-plane authority.

`products/virtual-cell-chat/product.json` is an explicit development example
with `chat: true` and `python: system`. From the repository root:

```sh
npm run build:product -- --product virtual-cell-chat
./node_modules/.bin/electron target/products/virtual-cell-chat
```

The selected local Agent must be installed and authenticated for real requests.
Use a separate `PERO_DESKTOP_DATA_DIR` for an isolated trial profile. This example
is distinct from `products/virtual-cell`, which retains bundled Python and does
not enable chat by omission. It is not a release configuration or a claim of
scientific acceptance.

`node scripts/build/wasm.mjs --chat-only` builds only the standalone chat entry;
the normal Wasm build prepares both entries. The Product builder uses a
chat-only Vite entry and stages that payload under `web/chat` when enabled.

## Consequences and verification

Both shells use one Composer and transcript implementation. Workbench navigation
stays in its composition root; standalone products pay for an additional GPUI
Wasm runtime and its embedded assets. Sharing Rust source does not remove that
bundle cost. Package size, duplicated assets, startup behavior and GPU/platform
support must be measured on the assembled Product.

Compilation, pure contract/UI tests, actual Electron behavior, real-provider
execution and signed package acceptance are separate evidence levels. Test
workbench App scope switching, draft retention, collapse/expand, narrow windows,
light/dark, locale, keyboard/IME, permission and cancellation paths in each
applicable shell. Product chat-disabled behavior and chat-enabled behavior have
separate checks. Record actual results and remaining gaps in
[App Chat verification](../fitness/app-chat.md); this ADR alone asserts no
Electron, real-provider or packaged-platform acceptance.
