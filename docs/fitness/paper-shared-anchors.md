# Shared PDF locations (#66)

## Scope

This increment extends the existing PDFium/EmbedPDF reader, not a new reader or
Agent runtime. PDF passage answers already had exact-region reveal on the base.
Library PDF search now resolves the returned hit's actual character window, not
the search query or a guessed paragraph. `/api/pdf/locate` accepts a saved
`documentId`, `fileDigest`, page and exclusive `start/end` (maximum 4,800
characters). It checks the fixed original and proves the PDFium text position
before returning normalized unrotated, top-left rectangles.

`PdfAnchor` is a shared version/page/region value. Its ID excludes annotation
notes and discussion content; identical supplied regions have identical IDs.
A selected region is not proof of scientific support or a semantic paragraph.
A page-only discussion preserves its original digest but makes no region claim.
Annotations and selected-context records retain the anchor; legacy records
without it still load without inventing geometry. Saved answer discussions can
reveal their selected region from the existing research record.

Repeated exact quotes within an observed passage return explicit candidate
regions instead of choosing the first. The response exposes the total count and
at most 64 candidates; the UI asks for a longer quote when more remain. Legacy
non-passage evidence keeps matching-page candidates, visibly labelled as
page-text-match only. Existing observed-PDF and exact-quote admission rules are
unchanged. A context anchor does not make the context observed report evidence.

## Verification

On Linux with the project's existing Python/PDFium/Pillow and frontend dependencies:

```sh
cd apps/paper-agent
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s test -v
npm run typecheck
```

- Backend suite: 128 tests, 127 passed, one pre-existing Windows-only lifecycle
  test skipped. Additional authenticated duplicate-citation assertions were also
  rerun in `test_http.py` (2 passed).
- Real PDFium tests use tiny self-authored PDF bytes: repeated text on the same
  page, rotated page, overlapping `ana` occurrences in `banana banana`, version
  mismatch, invalid offsets, restart, old records, and shared annotation/context
  region identity. These are software fixtures, not scientific evidence.
- Authenticated loopback HTTP verifies exact locate, bad digest rejection,
  selected context persistence, page-only fallback and ambiguous citations.
- Paper TypeScript check and JavaScript syntax checks passed.
- The integrated source-report/shared-anchor revision passes 137 backend tests
  (136 passed, one Windows-only skip). Annotation validation now belongs only to
  `PdfAnchor`; annotation-specific kind/figure-count rules reuse its typed value.
  Same-page evidence candidates share one original-byte verification and one
  PDFium document/page/textpage session. Real repeated/overlapping text on both
  rotations verifies distinct locations and single/batch agreement; instrumentation
  confirms one original hash and document open for a 16-window batch. HTTP checks
  retain the 65-total/64-returned candidate cap and reject changed or missing bytes.
- `paper-search-flow.mjs` now requires a visible actual search-hit region;
  `paper-pdf-flow.mjs` captures the real selection-context response and requires
  its anchor identity to equal the later saved highlight's identity.
- Deferred-response Desktop regression holds the actual `/api/pdf/locate`
  response, manually changes page or switches to Text, then releases the response
  and checks that the newer user navigation survives. It also checks that a
  subsequent explicit search can still reveal its region. There is no timed
  network delay; response completion and render frames are awaited. Reader
  pointer, keyboard, wheel, change and assistive click input invalidate the
  pending search epoch, including input in the existing portal toolbar.

The first full CI run for PR #88 did not execute these shared-reader assertions:
`paper-agent.mjs` was absent from the Paper aggregate. That green run is not
shared-anchor GUI acceptance. The existing `paper-research-import-all.mjs` now
also runs `paper-agent.mjs` in its existing PDF-only mode, retaining selection,
shared context/annotation identity, exact search, deferred navigation and restart
checks while skipping the unrelated discovery tour. This mode uses authored PDF
bytes and the scripted ACP agent by default. Each Desktop fixture closes its
owned app/profile; the aggregate restores its temporary mode setting in finally.
The CI wiring test executes this aggregate with only Desktop entries stubbed and
requires the reader entry and scoped mode, preventing another silent omission.
No workflow, runner or 360-second acceptance timeout was added or changed.

Full CI run `41320298054` (PR head `95cbe893`, tested merge `759b39db`)
reached the PDF-only reader: selected context/annotation identity, highlight and
figure capture passed before its clipboard-backup fixture rejected an empty-MIME
native clipboard item. The aggregate failed after 141.883 seconds, not its
360-second deadline. All four earlier sub-suite results had no errors. Search,
deferred navigation and reader restart were not reached; this is partial evidence,
not complete shared-anchor GUI acceptance. The fixture now ignores empty native
placeholders when preserving the clipboard, while retaining every advertised
format, the real image-copy assertion and finally restoration. An offline test
executes that same callback for empty and populated clipboard cases.

