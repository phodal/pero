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
scientific heatmap still clips long axis labels; mixed-language App UI also
remains visible. Do not equate the successful first batch with complete
product-wide design-system acceptance.
