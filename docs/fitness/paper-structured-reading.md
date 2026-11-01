# Source-first scientific HTML reading (#76)

## Delivered boundary

A selected, fixed-version arXiv resource can receive independent `htmlIds`
download consent during bundle review. Empty HTML fields are omitted from old
canonical bundles. References-only saves fetch no HTML. Stable resource IDs do
not transfer consent to a different version or URL. Preparation derives the
exact official URL, rejects redirects, bounds raw bytes (8 MiB), and requires
actual response metadata establishing the requested work/version. A downloaded
PDF association additionally requires its request and final URLs to name that
same fixed work/version; this is not a claim of paragraph alignment.

The existing acquisition worker and HTTPS transport prepare an immutable
scientific document and original-byte receipt. Its identity includes original
SHA-256, parser revision/options/limits, metadata and structured blocks. The
parser revision is a declared release identifier, not implementation-code
attestation. Compatible stored IR is read as frozen data, not reparsed using a
newer implementation; changed IR or manifest yields a different document ID. An
existing historical receipt permits offline reading under current Host/App/project
read scope, not a new fetch or restoration. Current saved authorization is checked
before acquisition and again before publication. No revocable-read subsystem is
claimed. Changed source bytes or parser identity produce another document.

The functional parser retains headings/sections, tables with cell coordinates
and spans, equations with original LaTeX and safe MathML, figures as metadata,
references, code and footnotes. Bounded typed reads use explicit units and cursor
continuation; oversized indivisible content is marked omitted, not flattened or
silently truncated into apparent full evidence. `complete` describes returned
window coverage only; `parseStatus` and per-block limitations remain explicit
even when the same conversion error occurs in multiple blocks or table cells. Original HTML reveal is exact
inert text with source offsets. Unknown macros, conversion errors and unavailable
algorithm/theorem relationships stay explicit. No HTML scripts, iframe, image
fetch, OCR, model call, TeX compilation or new reader runtime is involved.

The existing PDFium reader remains mounted across Read/PDF switches; App-local
view state is keyed by exact PDF document ID and digest. PDF page, within-page
position, zoom and actual selection are retained. Explicit citations take
precedence over stored position. Scientific Read keeps its selected immutable
revision and scroll position; PDF/source search continues to reveal its actual
original representation.

## Reproducible checks

- `cd apps/paper-agent && PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s test -v`
- `npm --prefix apps/paper-agent run typecheck`
- `node --test scripts/build/apps.test.mjs`
- `node tests/e2e/paper-structured-reading.mjs` (built exact-head Desktop required)
- `node tests/e2e/paper-reading.mjs` runs HTML and PDF-only reading in the parallel
  `paper-reading` suite, using the existing workflow/artifact/Python/Chromium and
  unchanged 360-second budget. Import/clone/PDF-study/source-study stay in the
  research-import suite; executable wiring tests assert no omissions/duplicates
  and restore PDF-only mode on success or failure. No default network is added.

The self-authored corpus includes merged table headers, an empty logical table
row covered by rowspan, exact numeric/unit strings, MathML, figure metadata and
source-anchor references. Backend tests cover reference-only acquisition refusal,
version upgrade, conflicting response identities, current authorization changes,
redirected PDF association, receipt/write failure, immutable old reads, missing
originals and byte tampering. No external scientific acceptance is inferred.

Local verification: Python 172 tests, 171 passed and one platform skip; typecheck,
builder and CI contracts, Paper UI bundling and fixture syntax passed. Existing
source HTTP, PDF HTTP (real PDFium) and source CLI offline journeys also passed.
An independent final review passed 41 focused Python tests and four CI wiring tests, including raw-markup scope identity, exact short-window reopen, repeated and
ancestor conversion-error limitations; this is not GUI acceptance. An offline
transport smoke exercised actual approval, acquisition worker, PDFium, HTML
parser/store and typed reads. Desktop assertions were added but **not run locally**:
exact-head CI must establish GUI behavior, restart, source reveal, theme/narrow
layout and deferred-response behavior. No live arXiv or paid-model result is
claimed. A UI-only build with a supplied reader fixture is not a Rust-reader build.

## Shared evidence and explicit non-deliveries

Successful nonempty typed `read` and raw `source` record `documentScopes` through #75's existing
source observation/report owner. The scope freezes parse revision, original SHA,
block, returned window/unit and a fixed v1 digest projection of delivered IR;
UI flags and global warnings are excluded. Empty optional scopes are omitted
from canonical serialization, preserving old positive/negative observations.
Original HTML uses a distinct `original-html` character unit with empty block ID;
its hash covers actual delivered raw markup, not an invented IR block or scientific
understanding. Report reopen uses the exact recorded start/end window and returns
the same ID without growing the journal. Preparation, list/outline and trace do
not create an observation. Missing-only reads or failed ledger persistence return no ID.

