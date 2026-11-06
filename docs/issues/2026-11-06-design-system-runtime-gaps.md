---
kind: issue
status: in_progress
date: 2026-11-06
---

# Design system gaps in actual Desktop consumers

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
