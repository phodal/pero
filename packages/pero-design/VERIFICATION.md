---
kind: verification_report
date: 2026-11-05
---

# Desktop design system migration

## Scope and provenance

This record covers the shared design contract, Native shell and feedback, App SDK,
production component catalog, and the consumers listed below. Source inspection,
automated behavior checks and observed running surfaces are separate evidence.
The source checkout began at `5012bacbc48228d878ebd3cd73302a14d4857e42` with this
migration uncommitted. The PR is assembled on `origin/master` in
`codex/desktop-design-system`, retaining the design-principles commit and excluding
unrelated harness commits and the separately synchronized Lab icon artwork.
Final build identities and Native observations are recorded below after validation.

## Migration record

| Previous implementation | Shared replacement | Consumers / preserved behavior |
| --- | --- | --- |
| Repeated window/page titles | `WindowTitlebar` / `window_bar`, `LibraryHeader`, `AppBar` | Native shell, Viewer, Control Lab; complete object title retained, native window dragging and system control inset stay host-owned |
| Sidebar wordmark and full-width New Chat | Session row with independent labelled `+` | Native sidebar and catalog; new-chat action/bounds probe remain on actual button; collapsed entry remains reachable |
| Undifferentiated navigation groups | `SidebarGroup separated` / `sidebar_group` | Explicit Insights/Paper and Environments/App Store boundaries; routing and persisted width unchanged |
| Independent tab boxes / tiny pin mark | `ContentTab`, `content_tab`, `content_tab_label` | Native pane and legacy workspace tabs; MRU, drag/drop, dirty confirmation, close and pin state stay Workbench-owned |
| Fixed-width settings menus and 900px window | Content-measured Kit menus; shared 760px window default | Native/Wasm settings; minimum Native width 700px; submenu keyboard behavior preserved |
| Fixed menu row height | Immutable GPUI Kit height patch | Rows grow with typography; patch cache identity includes patch; upstream menu behavior retained |
| Raw preparation log / full-width recovery button | Native `feedback`, `feedback_actions`, `feedback_details` | Environment checking/creating/installing/ready/required/failed, App loading/open failure and catalog error; Host phases, retry commands and copy diagnostics preserved |
| Competing static/runtime control skins | One SDK runtime skin | Button/Input/Tabs/Card/Field/Feedback/Checkbox/FilePicker; native form behavior retained |
| Conflicting spacing / fixed small text | Generated design contract; canonical `--pero-spacing-*` | Rust/TS/CSS; legacy `--pero-space-*` remains compatibility-only; caption minimum 12px |
| Local selects and OS dropdowns | Shared `Select` | Viewer, Control Lab, Lab (3), Paper (17), Automations schedule, catalog; disabled/sentinel/value/reset/form semantics retained |
| Oversized short dropdowns, theme drift | 160px short / 260px searchable Select, semantic portal theme | Select/Dropdown/ContextMenu/nested submenu; current theme and typography follow live changes |
| Hover marker resembling selection | Neutral `surface-hover`, selected `accent-soft`, separate keyboard focus | Shared controls; selected tab/option state remains visible during pointer hover |
| Differing button/menu fonts | Shared body sans typography and regular control weight | Buttons, IconButton, Select, dropdown/context items and Popover; headings retain hierarchy |
| Local import controls | `FilePicker` single/multiple | Viewer, Virtual Cell, Lab; import validation and cancellation remain App-owned |
| Stage-independent Control Lab dashboard | Model plus editable Specification during preparation; response/verification/evidence after execution | Criteria, budgets, approval, freeze and science verdict stay domain-owned; missing checks/denominator retained |
| Control polling remount / proposal placeholder selection | Stable sibling keys and executed-trial selection | Draft, selection and focus survive same-object refresh; latest executed proposal selected; cancellation pending differs from stopped |

The catalog imports production controls and styles. Its interactions are local
examples; it does not execute an Agent. Scientific results are not implied by
successful component or build checks.

## Public component review

Three parallel reviews covered Native sidebar, Native menu/settings/feedback and
all public Web component exports. The following is the condensed audit matrix.

