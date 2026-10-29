# Global appearance verification

2026-10-29, macOS arm64, development checkout. Unrelated concurrent Chat,
reader and Paper Agent changes remain in the working tree. No release package
or publication is part of this verification.

## Implemented and checked

- ADR 0015, typed font bounds/inheritance and shared `pero-theme` resolution.
- One installed GPUI appearance, synchronized Kit colors/tokens, platform font,
  independent interface/Chat/code sizes, Teal/Blue/Neutral accents.
- Native initial system appearance and subsequent observation; acknowledged
  Host settings install appearance, locale changes do not reinstall it.
- Settings categories, search, compact value menus, editable bounded sizes and
  inheritance. Each search-result section has a stable parent ID;
  duplicate stepper accessibility IDs were reproduced and corrected.
- Web/App SDK receive the resolved palette/typography snapshot. App-owned
  fixed CSS sizes and scientific figures are not all migrated by this change.

## Evidence

- Native build: `node scripts/cargo.mjs +nightly-2026-10-28 build -p pero-ui
  --features native --bin pero-native` passed.
- `npm run build:wasm`, `npm run build:web`, `npm run build:desktop` and
  `npm run check` passed (TypeScript, generated contracts/theme, locales/icons).
- Contracts, runtime, Host, shared Chat, Chat Web and Workbench Rust tests passed.
  `pero-theme --features native` resolution matrix also passed.
- `node tests/e2e/appearance.mjs` passed: old settings/defaults, live palette and
  CSS projection, separate font scopes, language without reset, restart,
  inheritance, light/dark system changes, 1000px window with large text, invalid
  size rejection, failed-save preservation and recovery. Search uses the normal
  focused input and renders all font groups. Screenshots/state are under
  `test-results/appearance/`.
- `node tests/e2e/product-chat.mjs` passed: shared Chat reply with ACP fixture,
  independent App drafts, retained iframe, dark mode, locale and narrow layout.
  The fixture now seeds its own profile's selected Agent to avoid selecting a
  separately installed CLI. Results are under `test-results/product-chat/`.
- Native controls were exercised in a separate temporary data home and a
  separately identified QA bundle: light mode, accent, UI size, independent
  Chat adjustment, inheritance, restart and multi-section search. The latter's
  accepted screenshot is `test-results/appearance/native/font-search.png`.
  System-wide macOS appearance was not changed; automatic system changes were
  exercised in Electron. Native cross-platform/IME acceptance remains separate.

## Settings shell correction

The user supplied Zed Settings screenshots and requested its window/navigation
behavior. Inspection of `~/test/zed/crates/settings_ui` establishes:

- `open_settings_editor_with` reuses or opens a normal native `SettingsWindow`.
- The left side is a `TreeViewItem` category/section tree, generated from page
  metadata. A child selects the page and scrolls to its section.
- Only field selectors are popovers: enum menus and searchable font/theme
  pickers. Numbers use an editable `NumberField`.

Native now opens a normal Settings window in the existing application;
Web/Electron open the same SettingsPanel in a bounded dialog. The Workbench
keeps ownership of preferences, Host commands and acknowledgement handling.

The corrected presentation removes the second full-width titlebar, large bold
section titles, read-only font-family rows and repeated preview blocks. All
navigation entries belong to one tree; account, resource and Agent entries are
links to the existing Workbench pages. They are not a second set of buttons
pinned to the bottom, nor newly implemented account/Agent forms in Settings.
Selectors and numeric fields share height, muted surfaces and subtle borders.

The internal tree list is explicitly sized. Numeric editing composes Kit Input
and domain-owned step actions, avoiding duplicate native accessibility focus
registration in Kit NumberInput. The dialog ignores its default confirmation
action so Enter saves the field without closing Settings.

The updated `appearance.mjs` exercises actual category clicks, tree arrow keys,
collapse/expand, direct font input, range rejection including blur, recovery,
and preservation of the underlying route, in addition to the earlier Host and
appearance scenarios. It passed with the updated Wasm/Web/Desktop builds.
Native checks separately exercised direct input, steps, inheritance, light/dark,
closing/reopening Settings and navigation to an existing page. No focus panic
occurred with the corrected Input composition. Current screenshots include
`test-results/appearance/native/settings-final-dark.png` and the Electron
light/dark, search, invalid-input and narrow-window captures in that directory's
parent. Native Windows/Linux and full assistive-technology acceptance remain
outside these macOS checks.
