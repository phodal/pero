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
unrelated harness commits. The shared icon guidelines and Lab icon mapping were
added on 2026-11-06 after checking the remaining local-only changes.
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
| Generic Lab app glyph | Shared `flask-conical` association | Web and Native resolve the same Lab identity through the existing registry; explicit artwork and theme overrides retain their authority |
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

- Icon follow-up (2026-11-06): regenerated and checked **83 shared icons (42 Kit assets)**; all **3 content-icon tests** passed. This source follow-up does not establish additional Native visual acceptance.
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
| Native preview executable (ad hoc signed) | `47b02738e49af3b0098d7753af1ac8bddabe889f52725ba3cc10bfd9b58bd541` |

CI follow-up on 2026-11-06: refreshed the generated Bazel npm-script input
cache; `bazel test --config=ci //:checks` passed 7/7 and server build passed.
Updated Viewer browser/Desktop E2E locators for real DropdownMenu, Tabs, Select
and FilePicker semantics. Production Viewer + Chromium + RDKit 2026.09.1 passed
five scenario groups with zero page errors; Viewer typecheck and 17 unit tests
passed. Desktop E2E locators were updated but the Electron run was not performed.
The menu patch now retains trailing hunk context while avoiding whitespace-only
context lines: `git apply --check` against CI's pinned Kit revision `ec89cfc`
and full immutable `prepareKit` both passed; its cache test passed 1/1. The earlier
failure occurred before Cargo started, and is distinct from Rust compile results.

## Acceptance limits

This is not a claim that every App domain workflow has been rerun. Paper/Lab
Select migrations have source, type and behavior verification; full research,
review/freeze and scientific workflows remain their owners' acceptance scope.
Native drag/drop, system file dialogs, screen readers, full IME and cross-platform
rendering were not comprehensively tested. Third-party editors/scientific graphics
retain their own implementation. Browser/catalog evidence does not substitute for
Native evidence or acceptance of a signed installation package.

## Five App follow-up (2026-11-06)

The follow-up starts from `1079a62afd76f0c3e55c1b5abf4d35b22eabef59`.
App implementation through `ba404d3b` is covered by the checks below; the
subsequent test/documentation commit records the same implementation. The later
master integration and its checks are recorded separately. This section does
not replace the earlier Native acceptance limits.

| Consumer | Previous behavior → adopted component/state behavior | Preserved boundary |
| --- | --- | --- |
| Paper | Clipped horizontal navigation → compact shared Select with results/shelves/collections; fixed library/search typography → shared scalable tokens; nested research records → list and selected detail; raw review inputs → Input/Textarea/Checkbox; PDF actions → ContextMenu including original download | Evidence review, scientific assessment, source identity, disabled/required semantics and Host-owned chat execution |
| Paper library | Refresh replaced the workspace and hid errors on other routes → retain query/editor/selection during ordinary refresh, global retry, explicit initial-load failure; API scope changes and HTTP 401/403 clear unavailable data | Old requests cannot write across API scopes; ordinary 503 failure retains the available library; an unread library is not presented as an empty results list |
| Data | Tiny multi-column catalog and competing empty states → title-first ListRow and one initial state; nested source detail → shared Dialog; raw selection/progress → Checkbox/Progress | Same file/version table/chart, range label, chart surface and edit draft survive refresh/failure; file/version/permission changes invalidate incompatible results; sandbox DataForm remains in use |
| Environments | Imperative local controls → shared React Input/Select/Tabs/Table; refresh replaced inspection → stable panels and previous observations with timestamp/retry | Existing client and Host own operations; revoked/missing objects clear; metadata-only observations do not establish runnable scientific readiness; restart still needs the existing confirmation |
| Connectors | Implicit catalog/installed mode → explicit ToggleGroup and refresh; hidden prerequisites → direct copy; fixed code typography → shared tokens; raw tool selection → Checkbox | Connection operations, secret storage and allowlists remain domain-owned; refresh keeps configuration drafts; obsolete locale/unmounted requests neither write nor restart polling |
| Insights | Missing data appeared empty and regeneration removed the brief → explicit loading/availability/empty/error states with retained edition; handwritten tabs → Tabs/Content; inert actions/sources → source links, existing-session navigation or a prepared chat draft | A paused generation resumes the original session; duplicate start is blocked; unsafe source URLs are not linked; preparing a draft never submits it; Host checks the existing session before reporting navigation success |

Independent review found and corrected paused-generation tracking, stale polling,
missing-session acknowledgement, API-scope retention and hidden library errors.
The final screenshot review also found the old stacked-navigation CSS overriding
the new compact mode; it was removed, and browser assertions now verify its
absence and the computed 24px search/heading scale.

Validation on macOS arm64:

- Actual five App frame entrypoints, production SDK aliases and isolated loopback
  API fixtures: **7/7 Chromium regressions**, no page errors. These exercise
  loading, empty, failed refresh, keyboard panels, existing-session/draft
  messages, compact navigation and same-session generation continuation.
- Paper numeric/Docling/workspace: **20/20**; Connectors: **39/39**, including
  real label selection, composing Enter, unmount/locale request races and draft
  retention; Data: **14 browser tests** (including its real Python 3.12 backend)
  and **8 model tests**; Environments: **23 tests**; full SDK: **155/155**.
- Root `npm run check`, affected App and SDK typechecks, and all five production
  App builds passed. The final Paper CSS was rebuilt after the screenshot fix.
  Insights prompt/model and Web session presentation/navigation: **6/6**.
- `cargo check -p pero-ui --features native` passed using the configured nightly
  toolchain and existing GPUI sources; existing warnings remain. This verifies
  the Native route compiles, not that a GPUI window was observed in this pass.

Reproduce the five App browser regression with
`node --test tests/e2e/desktop-app-design.mjs`; set `PERO_DESIGN_SCREENSHOTS` to an
output directory to capture the tested states. No Agent run or production
approval occurs in that suite. The Data backend suite uses
`PYTHON=/path/to/python3.12 npm --prefix apps/data run test:browser`.

Captured and visually inspected real App frames (fixture data clearly scoped):
[Paper 600px/dark/24px](https://github.com/user-attachments/assets/9a00c666-ec19-40a0-9ec6-7cc6e8664c7f),
[Connectors 24px](https://github.com/user-attachments/assets/2fd67917-8074-40d4-9d0a-1b5062440f43),
[Insights retained brief/dark/24px](https://github.com/user-attachments/assets/61cbfa4a-eaa2-4d4e-87b7-6f6029a516da),
[Environments initial error/dark/24px](https://github.com/user-attachments/assets/5fc3c324-533f-4592-823c-0a5aafe462b9),
[Data initial empty/14px](https://github.com/user-attachments/assets/bb360c74-12e9-4a04-a7f8-09f10b472cf1).

An optional TypeScript/CSS AST candidate scanner and independent forward-test
workflow are maintained in [OpenStars PR #7](https://github.com/WeiJiLab/openstar-agents/pull/7).
Its bounded source results do not establish runtime, accessibility, physical IME,
visual or Native acceptance. Technical evidence disclosures remain where they
serve low-frequency review; source finding counts are not a mandate to flatten
them. Full Electron/GPUI runtime, screen readers and complete scientific workflows
were not rerun in this follow-up.