| Family | Source/behavior review and findings | Remaining acceptance scope |
| --- | --- | --- |
| Button, IconButton, Field, Input, Textarea, Checkbox, Radio, Switch, Slider | Labels, disabled/busy, native form participation, shared size/focus; added native range Slider; unified control typography | Full IME and assistive-technology pass |
| Select, MultiSelect, NativeSelect, FilePicker, TimeField | Select disabled/search/group/form/dialog/keyboard behavior; short width and nowrap fix; concrete raw select consumers migrated | NativeSelect and multiple list remain intentional compatibility exports; segmented time and OS file dialog need dedicated acceptance |
| Dropdown and submenus, ContextMenu, Popover, Dialog, Tooltip, InfoTip | Portal theme copying/live updates; close/focus behavior; nested dialog Select; long title/footer wrap | Touch context menu and screen-reader navigation |
| Tabs, ContentTab, ToggleGroup | Panel association, manual activation, dirty close intent; selected-hover precedence fixed; pin geometry standardized | Native tab drag/drop and all restore sequences |
| Sidebar, WindowTitlebar, headers, lists, ReaderFrame, SettingsGroup, SearchField, Composer | Source/API review and actual shell/catalog interactions; independent trailing actions and compact navigation | Reader integration and long production conversations |
| Card, Badge, Kbd, Feedback, EmptyState, Progress, Skeleton | Explicit status versus content tone; neutral unstarted state; retry retains draft; contrast pair tests | All product-specific error states are not covered by catalog examples |
| Table, ResultView, Tree/FileTree, SuggestionList, Stepper, Split | Selection/labels, keyboard routing, scroll regions, bounded split controls; Table arrow-scroll observed | Real tree drag/drop; callers must retain existing data during background refresh rather than using ResultView's replacing loading state |
| Markdown/ChatMarkdown, CodeViewer/Editor/Compare, CommandLine | Public API/skin and existing renderer/compare tests reviewed | Full CodeMirror editing, IME, research document and third-party editor scenarios |
| Icon/ContentIcon, ContentView, EnvironmentBrowser/Inspector, AppFrame/AppBar/Toolbar | Composition, accessible names and current exports reviewed | Environment resource/execution workflow is separate from UI feedback |

## Automated verification

- SDK full suite: **148 passed**; latest focused checks are recorded in the final validation section.
- Control Lab UI/presentation/retained-state suite: **22 passed**. Covers partial/failed results, zero values, stale refresh recovery, same-object draft/focus retention, cancellation and executed proposal selection.
- Paper numeric/Docling UI suites: **13 passed** after 17 Select migrations. Actual shared options replace native-select test interaction; local jsdom geometry shim only.
- Lab UI/domain suite: **10 passed** after shared Select migration.
- Contrast/generated contract and immutable Kit cache tests: **4 passed**.
- SDK, catalog, affected App typechecks and catalog production build passed.
- All **11 built-in Apps rebuilt** after the Paper and Automations migrations.
- Native feedback `cargo check --features native --bin pero-native` passed.
- Native/theme library tests: **22 passed** (1 theme + 21 UI).
- Root `npm run check` passed with toolchain on PATH: TypeScript, generated design/theme/SDK/contracts/icons, **944 bilingual messages**, 82 icons (41 Kit assets) on the PR base.

Initial reruns without the Rust toolchain on PATH failed to locate rustfmt/cargo;
those commands were rerun with the configured toolchain. Build warnings about
existing dead code, dependency future compatibility and Vite bundle directives
are not treated as completed visual acceptance.

## Observed running surfaces

- Actual Native macOS GPUI: compact sidebar and independent new-chat `+`, collapse/expand, Projects/search, compact content tabs and both group separators observed. Settings root/submenu now measure content (approximately 140/112pt rather than forced 240/170pt); submenu indicators fit. Earlier isolated preview also showed dark mode and Control Lab.
- Catalog: light 14px and dark 24px; real menu/Select portals, long/dirty/pinned/preview tabs; default geometry (30px tab, 24px Select, 32px nav/menu rows). Font option label at 24px measured one 33.6px line with `white-space: nowrap`.
- Catalog 420px/24px: stacked shell, document width and scroll width both **420px**; menu page content remains readable. Actual dropdown and nested submenu opened; Escape returned focus to the view-actions trigger.
- Keyboard: Select option selection and Escape; dirty-tab close leaves confirmation to caller; next-tab focus; named Table region scrolls 40px with ArrowRight. Nested Dialog/Select closes one layer at a time.
- Error recovery: catalog retry clears the old failure while retaining draft; can simulate another failure.
- Built Scientific Viewer: compact AppBar/example menu; `voltage-gaps.csv` retains synthetic/unverified and missing-data warning; Chart/Table keyboard switch preserves missing cell.
- Actual Control Lab built App with isolated Python backend (`python-control 0.10.2`): preparation shows model and Specification without empty chart/metric columns. A real 5-trial PID run completed but correctly reported **1 constraint failed, 8/9 checks, 5 scenarios**, including settling time 6.05s against a 5s limit. Execution completion did not become science PASS. No model/Agent call or production approval was made.
- Control Lab dark 420px/24px: document scroll width 420px, hash wraps, tables scroll internally. Evidence list/detail and raw-evidence dialog inspected; same-object polling retains editor/focus.

