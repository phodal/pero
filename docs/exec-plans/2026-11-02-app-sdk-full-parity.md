# Pero App SDK migration

Status: public SDK migration and local Host contract verification complete.
The SDK source baseline is recorded in the package NOTICE. Pero owns its runtime,
permissions, sessions and execution. No external application runtime is imported.
Existing Pero App calls remain supported.

## Delivered contracts

- Every baseline public export is available across the eight JavaScript entries,
  plus tokens.css and optional fonts.css. The runtime export manifest is checked
  from built modules, without a second repository checkout.
- UI includes controls, trees, tables, menus, overlays, structured results,
  Markdown, CodeMirror and resize handles. Source viewing retains syntax
  highlighting, line marks, folding, search, line offsets and navigation.
- Declarative document charts and interactive time-series lanes retain null
  gaps, selection, synchronization, theme changes and disposal.
- Core provides permission-scoped API and binary input reads, event admission,
  internationalization, examples, downloads, message markers and one object
  surface owner. Each App retains one React runtime.
- Themes and generated component appearance use Pero names and palette. Source
  attribution and required license texts remain in NOTICE and LICENSE files.
- The local Host admits declared capabilities and API paths, scoped Agent
  preparation, frozen schema-bound context, idempotent start/lookup, status,
  events, cancellation, retry and read-only terminal discovery. Preparation
  routes use the App's supervised backend and keep credentials inside the Host.

## Host capability boundary

Session/Project conversation and Desktop mount contracts are optional callbacks
in the SDK. Their attachment, release and unavailable behavior are verified.
The default Electron Host supplies generic App conversation mounting; the native
Host currently does not. Neither default Host supplies Project Run or Desktop
mounting. Unsupported slots show their explicit fallback.

The default App chat bridge supports draft text, reference attachments, capture
and goal approval. Targeted Session/Project/workspace launches, automatic
submission, presentation placement, visibility, fresh conversations and plugin
selection require additional Host implementation; custom Provider callbacks
receive the full SDK options. These default Host features remain outside the
completed public SDK port and must not be represented as runtime parity.

Terminal discovery reports only terminals actually lent to the Run. An empty
list does not imply a terminal creation or input capability.

## Verification evidence

- SDK behavior and public export suite: 128 passing tests.
- Object surface suite: 8 passing tests with dynamic code generation disabled.
- Runtime App suite: 26 passing tests; SDK and repository typechecks pass.
- All built-in Apps, Web, Desktop and Host builds pass; native UI checks pass.
- Real Host stdio plus Desktop HTTP contracts verify API admission, prepared
  context, binary grants, run ownership, retries, cancellation and restart.
- Scripted Harness verification passes both approval decisions. This run does
  not establish new real-model or human-click approval acceptance.
- Actual Chromium interactions pass in light/dark/narrow layouts. The browser
  check found and fixed a Node Buffer dependency in chart validation.
  Screenshots and verification data are under test-results/app-sdk/.

See [SDK documentation](../../packages/app-sdk/README.md) and
[code surface verification](../fitness/app-sdk-code.md). Browser fixtures and
local builds do not establish packaged Desktop or business acceptance.
