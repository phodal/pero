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

### Master integration

Integrated master `98cb01fb` in `8a1e4249`; conflict review confirmed that the
three design documents already contain master's principles, with additional
icon guidance retained. Regenerated the combined icon registry instead of
resolving generated files by hand. The final App source is `d24a78f5`.

On that merged source, root checks passed (**972 bilingual messages / 84 icons**),
the five production App builds passed, and the combined Paper/actual App/Web
session behavior suite passed **29/29**. Native `cargo check -p pero-ui --features
native` passed again (12 existing warnings). The extra discovery/download/action
typography uses the same shared tokens. The previous Native visual limitations
still apply.

Production build SHA-256 on this source:

| App | `dist/index.js` | `dist/index.css` |
| --- | --- | --- |
| Paper | `8bb60bbbb8a826a4d5e22584b48c2f2afbaa9a1bfd9541937b73a1ad81753a86` | `d3a11a44f67a4cae4ee625ba97a4a8679acb2a56d0f81b048dad6d16fdc73d8d` |
| Data | `e321a7d439ccb088a53dc27d3b4ee3098905eb6b3fb2ba0f276248e325a1c999` | `665293cab265ec7bf3696a975ac91543b2b59177790c9580e999ec3cc1ef6e13` |
| Environments | `36ce8b81b2dc404f525a75aa38ccfd6db4ac9283faf24493391accdc11cd740f` | `7e78482404e00d569e1af6e7455f3c9e8e0e2c8724028e01c8b6a6ac6c1c6585` |
| Connectors | `1881106d36290a7622864a0ca7ec9c9ea837719bc03cfdbe3affc52cfcd9ced2` | `d8f9153da6967eab44b4b5eddba84ee87a0d1565124a9798347ad798d6713011` |
| Insights | `9b02cd52b2a1075a7e29a30aa23105326437e7ebc9b8dc1b863665594667288f` | `8a674e61da21b075a5179ba376a98a8fd493e498653fcaee477535dc58b104b5` |

CI integration follow-up: the fast Paper harness had classified the extracted
`useLibraryData` hook as a child-view placeholder, causing 11 identical type
errors. It now executes the real hook and uses the real `AppApiError`. The full
fast group passed **107 tests**, with **5 Linux-only tests skipped on macOS**;
Native dev tests passed **3/3**, and generated contracts passed. The Paper
workspace regression is included in the existing CI component step.

Master's new Viewer artifact browser test still used pre-migration button/native
Select semantics. Updated it to the shared Tabs/Select keyboard contract while
retaining value, focus, actual chart-axis and Gallery-selection assertions.
Production Viewer build/typecheck and all **8 artifact browser scenarios** passed
in Chrome with zero page errors. These follow-ups change test wiring and test
consumers, not App behavior. Remote CI results are tracked on the PR.

## Native visible-window follow-up (2026-11-06)

Source through `99615f15` adds the screenshot-driven Data import, Insights,
HPC navigation, shared Tabs focus and Native splitter fixes. The running macOS
arm64 preview was built from this worktree with nightly-2026-10-28, GPUI Kit
0.8.1 and GPUI Fast 0.1.12, using an isolated ephemeral-secret profile and the
normal product App list. Its executable SHA-256 is
`dee2e5880c8fc8f4febbd714a201e2ca737a3e7e5c45dce3b6a1d5aa307c1011`.
The all-11-App production build passed; the six affected Apps were rebuilt after
the final SDK Tabs change. This is a local development preview.

| Consumer | Screenshot-driven change | Observed in the running Native window |
| --- | --- | --- |
| Sidebar / Chat splitters | Keep composited WebViews painted; transparent deferred input overlay; capture release and apply its final coordinates before existing preference/checkpoint save | Sidebar 200→305→224px, Paper 224→320px, Chat 420→530→420px; App content visible after each gesture and Tabs usable after release. Restart restored 320px; a final drag restored 224px. Feedback is a 1px line within the 4px mouse target. |
| Data | One import action in the empty state; shared Dialog footer, file-first flow, type selection, optional metadata and bilingual import text | Chinese empty state and import Dialog show the file picker, readable labels and visible cancel/import footer. No file was imported in this Native pass. |
| Insights | Compact shared typography, one first-use task area, actionable translated credential failure; empty briefing Tabs omitted | The saved missing-credential state shows Settings → Models & Agent guidance and a normal-size retry action; clicking retry returns the same readable recovery state. No live Agent generation was performed. |
| HPC | Restore discoverability in the research sidebar, preserve enable/open ownership, shared CPU icon, AppBar and typography | HPC opens from the sidebar; Pi and OpenFOAM/Slurm methods and result Tabs render. Slurm correctly reports the missing environment and disables Run. |
| Shared Tabs | Focus outline inset inside the scrolling tab viewport | Browser geometry/keyboard regressions pass for ordinary and content Tabs at 14px/light and 24px/dark; this is not full Native keyboard acceptance. |

