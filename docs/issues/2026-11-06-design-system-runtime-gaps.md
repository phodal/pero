---
kind: issue
status: in_progress
date: 2026-11-06
---

# Design system gaps in actual Desktop consumers

## 2026-11-11 repair delivery — current status

The initial audit's eight defects now have implementation fixes. Paper's
autonomous-research workspace has been redesigned around question, starting
papers and scope, followed by saved-plan actions, records and evidence. Its
draft stays mounted across library navigation; read-only history and paging no
longer depend on Agent admission; loaded data, requests and errors are distinct.
Ordinary controls and typography use the public SDK. Saving remains separate
from launching an Agent.

Notebook Insert/Format/View/File/Help now share Popover behavior with explicit
retained mounting for scientific tools and dialogs. Native App failures are
scoped to App/panel and catalog errors do not mask retained pages. Notebook's
App icon registry entry is generated, and Composer uses input-border with the
neutral text-input focus line. Fixed Notebook control heights, Reader/Diff
typography and Sidebar/Chat default-size restoration have also been adjusted.

Actual rebuilt Native observations confirm all four Paper protocol fields and
the seed selection survive library navigation, saving does not launch an
Agent, Notebook Insert Escape closes and returns focus, and Notebook/Paper
remain usable at UI size 24. Paper's save area is reachable at that size and
its dark theme was inspected. The [two-stage verification report](../fitness/2026-11-11-design-principles-audit.md)
preserves the original findings and records the replacement components,
behavior boundaries, current screenshots and test results. The intermediate
saved-plan screenshot 05 is excluded from final layout evidence.

Native sidebar resize/reset was also observed: drag 260→340 then double-click
restored 260; drag 260→300 then Enter restored 260, confirmed by AX. This does
not establish Chat-split, restart or narrow-window preference acceptance.

Paper tests pass 18/18, Notebook/SDK related checks pass 20/20, prepared-source
extraction recheck passes 1/1, root checks and all 15 App bundles pass, and the
Native build plus 32 related tests pass. The unrelated Ctrl+Shift+S test
assertion still fails identically on the original baseline; this is not a
claim that all 84 Notebook editor checks are green.

This canonical tracker remains `in_progress`: Reader/Diff large-font visuals,
actual Native failure injection, VoiceOver, physical IME and the full 15-App
state matrix remain unverified. The earlier Lab Popover/heatmap scope is also
still open; Notebook's accepted Escape path does not replace those checks.

## 2026-11-11 initial audit — historical findings

The product now contains 15 Apps. The [current verification report](../fitness/2026-11-11-design-principles-audit.md)
consolidates the existing principles and records current-source evidence on
`7607c741`: real Native Paper navigation loses an unsaved research draft, and
browser Notebook Insert remains open after Escape. Production React checks
also reproduce saved-report paging depending on Agent configuration and a
failed initial read displaying the successful-empty guidance. Static review
finds a global Native App error masking retained pages, the missing Notebook
App icon mapping, Composer boundary contrast below the design target, and
private Paper program controls/typography. Those were open at this initial-audit
stage, which implemented no fixes and did not close the earlier Native
Popover/heatmap scope. The repair delivery above supersedes this implementation status.

## What and scope

The requested Native font/experience review began on `62d00480` with no tracked
changes. The user subsequently requested that the full design system be applied.
The shipping scope is the 12 Apps in `products/pero.json`, their shared SDK, and
the Native workbench. The unrelated, untracked `apps/cobol-modernization` is not
part of this product or this change.

Actual macOS Native observations at UI sizes 14, 18 and 24 confirmed readable
system fonts and live propagation to Lab. However, opening the sidebar Settings
menu hid the entire loaded App. This is a remaining caller classification gap in
the [existing Native menu incident](2026-10-31-native-connector-menu-blank.md):
composited popups already have the correct visibility rule, but Settings and the
tab switcher are passed as full-window overlays.

Source inventory also found incomplete migrations: Automations still uses its
own ordinary buttons, inputs and fixed typography; EnvironmentBrowser's error
boundary uses an unstyled native button; several Paper/Viewer/Virtual Cell
interface labels and toolbar controls use fixed pixel font sizes. These bypass
the user's font preferences despite shared components being present elsewhere.

## Migration and preserved behavior

| Previous | Replacement | Consumers and preservation |
| --- | --- | --- |
| Settings/tab menus classified as full overlay | Existing composited popup coverage rule | Native retains loaded App; above-workbench renderers keep their coverage policy; real dialogs and spotlight retain full coverage |
| Automations page-local controls and skin | Public SDK controls, feedback, empty state and shared typography | Preserve Host scheduling, action conditions, drafts, search and editor values |
| Raw error-boundary reload control | SDK Button and Feedback | Preserve explicit reload and error message |
| Fixed interface font sizes/heights | Purpose-specific shared UI/caption/heading/code tokens and growing controls | Preserve reading content, scientific figures and miniature document previews |

Evidence is saved in `test-results/ux-review-2026-11-06/`. Screen locking interrupted
the initial run twice; only observed screenshots and completed checks count as
acceptance. Native, browser, automated and unverified scope will be reported
separately in the final review.

