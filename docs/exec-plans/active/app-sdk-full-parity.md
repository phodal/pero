# Point App SDK parity in Pero

The target is the public SDK at Point revision d95f9118e291819a99fa62595a73c375f7bb64cf,
including behavior, types, styles and accessible interactions. Pero owns its Host,
permissions, sessions, projects and execution. No Point runtime is imported.
Existing Pero Apps keep their supported SDK calls.

## Completion contract

- UI: every Point UI export, including controls, trees, tables, menus, overlays,
  structured results, Markdown, CodeMirror and resize handles.
- Chart: declarative document charts and interactive time-series lanes, including
  null gaps, selection, synchronization, theme changes and disposal.
- Core: permission-scoped API (including binary reads), event permissions/hub,
  i18n, examples, downloads, steering markers and object surfaces.
- Theme/client: public module entries, tokens, theme/style subscriptions and
  single React runtime registration inside the App document.
- Host: declared capabilities, navigation, notification, badges, chat launching,
  session/project conversation and Desktop slots, prepared Agent requests,
  idempotent start/lookup, run status/events/cancel/retry/terminal projection.
- Verify exported contracts, meaningful behavior suites, existing App builds and
  actual browser interactions in light/dark/narrow layouts. Host behavior must
  also pass over the real Pero Host boundary. A client stub is not parity.

## Work log

- Code surfaces already implemented and browser verified; full parity remains open.
- Public entries missing today: client, core, surface, fonts.css, tokens.css,
  tokens-css, themes. UI and root/host hooks currently expose only a subset.
- Implementation in progress on codex/app-sdk-full-parity. No completion or
  production/Desktop acceptance is claimed by this plan.