Reports reopen through the same owner, including the bundle’s Saved evidence
entry when originals are unavailable, and export as evidence manifests, not full
HTML redistribution. Current availability rechecks exact bytes and typed windows;
a missing/corrupt original does not rewrite historical evidence. Current download
consent is required for any explicit restoration, and changed bytes cannot repair
an old report. Figures stay metadata-only/not_reviewed. No second ledger exists.

This implementation does not claim the entire #79 roadmap: no automated
HTML↔PDF semantic alignment, visual understanding from captions, generic
publisher parser, unsupported-format conversion, inferred formula semantics,
experiment/reproduction result, #77 result writeback or new execution/runtime is
delivered. Unsupported originals and ambiguous references remain available and
unresolved. Exact PDF quote validation remains unchanged.

## First exact-head Desktop attempt and corrective contracts

Full CI run 41322973475 (head f50268c8, tree 76ea99fd) did **not** pass
reading acceptance: Paper registration failed before opening the fixture, because
its 17 declared Agent routes exceeded the Host's 16-route manifest bound.
The Host now accepts at most 32 declarations, with the actual builtin Paper
manifest and unique 32/33-route boundaries tested at its existing parser owner.
Backend presence, unique names, local paths, schemas, total manifest bytes and
permission validation are unchanged. No old route is hidden or removed.

The refresh busy-state fixture holds the actual authenticated App-frame fetch
Response after its body arrives; Electron's custom protocol cannot use the former
Playwright routing gate. Requests/response identity, error propagation and cleanup
are tested offline. Neither correction is proof of successful Desktop acceptance;
the exact corrected revision must run both paper-reading and research-import.

Run 41325933358 (head f48ed300) verifies Paper registration and the independent
research-import aggregate (213.478 s), including real Desktop PDF/source studies.
The reading fixture reached typed structures, original windows and shared report
reopen, but refreshing identical bytes returned 409 before its PDF-only journey.
The immutable store correctly rejected Python tuple values against persisted JSON
lists. Preparation now retains the worker's JSON-native record after full existing
schema/hash validation; same-byte refresh reuses the document, receipt timestamp,
observation IDs and report without weakening immutable comparison or authorization.
Corrected full reading/Read-PDF restart acceptance remains pending new exact-head CI.

Run 41328180537 (head 782c720f) completes the authored HTML Desktop journey:
`paper-structured-reading/fixture/result.json` records explicit grants, typed and
raw report reopening, successful identical refresh, dark/narrow layout, Read/PDF
page and zoom preservation, real Desktop/backend restart, and evidence-only CLI
export with no errors. Artifact 13092602636 includes both reading screenshots.
This is offline authored-corpus acceptance, not live paper scientific acceptance.

The subsequent PDF-only journey exposes a separate saved-view initialization bug:
a numeric default zoom leaves EmbedPDF 2.15.1's initial viewport gate closed.
Paper now boots with FitPage and applies the saved numeric scale through the
existing restoration callback after layout; explicit citations still override
historical page/selection. The installed dependency lifecycle is covered in App
builder tests, and Desktop now requires a rendered PDF and positive viewport
geometry at the saved zoom after reopening before proceeding to exact search.
The entire corrected reading aggregate still needs new exact-head GUI acceptance.

### Cached documents across approved reviews

A cached immutable document can be associated with another independently approved
bundle/resource without a second HTML fetch. Preparation now uses one receipt
registration owner for both fresh and cached bytes, rechecking the requesting
bundle revision, fixed source URL and saved paper. Original document bytes and
existing receipts/observation IDs are not rewritten. The returned scope identifies
the requesting review, not whichever receipt was encountered first.

When multiple bundle/resource scopes exist, Agent reads must provide both IDs;
an omitted scope is an actionable ambiguity error. Single-scope calls remain
compatible. Read preserves the explicitly prepared/selected evidence bundle and
uses each report observation's resource when reopening. A pending overview cannot
fall back to a different scope or deliver raw text. Historical receipts still
allow offline saved-byte reads, but never authorize a new fetch/restore.

Offline tests cover two independent bundles, typed/raw observations and reports,
restart, unchanged originals/old reports, one HTML acquisition and denial of
unapproved acquisition or restore. The Desktop fixture additionally holds the real
second-scope overview response, checks zero cross-scope journal changes, and
reopens the selected second report after restart. This increment needs a new
exact-head GUI run; the earlier 62d3e743 success is prior-revision evidence only.
