# Global appearance and scoped typography

Status: accepted, 2026-10-29. Extends ADRs 0001, 0007 and 0012.

## Context

Workbench and Chat currently retain separate palettes and dark-mode flags.
Chat context updates also reinstall the application theme, resetting its font
size. Native starts with a light system appearance and does not observe changes.
Fixed pixel font sizes bypass the component theme. App frames receive only a
dark-mode flag, so application-wide typography cannot propagate to them.

## Decision

GPUI's existing `App`/`Context` is the application context. Store one typed
`UiAppearance` in it; do not introduce another general-purpose context.
Appearance does not own sessions, credentials, navigation or locale.

### Ownership and dependencies

- `pero-contracts::appearance` owns transport-neutral appearance preferences,
  bounded font sizes and typography inheritance. Host runtime settings remain
  the only persistent store. Existing `WorkbenchPreferences.appearance` retains
  its wire format; new accent and typography fields have defaults.
- `pero-theme` owns typed palettes, semantic text roles, resolved appearance,
  GPUI installation and scoped typography. Workbench, shared Chat and standalone
  Chat depend on this crate. It does not import a shell or perform Host I/O.
- Each application composition root resolves preferences plus the observed
  system appearance, installs the result and refreshes its surfaces. Components
  read appearance; they do not install themes or save settings.
- GPUI Kit Theme is a projection of the resolved appearance. Mode changes and
  subsequent palette overrides use Kit's synchronized update API. No component
  mutates this projection independently.

`ResolvedAppearance::resolve(preferences, system_appearance, palettes)` is a
function of values. Native and Web adapters observe their own platform; the
resolver reads no clock, environment, filesystem or window.

### Typography

The default UI body is 14 logical pixels, Chat body is 16, and code inherits
the UI size. Chat can explicitly inherit UI size. User font sizes are 12–24.
Caption, Body, Heading and Title use the 12/14/18/24 design scale relative to
their scope, with captions never below 12. UI controls follow the UI scope;
message documents follow Chat; code blocks and source editors follow code.
Scope changes cover layout and painting. Font-dependent row/control heights
grow with text; borders and workspace split widths are not text scaling.

Workbench density uses the shared `WorkbenchStyle` geometry. At the default
14px UI size, rows and controls are 24px and the content tab strip is 30px.
Larger text increases height by its line box plus fixed padding, rather than
multiplying the padding. Shared input presentation styles the single-line
frame explicitly; Kit's inherent `Input::h` only sizes multiline editors.
The same geometry applies to navigation, settings and shared Chat controls.

Palette changes do not reset typography. Locale changes do not reinstall
appearance. The default UI uses the platform system font, with registered CJK
fallbacks retained; monospace is reserved for code.

### Colors and updates

`DESIGN.md` remains the palette source. The first implementation exposes Teal,
Blue and Neutral accents, using existing paired semantic colors. Accent changes
update actions, hover, links, focus and selection together; status colors retain
their meaning. Arbitrary theme files and a theme marketplace are outside scope.

Settings controls send existing Host preference commands. Only successful Host
acknowledgements replace active preferences; a failed save keeps the active
appearance and exposes the existing error. System appearance changes enter the
same resolve/install path, respecting explicit light/dark preferences.

### Runtime boundaries

One GPUI Application owns one live appearance. Shared Workbench Chat reads the
same object. Standalone Chat Wasm has its own global, installed by its composition
root from the parent shell's resolved appearance snapshot. App SDK consumers
receive that same bounded snapshot and map it to CSS variables. GPUI objects
never cross iframe/Wasm boundaries. Independent Products retain their own Host
settings and data homes.

## Verification

Test font bounds, default compatibility and inheritance in the pure model.
Test palette/mode resolution as values. Prove Host persistence and preservation
of unrelated settings with its existing settings test. Exercise settings in a
real Desktop window: immediate update, light/dark/system, independent Chat size,
accent, locale without reset, restart, save failure, narrow and large text.
Inspect Native separately; Electron results do not establish native rendering.
Record actual evidence and limits in `docs/fitness/appearance.md`.

### Settings presentation

`SettingsPanel` owns search, category selection, scrolling and input drafts.
It emits typed save, locale, navigation and close intents. Workbench handles
the intents and projects Host acknowledgements back into the panel. The panel
does not save preferences or install appearance.

Native opens or activates a normal Settings window in the existing GPUI
Application. It shares the application's appearance; it does not create a
second global context. Closing Settings leaves Workbench open; closing the main
window ends the application. Web/Electron use a bounded dialog containing the
same panel, preserving the underlying Workbench route and content.

The left side is a keyboard-accessible tree. Appearance children select a
section anchor in one continuous page, rather than separate routes. Search
filters both navigation and sections. Theme and accent use compact dropdown
menus. Font sizes use editable inputs and domain-owned step actions, with
inheritance beside the field label. Large repeated previews and read-only font-family
rows are omitted. Inputting an unchanged inherited value does not create an
override; invalid input does not change active preferences, including on blur.
Category/search state is transient UI state and does not introduce another
preference store.

All categories, including links to existing account, resource and Agent pages,
belong to the same navigation tree. There is no second set of shortcuts pinned
to the bottom. Section headers use small muted text; selectors and numeric
fields share heights, muted surfaces and subtle borders. Web confirmation does
not dismiss Settings when a field submits with Enter; Escape and Close dismiss
the dialog normally.
