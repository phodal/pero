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

## Settings interaction and density refinement

The numeric field now has one shared frame, aligned values and step buttons;
inheritance sits beside its label and wraps with the label at large text sizes.
The field accepts direct edits and Up/Down (1px), with Shift using 4px steps.
`FontSize` owns parsing and clamping. A step starts from the current valid draft,
and the save-triggered blur cannot write the previous value over that step.

Settings initially focuses search. Cmd/Ctrl-F selects its current query;
Down enters the filtered navigation tree, and Cmd/Ctrl-Shift-E focuses the tree.
The selected tree row shows a keyboard focus outline. Search includes labels,
descriptions and enum values; Escape clears a query while keeping Settings open.
Matching links to existing Workbench pages also render in the result area.

Runtime inspection at 760px width and 24px UI text caught a dialog sizing defect:
the generic dialog body grew to its content height while its outer surface
clipped it, leaving the panel's scroll range at zero. Settings now uses the
dialog's bounded content slot. The E2E check asserts viewport containment and an
actual scroll range, then clicks, edits and saves the visible Code font field.
Input bounds alone were insufficient because a clipped input could retain old
coordinates. `03-largest-narrow.png` and its state capture show the corrected
scroll and successful edit.

The refreshed native/Wasm/Web/Desktop builds, `npm run check`, contracts tests
and `tests/e2e/appearance.mjs` passed. Native search, query clearing, category
focus, single/Shift steps and inheritance were checked in a new fixture-only
data home and `com.openpero.settings-refine-qa` bundle. The earlier appearance
preview profile had acquired a real session and was left untouched during this
refinement. Native evidence is
`test-results/appearance/native/settings-refined-dark.png`. Screenshots and
per-capture JSON diagnostics are local verification output, not source assets.

## Workbench density

The follow-up applies compact geometry across the Workbench: sidebar sessions,
content tabs, shared Chat toolbar/composer, Settings, project/task pages, App
library, connection forms, Worker and Agent lists. The default row/control
height changes from 30/28px to 24px, with a 30px tab strip replacing 38px.
Controls grow by text line height plus fixed padding; UI/Chat/code preferences
and the palette are preserved. General page padding is 12px, page titles use
Heading rather than Title, and status labels have smaller insets. Settings
rows use 6px vertical padding with 12px section gaps.
The usage summary joins the composer toolbar, with its existing detail popover,
instead of consuming a separate full-width row above the input.

`WorkbenchStyle::input` supplies the same frame height and text size to search,
settings and connection/task inputs. Native inspection confirmed the previous
single-line `Input::h` calls did not control their frame height. Native screenshots
are under `test-results/compact/`, captured from the fixture-only
`com.openpero.compact-qa` bundle. These checks cover the GPUI workbench and shared
Chat; App-owned HTML layouts and platform titlebar decoration are separate.

Existing workspace and composer E2E pointer gestures were updated for the new
geometry. Tab closing now uses measured active-tab bounds; the workspace test
also explicitly seeds its fixture Agent so a separately installed CLI cannot
be selected. The tests retain checks for separate drafts, retained App state,
restart, resize, narrow/dark layout, real menu interaction and context insertion.

Native/Wasm/Web/Desktop builds and `npm run check` passed. Contracts, Workbench
and shared Chat Rust tests passed. `appearance.mjs`, `workspace.mjs` and
`composer.mjs` passed sequentially with no browser errors. Native light/dark
settings and the relocated usage popover were inspected separately; the final
chat capture is `test-results/compact/native-chat-light.png`. Provider messages
in that capture come from the ACP fixture; no real model or tool execution is
claimed by this presentation check.