## Optimization delivery and remaining acceptance

The first optimization batch fixes the menu coverage classification, migrates
Automations and the EnvironmentBrowser boundary to public controls, replaces
interface typography overrides, and improves LibraryHeader wrapping, Lab plate
scaling and Virtual Cell bar-label layout. Scheduling and scientific domain
rules remain in their existing owners.

See the [detailed runtime review](../fitness/2026-11-06-design-system-runtime-review.md)
for the 12-App coverage matrix, completed checks and screenshot evidence.
This tracker stays in progress: full Native keyboard/VoiceOver/physical IME
acceptance and deeper Paper/Viewer states remain unverified. Virtual Cell's
scientific heatmap's first review found clipped long axis labels; the follow-up
fix below has browser evidence but still needs Native acceptance. Mixed-language
App UI also remains visible. Do not equate the successful first batch with complete
product-wide design-system acceptance.

## Follow-up public control migration

The next batch replaces raw comparison checkboxes in HPC with SDK Checkbox,
Virtual Cell's raw volume range input with SDK Slider, Paper's numeric PDF page
and read-only policy fields with SDK Input, and Insights/Virtual Cell error
boundaries with LibraryHeader, Feedback and Button. Preserve comparison limits
(completed runs only, at most eight), numeric bounds/steps, page navigation and
explicit reload behavior. Scientific hit targets and document content retain
their domain semantics. Insights' legacy recap stylesheet is not imported by the
current entry; it is not treated as a confirmed current-page typography defect.


## Follow-up heatmap layout and verification

Virtual Cell now consumes SDK Slider without its old private accent/focus skin.
The heatmap's fixed 125-unit label gutter and 720-unit compressed drawing become
measured row-label space, readable row heights and a caption-scaled minimum
canvas with a named, focusable horizontal scroll region. Preserve cell values,
colour normalization, selected IDs, tooltips and export data. Long identifiers
retain full text in titles. This is scientific drawing layout, not a change to
the atlas or comparison domain.

The actual Cell bundle was checked in a browser Host-context fixture at dark24,
default and 420px widths. Long labels fit; whole-page width remains 420px; keyboard
scroll exposes additional columns; opacity changes 0.55→0.56 with ArrowRight.
The fixture has no backend (visible API 404), so no execution acceptance is
inferred. HPC/Cell UI tests, four Apps' type checks/builds and root check pass.
See the detailed review for screenshots and exact limitations. Native remained
locked, so the tracker stays in_progress pending the existing acceptance scope.


## Data and Paper ordinary action migration

Data's table-header sort action and saved-chart opener still bypassed the public
Button. Replace both with SDK ghost Button and remove their private control
background/border/hover skin; retain sort toggles, aria-sort, disabled states,
chart identity and opening behavior. Long chart labels wrap within their row.

Paper Discover's add-by-link, retry, title disclosure, saved-paper opener and
add-to-library actions become SDK Button (secondary, ghost and link by purpose).
Remove the matching private skins and let filters wrap when enlarged. Preserve
search IME handling, retained results, query/source/sort, per-hit busy/error
state, details disclosure and already-saved paper navigation. This follow-up
does not move search, acquisition or reading state into the component library.


## Paper reading action migration

Structured/HTML/saved-text outlines and source-line preview now use ghost Button;
scientific inline citations use link Button. Shared focus/hover/disabled behavior
replaces private skins. Preserve current section, outline levels, reader reveal,
source coordinates, citation resolution, and content typography. Citation actions
remain inline within scientific prose rather than acquiring toolbar geometry.

Evidence-matrix source/citation actions also use link Button and editable cells
use ghost Button. Preserve correction drafts, evidence IDs, aria-expanded and
return focus to the original cell after closing the editor.

Paper library preview and related-paper title actions now use ghost Button.
Preserve single-click preview, double-click reading, aria-pressed selection and
abstract-dependent disabled state. Remove their competing private control skin.


## Scientific selection surfaces

Lab wells and Viewer molecule selectors use ghost Button, retaining plate
coordinates, volume fill, selection and image geometry. Viewer artifact
listbox options use Button's unstyled foundation because their file/tile
layout, roving focus, selected thumbnails and double-click quick look are
specialized selection surfaces; preserve those semantics and domain layout.
No execution or scientific model logic changes.


## Semantic source tables

Extend SDK Table with a children form sharing the data-driven Table's named,
focusable scroll surface and skin. Real Data sorting/selection and Paper source
row/column spans require semantic markup; these remain owned by consumers.
The children form uses intrinsic column sizing. No table sorting/selection
state moves into the SDK and the existing data-driven contract is preserved.

Data adopts the semantic Table for records, field profiles, duplicate records,
interpretation previews and chart source rows. Preserve original row numbers,
aria-sort/aria-selected, selection limits, exact decimal values and sticky
headers. All five tables gain named keyboard-focusable scroll regions; remove
Data's duplicate cell padding/header skin.

