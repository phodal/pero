---
kind: verification_report
date: 2026-11-06
---

# Design system interaction regressions

## Source and scope

Prepared against `phodal/pero` master
`01ec7f0d7edcbded4a214b91b56d99cd93c261e0` (after #141).
This follow-up changes the Web Select, Web Sidebar and Control Lab request
presentation. It does not modify Native navigation, domain verdicts, Host
permissions or scientific execution.

## Findings and changes

- Select treated IME candidate keys as menu navigation/selection. Its existing
  keyboard boundary now recognizes composition events, native `isComposing`
  and key code 229. Native default handling is retained, while composition
  events do not escape into a surrounding Dialog. Ordinary Escape still closes
  the Select before the Dialog.
- Sidebar collapse CSS grouped row labels/counts with divider styling; another
  rule hid group titles even when expanded. Titles now name their groups and
  show when expanded. False/empty lead values retain the text-only fallback.
  Collapsed icon rows retain accessible names without
  visible label/count artifacts; text-only rows retain their text. The catalog
  uses a labeled group and count to exercise the public contract.
- Same-object Control Lab refresh and polling responses could arrive out of
  order. Shared request identity prevents older success/failure from replacing
  newer evidence, and confirmed mutations invalidate older reads. Object
  navigation clears the previous object's evidence while loading the new one.
  Transient refresh failures still retain drafts/evidence with a warning;
  GET and POST 401/403/404/410 responses remove unavailable evidence. Opening
  and mutation progress have separate owners, so refresh completion cannot
  enable conflicting controls while a POST is pending. Recovery retries the intended
  object. App semantic state now includes refresh progress and failure.

No token source or generated token changed. Sidebar spacing and typography
continue to consume the existing shared tokens. README and catalog examples
were updated with the Sidebar contract.

## Verification

- Complete SDK test suite, including Select composition and Sidebar behavior.
- Control Lab UI/presentation suite, including deferred-response ordering,
  polling/cancellation overlap, unavailable-object recovery and the existing
  retained draft/focus regression.
- SDK, Control Lab and design catalog typechecks.
- Design catalog production build; existing third-party `use client` and
  bundle-size warnings remain non-fatal.
- Existing design token geometry/material/contrast tests, both palettes.

Final automated counts: SDK **159 passed**, Control Lab **46 passed**, and
token/contrast **3 passed**, with zero failures or skips. Browser regression code is provided at
`packages/app-sdk/test/sidebar-browser.mjs`. Browser acceptance is **not**
complete: Playwright's bundled browser was unavailable; installed system
Chromium aborted before opening the loopback fixture with `socket() failed:
Operation not permitted` and `ptrace: Operation not permitted`, including an
approved elevated launch. No screenshot was generated. No real OS IME,
Native desktop, signed package, backend solver or full root aggregate acceptance
is claimed.

## Parallel changes

Open #139 was checked at `0312562bd38c5d68878cc7d79d58a26c8d572880`.
Its code changes do not overlap these implementation files. Both touch the
component README, so retain both documentation changes during integration.
This follow-up does not alter or resolve #139.
