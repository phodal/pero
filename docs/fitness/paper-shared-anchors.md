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

Actual Desktop execution/screenshots for this clipboard-fixture revision remain
pending the next exact-head full Desktop CI. Local recent Desktop attempts are blocked by the
launcher/Chromium IPC environment; an older build is not acceptance evidence for
these changes. No paid provider, external upload, new dependency installation or
Mac operation was performed.

## Not delivered here

No #76 parser/HTML reader, Read/PDF state persistence, HTML/PDF alignment, source
report schema replacement, or new execution authority is included. The merged #75
source-report ledger and image bridge remain unchanged. Unknown macros and unsupported
scientific formats are not interpreted. Source/HTML integration and real Desktop
acceptance remain explicit follow-on work; this record does not close #76/#79 or
claim the whole research lifecycle works.