The current `compute_view.rs` has always been an empty reserved view in the
available Git history. HPC exposes the existing local benchmark library;
real Slurm submission/query/cancellation remains an implementation and acceptance
gap in `docs/fitness/hpc.md`. Generic Cloud Agent/Worker tasks remain in the
project task workspace. Restoring HPC navigation does not establish a working
cluster scheduler.

Validation on this source:

- Native `pero-ui --features native --lib`: **63/63**. The first run exposed an
  older research-asset test using 4KiB after the route moved to 64KiB; its boundary
  case now tests 64KiB+1. The production route was unchanged.
- Native executable build and Wasm `pero-ui` check passed; existing warnings
  remain. Root `npm run check` and affected Data/HPC/Insights typechecks passed.
- Data **17 browser + 8 UI** tests; Insights **6 browser + 4 model** tests;
  actual five-App frame suite **10/10**; shared Tabs **8 unit + 2 browser** tests;
  HPC navigation and UI semantics **1 each**. Tests include Data's actual Python
  backend and sandbox form footer/Enter, retained brief/recovery behavior and
  Tabs focus geometry with custom ring width.

Native screenshots uploaded to the PR:
[Data import](https://github.com/user-attachments/assets/a493ca01-35c9-421f-8203-c66943ce2138),
[Insights recovery](https://github.com/user-attachments/assets/ddf594bb-09e9-47a5-bb2c-570b563d33ce),
[HPC Slurm unavailable](https://github.com/user-attachments/assets/b41ba98f-17e5-47e4-b488-fc218f72e927),
[Chat splitter after release](https://github.com/user-attachments/assets/e1c65b9e-0db8-4ae5-b98f-e73cfd7b2d37).

The Native automation observes completed OS drag gestures and their resulting
frames. It does not sample a held slow drag frame by frame. Continuous drag
feedback, document pane/session splitters, Native dark/24px variants, other OSes,
physical IME, screen readers and real scientific/cluster execution were not
accepted in this pass. The PR remains draft.


## Empty states, Compute and Customize follow-up — 2026-11-06

Source: `4a781972` plus `42aab97b`, `40dca903`, `63f53a49` and `17a67bcc` on
`codex/desktop-design-system`. The Customize changes follow a separate read-only
review, “Review Pero Customize page usability”. No review chat modified source.

| Consumer | Shared migration and behavior |
| --- | --- |
| Paper / Data / Environments / Connectors / Insights / Compute | SDK EmptyIllustration for successful empty states; LoadingSkeleton only during actual initial requests. Same-query discovery and refresh failures retain available content. No fake metrics or job counts. |
| Compute | Separate App from HPC Benchmarks, shared controls and network identity, persistent non-secret cluster drafts, create/edit/select and recovery actions. Legacy saved Compute tabs/history migrate to compute/main. Scheduler and SSH operations remain unavailable. |
| Text input and content tabs | Shared inset 1px neutral text focus. Generated 13px content-tab text and 14px icons, 24px close target, flat selection and thin underline; Native and Web consumers use the same geometry contract. |
| Customize catalog | Public Tabs navigation variant, SearchField, Select, Button, Card and InfoTip replace competing raw button styles. No persistent snapshot timestamp. Titles wrap, built-in actions have real icons, full prerequisites remain visible before setup and retained results are identified after refresh failure. |
| Installed connections / installation | Paused means disabled in both counts and results; unverified connections appear under Needs attention instead of Ready. Installation previews the actual draft tool allowlist and effect groups, with unclassified effects explicit. Shared credential deletion requires a confirmation naming the reference and its effect on all sharing connections. Host authorization, allowlists, revisions and system secret storage are unchanged. |

Shared `TabsList variant="navigation"` has no outer border or full-width baseline,
uses shared spacing, medium-weight selected text and the standard 2px selected
underline, and wraps at narrow widths.
Tabs distinguish pointer selection from keyboard focus, including WebKit's
programmatic Radix focus. Page-local raw button/focus overrides and obsolete
GuideArt were removed; the production component catalog includes the variant.

Validation:

- Connectors: **45** Node tests, including actual snapshot polling, failed draft
  retention, count/result consistency, draft tool permissions and credential
  confirmation/cancellation. Actual five-App browser frames: **14** tests.
- Shared Tabs: **8 unit + 2 browser** tests. The final navigation refinement also
  passed the two actual Connectors frame scenarios at 1200px/light/14px and
  440px/dark/24px: readable long titles, no document overflow, no top/side tab
  borders, a 2px underline visible only on the selected tab, shared gap, pointer
  selection without outline, keyboard focus visible, and
  built-in Try it only composing the inspection prompt.
- Root generated/type/locale/icon checks passed (**972** messages, **84** icons).
  Connectors and catalog typechecks, component catalog build and all **12** App
  builds passed; Connectors was rebuilt after the final selected-underline
  refinement.
- Native executable build passed with 12 existing library warnings. The Native
  library tests on the earlier content-tab/Compute source passed **64 pero-ui +
  2 pero-theme**. Earlier Compute acceptance used its actual Python backend:
  **4 browser**, **3 backend**, **4 product** tests; shared text-focus browser
  tests: **2**. This catalog-only follow-up does not change the Native binary.

Actual macOS GPUI/WKWebView observations before the final catalog delta:
Paper/Data/Environments displayed the shared SVG empty family. Compute was
independent of HPC Benchmarks and saved an isolated “Preview cluster” draft for
`cluster.example.invalid`; jobs correctly remained unavailable. Customize's new
layout, wrapped service names, missing timestamp and spaced borderless navigation
were observed. Pointer switching then exposed a lingering focus outline; that
issue was fixed in the SDK and passed browser pointer/keyboard regressions.

After unlock, actual Native acceptance on `17a67bcc` superseded the earlier
lock-screen blocker. Catalog and installed views displayed the shared Card
surface and selected-tab underline. Pointer selection switched the view without
a focus rectangle; Left returned to the catalog with a visible inset keyboard
focus outline. After restart, Compute showed the saved “Preview cluster” selection
and correctly unavailable jobs. No real cluster, credentials, installation or
scheduler execution was attempted. Dark/24px screenshots here remain isolated
browser fixtures, not Native acceptance. The PR remains draft.

Final actual Native screenshots:
[catalog and selected underline](https://github.com/user-attachments/assets/484f822b-b826-46c2-b7e6-7a684567f2fb),
[installed view after pointer selection](https://github.com/user-attachments/assets/78a1499d-0ca0-483c-9fa2-997f0b8eea90),
[keyboard focus](https://github.com/user-attachments/assets/e032da6e-3133-43cc-8371-757ea1c527cc).

Screenshot artifacts for this pass live outside Git under the task's
`pero-native-followup/` and `customize-browser/` visualization folders. Published
PR screenshots distinguish actual Native observations from final browser frames.

## Paper and side chat controls — 2026-11-06

Paper library search now composes SearchField and named IconButton actions;
reader formats use the public single ToggleGroup. Obsolete outer search focus
and reader pressed skins were removed. Tabs and ToggleGroup share pointer versus
keyboard focus handling and an inset keyboard outline. Native chat combines
artifact navigation and dock close in one header; zero counts are hidden and
composer retry is a named icon action.

- Actual App browser suite: **16 passed**, including Paper at 1200px/light/14px
  and 600px/dark/24px. Search has one focus boundary, Clear does not submit,
  Enter submits once, reader selection stays exclusive, disabled choices are
  skipped and pointer/keyboard outlines remain distinct.
- Paper workspace tests **7**, shared Tabs tests **10**, Native chat-ui **25**
  and pero-ui **64** passed. Paper typecheck and production bundle, root checks,
  Native executable build and Wasm checks passed.
- Actual macOS GPUI/WKWebView: typed and cleared library search, opened the
  existing Harness-Zero paper, switched saved text/PDF with pointer and keyboard,
  observed one selected format and an unclipped keyboard outline. Artifact entry
  and dock close share one row, empty counts are absent in both views, closing
  the dock works while artifacts are open, and the composer remains bottom
  aligned with its icon retry action. Native was light theme; dark/24px remains
  browser evidence. No model request or scientific execution was performed.

Screenshots are outside Git in this task's `paper-chat-controls/` visualization
folder. Browser operation was disabled in Work settings during final acceptance,
so new screenshots could not be uploaded to GitHub; prior PR attachments remain.


## Native session navigation and App preparation — 2026-11-06

Source: the session follow-up on `codex/paper-chat-controls`, based on `2778f5e7`.
The final small delta removes 8px between the right status slot and the menu
without reducing the shared menu hit target; it was rebuilt and inspected in
the original Native preview profile. SessionRow is a GPUI component; no Web
SessionRow implementation is claimed. Sources and generated outputs now include
28px session-row and 14px status metrics.

- Shared compact rows replace the old interaction_row, empty leading slot and
  repeated running/attention labels. Regular titles align at the left, statuses
  align at the right, selection uses surface-muted, and project folders use
  stable palette accents. Menu and navigation remain independent controls.
- Actual macOS GPUI observations: light/dark state visibility, long-title
  ellipsis, hover/selected menu disclosure, Tab focus on an otherwise hidden
  nonselected-row menu, Enter opening without navigation and Escape closing.
  Search filtering/clear and expanded pagination were observed. Project plus
  switched the confirmed workspace before creating its draft.
- Session events were explicitly synthetic and injected into an isolated test
  profile; fixture commands never reached an Agent. Reading cleared unread
  while preserving the pending authorization icon and Allow/Reject controls.
  Unread is window-local; restored history is not implicitly unread.
- Controlled session_preparing → App completion → session_ready retained the
  thread, title and unsent composer text, removed the neutral waiting notice,
  and sent no prompt. This validates Native event handling, not an induced
  real App-store lock. Separately, original-profile startup with the real rebuilt
  Host showed no App-preparation error banner. Missing API credentials still
  produce their existing setup guidance. Host revalidates Apps/grants on resume.
- Native libraries: chat-ui **27**, theme **1**, UI **64**; Host **44** passed.
  Native UI/Host builds, Wasm chat-web/UI checks and root generated/type/locale/
  icon checks passed (**974** bilingual messages, **84** icons). The final
  spacing-only change was rebuilt and visually inspected; no new state tests
  were needed for that delta. Existing build warnings remain.

Actual captures are outside Git under this task's `session-list-followup/`:
`native-status-right.png`, `native-menu-keyboard-focus.png`,
`native-preparation-resumed.png`, `native-sessions-dark.png`,
`native-empty-no-environment-error.png`, `native-final-compact-status.png`.
The final spacing capture supersedes earlier spacing. Browser automation was
previously disabled during this task, so these are local Native captures, not
new GitHub image attachments. Earlier Paper/browser evidence above still applies
to those unchanged consumers.

The isolated large-font setting was changed to 24px, but its resulting session
view was not inspected before the user closed the preview. Native large-font
acceptance, physical IME, screen readers, other operating systems, real provider
requests and scientific execution remain unverified. The original preview
profile was restored for the final spacing check; synthetic sessions were never
added to it.
# PR #139 merge follow-up — 2026-11-06

Source: PR head `507a2d1` merged with `master` at `01ec7f0d`, plus the shared
ChatPanel completion dispatch and standalone regression in this follow-up.
The Composer conflict retains master's reconnect label and geometry probe with
the PR's named RotateCcw icon. App readiness recovery now lives in ChatPanel;
Workbench forwards events to it even when an App feature also consumes them.

- L0: root checks passed (984 bilingual messages, 85 shared icons). Native
  chat-ui 28/28 and UI 64/64, Host 44/44 and theme 1/1 passed. Standalone Chat
  Wasm build and Workbench Wasm check passed. Tabs/design/Product startup tests
  passed 25/25. Fast CI contracts passed 107, with five conditional skips.
- L1: actual hidden macOS Electron Product Chat passed all ten scenario checks
  with zero page errors. A controlled App-store rejection on a new App scope
  produced AwaitingApp; a completion event recovered the same thread, retained
  the unsent text and created no extra conversation or user message. Existing
  scope, cancellation, permission, dark theme, locale and narrow-window checks
  also passed. The Agent is the local ACP fixture; no real model was called.
- Captures: `test-results/product-chat/preparation-waiting.png` and
  `preparation-resumed.png`, plus `compact-light.png`, `embedded.png`,
  `permission-embedded.png`, `dark.png` and `narrow.png`. The preparation pair
  was inspected for retained Composer content. The standalone shell's existing
  Hide messages / Close chat labels overlap in this fixture; this follow-up
  changes event recovery, not that shell header's layout.
- This follow-up does not add new Native runtime visual acceptance, physical
  IME, screen-reader, other OS or signed-package evidence. Earlier Native
  evidence below retains its own source and scope.

