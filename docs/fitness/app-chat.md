---
kind: verification_report
date: 2026-10-29
---

# Shared GPUI App Chat verification

Source: the working tree based on `8cc525f`, including concurrent App-agent work.
This record covers shared Chat components and their two composition roots from
[ADR 0012](../adr/0012-shared-gpui-app-chat.md). It does not claim a clean,
independently committed patch or acceptance of the concurrent domain Agent.

## Implemented

- `pero-chat-ui` owns the retained Composer, context completion, streamed
  transcript, tool disclosure, independent reasoning disclosure and usage UI.
  Workbench renders one `ChatPanel` Entity in normal conversations or beside an App.
- `pero-chat-web` is a separate Wasm entry built from the same components.
  Standalone products with `chat: true` load it in a separate `pero://chat`
  iframe, beside the domain App iframe. Only the parent shell has preload access.
- App/panel scope is recorded in Host session history. Switching Apps retains
  separate drafts and selected conversations. App SDK `open`/`compose` selects
  the sending managed App and fills the draft without submitting it.
- History refresh retains drafts and live state; fresh surfaces can replay
  `turn_started`. Tool detail views remain lazy and collapsed failures retain
  their summary. Reasoning toggles affect only their own block.
- Usage comes from stable ACP `usage_update`: context occupancy and optional
  cumulative session cost. The current ACP configuration does not report turn
  input/output tokens; those fields remain absent.
- `Product.chat` defaults to false. The `virtual-cell-chat` development product
  opts in and uses system Python. Normal Workbench payloads remove the unused
  standalone Chat entry/Wasm while retaining shared assets.

## Checks observed

- `npm run check`: TypeScript, generated theme/contracts and 534 bilingual keys passed.
- Rust suite: 79 tests passed across contracts, shared Chat, runtime, Host,
  Workbench and Worker. Loopback tests require execution outside the filesystem
  sandbox; the initial sandbox-only attempt failed on denied listener creation.
- `node scripts/cargo.mjs +nightly-2026-10-28 check --offline -p pero-ui --features native` passed.
  This proves compilation, not native UI behavior.
- `node tests/contracts/host.mjs`: 33 of 48 event kinds exercised; all observed
  JSONL commands/events and replay passed. App scope survived Host restart.
- `npm run test:product`: six Product/bundle/payload checks passed.
- Both Wasm entries, Web assets, Desktop and Host built successfully.
- `node tests/e2e/workbench.mjs`: multi-turn input, cancellation, approval,
  1000 exact Chinese chunks, reader-scroll preservation, replay, locale,
  light/dark and narrow layouts passed with zero recorded renderer errors.
- `node tests/e2e/toolcalls.mjs`: nine-call tool matrix and lazy tool views passed.
- `node tests/e2e/composer.mjs`: capability-driven controls, frozen references,
  removal/undo, commands, skills, images/paste/picker, approval, keyboard
  completion, unsupported-image recovery and narrow/dark states passed.
- `node tests/e2e/apps.mjs`: real Virtual Cell iframe/Python workflow passed,
  including SDK compose opening the shared GPUI sidebar, a reduced App viewport,
  narrow Chat and retained App document. No prompt was submitted by compose.
- `node tests/e2e/product-chat.mjs`: actual Electron with the separate Chat Wasm
  and isolated ACP fixtures passed: cross-origin/no-preload checks, keyboard
  input and replies, usage, tool disclosure, cancel, retained drafts, two-App
  switching, replay during a running turn, language/theme and narrow layout.
- `npm run build:product -- --product virtual-cell-chat` staged the actual
  development product. A separate Electron smoke opened its real Virtual Cell
  panel, connected the staged Host to Chat Wasm, completed an isolated fixture
  turn and inspected light/dark screenshots; zero recorded renderer errors.

## Isolated commit verification

The App Chat patch was projected from `8cc525f` without concurrent App-agent or
workspace changes. TypeScript/theme/contracts, 534 bilingual keys, both Wasm
entries, 78 Rust tests and six Product/payload checks passed on that projection.
The Electron observations above used the working tree recorded above.

## Evidence

Generated evidence is local/ignored:

- `test-results/workbench/`, `test-results/toolcalls/`, `test-results/composer/`
- `test-results/apps/app-chat.png`, `app-chat-narrow.png`, `result.json`
- `test-results/product-chat/dark.png`, `narrow.png`, `result.json`
- `test-results/product-chat-built/light.png`, `dark.png`, `result.json`
- Development payload: `target/products/virtual-cell-chat`

Build identities observed after these checks:

| Artifact | SHA-256 |
| --- | --- |
| Workbench Wasm | `e7eee4f311bbf189e8689ff987eab056f1d00d0edb6b97cfac64cf5c6fcc8315` |
| Chat Wasm | `8325efbeb77abf0d7ee944252fb809c3a9f2a152890facab5bfe2256d5dbe6e9` |
| Development Host | `d27d79d381facc83f79b9c2f8b58b3d7649140f6b8041cf86a790de63dc98ff2` |
| Staged Product Host | `21ab02f6ec748d188e75b850c0432c8a3af56b743996cf1b476c9000b6b76d97` |

## Remaining boundaries

These are macOS development Electron observations with scripted ACP Agents.
No paid/real model request, domain Agent tool integration, structured App object
reference, scientific acceptance, signed/notarized release, release-size budget,
Windows/Linux runtime, physical OS IME or native GPUI App surface is accepted by
this record. Multiple independent GPUI Wasm instances mounted directly in one
document were not implemented; Workbench uses one instance and the standalone
Chat uses its own document. Drag-resizable panels and whole-turn process folding
remain separate UI work.