The next run `41322451027` (head `3d829967`, tested merge `c7c8795f`)
passed the clipboard/matrix path and the actual normal search-region assertion
(`local-search-pdf.png`), then the Playwright route-based deferred-response gate
never completed and the aggregate reached its unchanged 360-second deadline.
This still does not certify deferred navigation or reader restart. The gate now
runs at the App frame's actual fetch boundary, rather than relying on interception
of Electron's custom `pero-app` protocol. It forwards the request unchanged,
awaits the real response bytes, holds that same Response until the newer user
navigation, and checks delivery and the existing page/Text/new-search assertions.
Bounded readiness reports errors instead of leaving an unbounded promise; separate
page/Text screenshots identify the last completed stage. Offline tests cover real
Response identity, unchanged requests, unrelated fetches, failure and restoration.

Run `41324972140` (head `f9ffbeb6`, tested merge `e81a15f0`) failed
earlier, at the first Ask/close gesture: the old fixture reconstructed Chat's
close coordinate from composer rows and attachment count, while those values and
the painted panel can settle at different times. Its failure screenshot retained
the PDF selection and an open compact Chat; no Agent turn ran. The fetch gate was
not reached, so that run does not invalidate or certify deferred navigation.
The existing read-only GPUI ViewBounds now exposes the painted floating close
button, clearing it with other workbench probes each render. The fixture requires
a stable two-frame canvas hit target, clicks once, and verifies both closed state
and null old bounds. No internal close action, forced click or timeout increase
is used. CI-runner tests pass 13/13; independent focused review/tests pass 5/5.
Local native UI compilation was attempted offline with cached GPUI paths but is
blocked by missing `atk v0.18.2`; no dependency was downloaded. Actual Rust/UI
build and the complete reader journey remain pending exact-head CI.

Actual Desktop execution/screenshots for this painted-close revision remain
pending the next exact-head full Desktop CI. Local recent Desktop attempts are blocked by the
launcher/Chromium IPC environment; an older build is not acceptance evidence for
these changes. No paid provider, external upload, new dependency installation or
Mac operation was performed.

## Exact-head GUI evidence and polling correction

Published `cb54a57b87fc75282621c1802835c26435a35d37` completed full
[CI 41327799875](https://github.com/phodal/pero/actions/runs/41327799875)
successfully. Paper Desktop job `124913057478` passed in 314489 ms, within the
unchanged 360-second budget. Artifact `13092148701` contains the PDF-only result
with no errors, exact page-2 search highlight, both deferred-navigation screenshots,
answer citation and reopened conversation. These are fixture PDF/Host results,
not paid-model or downloaded-paper acceptance.

Review then identified a latent retry bug despite that passing run: installed
Playwright 1.64.1 checks `waitForFunction` predicate truthiness before awaiting its
Promise. The close fixture now uses `expect.poll` to await each two-frame paint
probe, retaining the 5000 ms bound and one real click. Offline regression covers
false/false/stable samples and permanently missing bounds failing without a click.
This polling correction still requires its own exact-head Desktop CI.

## Reopened Ask handoff readiness

The next exact-head run, `41330309722` at `2963af4d123cdecdab19af17cecf84541dcf08e8`,
failed after 307897 ms in `reopenPdf`: the close pointer click did not close Chat.
Artifact `13093596969` confirms normal search, both deferred actions and answer
citation completed, but restart acceptance did not finish. The final snapshot has
one attached reference and open Chat; it lacks the original click target, so it
does not prove whether that target moved or the event was unconsumed.

Source inspection confirms `appChatLauncher` opens Chat before awaiting the
context command; reference insertion happens later in ChatPanel rendering. The
reopened fixture previously clicked Ask and immediately selected close geometry.
It now observes the actual request ID and matching Host acknowledgement, then
waits for those exact reference IDs to have painted Host preview bounds before
selecting the stable close target. Source/origin checks and observer cleanup are
retained. Safe test logs record only request/reference IDs, pointer bounds and
open/closed flags. Offline contracts cover open-before-attach, unrelated replies,
source/origin rejection and bounded failure. No production API, retry click,
arbitrary delay or suite timeout was added; exact-head GUI confirmation is pending.

## Not delivered here

No #76 parser/HTML reader, Read/PDF state persistence, HTML/PDF alignment, source
report schema replacement, or new execution authority is included. The merged #75
source-report ledger and image bridge remain unchanged. Unknown macros and unsupported
scientific formats are not interpreted. Source/HTML integration and real Desktop
acceptance remain explicit follow-on work; this record does not close #76/#79 or
claim the whole research lifecycle works.