HPC verification/artifacts/runs/comparison, Lab protocol/criteria/checks/trial
comparison and Viewer numeric preview now use semantic Table. Preserve row IDs,
run selection limits, cell editing, protocol colgroups, source pagination and
comparison denominators. HPC ordinary links/benchmark choices use link/ghost
Button instead of unstyled controls; remove duplicate skins.

Paper comparison, evidence/reading matrices, reproduction counts, Markdown and
structured source tables now use semantic Table. Keep source caption, rowspan/
colspan, original values, missing denominators, citations and editing intact.
Scientific prose tables inherit document typography; interface matrices use the
shared typography. Remove private generic cell/header skins.


Paper research inspection/download and Cell dataset download/verification use
SDK Progress. Keep unknown inspection progress indeterminate and byte counts/
expected totals unchanged; remove private progress colour/height overrides.


Connectors setup/docs/manual-config and detail-title links use link Button;
setup feedback uses the shared inline/block presentation rather than unstyled
private notice/error skins. Preserve connector state mapping, validation and
installation actions. Control Lab check rows use ghost Button with aria-pressed
for the focused scientific check; retain grid content and concept selection.

The legacy Insights recap also uses SDK Button and maps its old fixed colour/
font variables to purpose-specific Pero tokens. Remove private button/focus
skins. Current homepage does not mount this legacy module, so this is source
coverage rather than an observed production homepage defect.

Feedback's paragraph root could not contain the existing nested diagnostics
(details/pre/div). Use a div root with the same roles and styles so recovery
controls and diagnostic content remain inside the alert after HTML parsing.
A regression test exercises that actual markup boundary.


## Shared disclosure migration

Ordinary source details, logs, history and diagnostics now use SDK Disclosure.
Add an inline variant for these compact metadata actions; keep the existing
block default for established callers. Preserve native details, mounted drafts,
refs, current summary names, controlled open callbacks and initially-open panels.
Keep nontrivial auto-opening panels explicit until their existing state owner
is migrated; do not accidentally make a user-toggleable panel permanently open.

All 89 former native details controls are now shared Disclosure (88) or, for
Lab's floating simulation explanation, Popover. Auto-open install failures,
Feishu configuration/error reveal and reproduction setup remain explicit local
UI states, preserving user toggles; Lab rationale keeps its parent-keyed initial
open state. Remove duplicate chevrons and matching summary skins.
Control Lab's existing SDK core import needed allowJs for its runtime JS path
to participate in TypeScript resolution; typecheck and all 46 UI tests pass.


## Final delivery evidence

The 12 shipping Apps have no raw button/input/textarea/select/table/progress/details
in their ui-src TSX. Final SDK tests pass 161/161; affected App checks and all 12
production bundles pass. Actual Data sorting/selection, Paper shared disclosure,
and Native Lab shared Popover are captured in evidence 52–54. Native Cell long
labels are confirmed in evidence 51. The detailed report records fixture boundaries.

The implementation migration is delivered, while this tracker remains in_progress
for unverified Native keyboard, VoiceOver, physical IME and full state coverage.
Native Escape did not visibly close the Lab Popover; horizontal heatmap access
was not observed. A later concurrent Native restart remained at App opening on
last observation; no cause is asserted. Temporary theme/font restoration remains
unverified. These observations do not invalidate the completed screenshots, and
passing source inventory/build alone does not close product acceptance.

## Environment creation follow-up

The PR #151 visual revision reused library controls but did not complete the
DESIGN-REVIEW acceptance: promotional and repeated content remained, page CSS
reached into radio internals, and font/refusal recovery were omitted. Review also
found that cancelling and reopening creation cleared the name, and a create
refusal incorrectly offered a list refresh. These are actual workflow gaps,
not new environment-domain rules.

Corrected in `bab57286` / `f0e55001`: compact single-column creation, shared radio
marker layout, retained drafts, contextual refusal and public log Disclosure.
The expanded real Electron check covers Host validation refusal, font changes,
keyboard and binding recovery. Evidence and remaining Native/renderer/state
coverage are scoped in [local preparation](../fitness/local-environment-preparation.md#2026-11-06-review-against-design-and-design-review).
This closes this follow-up's code corrections, not the other active items in
this canonical design-system tracker.

## Pointer-opened Popover keyboard focus

Native follow-up reproduced the Escape failure while Tab successfully advanced
focus and dismissed the popup. The shared Popover listens for Escape within its
trigger/content boundary, while browsers may leave a pointer-activated button unfocused.
Explicitly focus the trigger on activation so a mouse-opened popup receives the
next Escape/Tab. Menu content still receives its existing initial menu focus.
A regression drives pointer activation, then Escape from the actual active
node, without manually focusing the trigger; it fails before the change.

Final follow-up: SDK tests pass 162/162, SDK typecheck and all 12 production
bundles pass. Native Lab was reopened with the rebuilt bundle; Escape still did
not visibly dismiss the popup, despite the corrected activation focus contract.
The Native event/focus route is therefore not accepted or attributed to a proven
root cause. Native heatmap horizontal movement also remains unverified. Evidence
55 records the remaining Escape observation. The user requested wrap-up; no
further Native routing changes are included in this delivery.