Screenshots captured and inspected (local ignored build evidence):

- [Control preparation](../../target/design-review/control-prepare-light.png)
- [Actual Control result](../../target/design-review/control-results-light.png)
- [Control dark narrow](../../target/design-review/control-results-dark-narrow.png)
- [Viewer](../../target/design-review/scientific-viewer.png)
- [Native sidebar](../../target/design-review/native-sidebar-final.png)
- [Native settings menu](../../target/design-review/native-settings-menu-final.png)
- [Web menu, dark 24px](../../target/design-review/menus-dark-large.png)
- [Web menu, 420px](../../target/design-review/menus-dark-narrow.png)

## Final validation

Final code build: `97e2ea33` plus the catalog command/documentation commit. The PR
worktree retains master’s Windows patch normalization and excludes unrelated
harness work. Root check, all 11 App builds, production catalog build and Native
build passed on this tree. SDK **148/148**, Control **22/22**, and Native/theme
**22/22** passed; latest focused hover/menu/input/tab/split/table checks **43/43**.

Observed the final production catalog (not the HMR dev page): at 18px, Import
File and dropdown items both resolve to the same system sans family, **18px / 400**;
pin is **18×18px** and does not shrink. Actual pointer hover on the 14px option
has the neutral hover background, **no box shadow, no outline and no pseudo-element
side marker**; the selected 18px row retains the accent background/check. Dark
24px menu and tab icons were also inspected. The actual built Control App’s shared
history selector reopens the completed run with its failure verdict/evidence intact.

The final Native feedback/pin binary compiled and was launched, but the Mac locked
before final observation. Earlier Native shell/settings observations above remain
valid for those earlier builds; the new environment feedback, its technical-details
disclosure and the final pin geometry do **not** yet have a completed Native visual
acceptance pass. The PR remains draft until that pass can be completed. The user
was asked to unlock the Mac; no dependency installation was used to hide the warning.

Final screenshots: [pointer hover](../../target/design-review/select-hover-final.png),
[pin and matching fonts](../../target/design-review/tabs-fonts-final.png),
[dark 24px](../../target/design-review/tabs-fonts-dark-final.png),
[actual Control result](../../target/design-review/control-results-final.png).

Artifact SHA-256 (macOS arm64, Native GPUI / Web catalog):

| Artifact | SHA-256 |
| --- | --- |
| target/design-catalog/assets/index-AYJT4H3e.js | `ac326ee25abdc534d7a9dd8e4a124cb064b79690eca37d97f7ee6ebcfc7f2235` |
| target/design-catalog/assets/index-DlSDSv2j.css | `886b1fb732126670eaebac31ad8d33c253d7838fc8fd9d4d7f31df1db13d3264` |
| apps/control-lab/dist/index.js | `aae88ab7d4a27fa2433006e4b1d8738d68b9e7977402e79099f82b601e332dd9` |
| apps/control-lab/dist/index.css | `b2b1deadb30d276b108fe354fd732378fcfa529fb70075e981320c1a7950c764` |
| Native preview executable | `998522e45e80bb9e9f7b85f4f714a7824652adba89aa6fee2d4b900f37f32379` |

## Acceptance limits

This is not a claim that every App domain workflow has been rerun. Paper/Lab
Select migrations have source, type and behavior verification; full research,
review/freeze and scientific workflows remain their owners' acceptance scope.
Native drag/drop, system file dialogs, screen readers, full IME and cross-platform
rendering were not comprehensively tested. Third-party editors/scientific graphics
retain their own implementation. Browser/catalog evidence does not substitute for
Native evidence or acceptance of a signed installation package.
