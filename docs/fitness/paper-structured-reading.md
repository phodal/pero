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

## Final-head reconciliation and real-corpus gate (2026-11-01)

Audit base: merged `master@048dc578`; implementation head
`97d5cafff33d89f138cc099437126bbfb75fc8a8` in
[PR #90](https://github.com/phodal/pero/pull/90). Earlier pending statements above
record the state at those historical attempts, **not the current fixture gate**.
The PR's final reviewed-head record establishes successful
[full CI 41343538069](https://github.com/phodal/pero/actions/runs/41343538069) and
[ordinary CI 41343621354](https://github.com/phodal/pero/actions/runs/41343621354).
Its hash-verified
[reading artifact 13097429697](https://github.com/phodal/pero/actions/runs/41343538069/artifacts/13097429697)
records 164.797 seconds within 360, eight authored HTML checks and five PDF
checks, no errors. This final evidence supersedes the pending cached-scope GUI
statement: two approved scopes reuse immutable bytes without a new fetch, delayed
overview cannot attribute reads to the other scope, and typed/raw reports reopen
in the intended scope after restart. Numeric PDF zoom restart, padding-aware
wheel completion and exact/deferred navigation also executed. These are recorded
public final-head results, not fresh Desktop execution in this reconciliation.

| Issue #76 acceptance | Established evidence / remaining boundary |
| --- | --- |
| A: domain and native source | Immutable IR, raw bytes/digest, fixed response identity, manifests and conservative failure/partial states are covered by the product and deterministic tests. Live fixed-v2 parsing remains the D5 gate below. |
| B: product integration | Existing saved-paper Read/PDF, scoped original reveal, state/restart and shared store/Host paths are covered by the final-head Desktop record; no new UI is introduced here. |
| C: Agent/evidence | Typed windows, exact raw windows, scoped observations/reports and unchanged PDF quote boundaries are covered by the final-head record and tests. Figure metadata is not image observation; no scientific validation is inferred. |
| D1–D2: deterministic structure/fidelity | [Scientific document tests](../../apps/paper-agent/test/test_scientific_document.py) cover authored structure, exact cell strings, spans, units, reference targets, raw digest and hostile/limited input. Their real-looking arXiv URL is fixture identity, not evidence of a live paper run. |
| D3: existing suite/build/regressions | Final implementation-head CI is linked above. New helper verification is separately recorded below; it does not inherit a new-head full-CI pass. |
| D4: actual Desktop | Final-head authored-corpus L1 evidence supersedes earlier pending GUI statements; no L3 signed-package or all-platform claim. |
| D5: real `2606.03979v2` | **Open: acquisition could not complete in this executor.** Official HTML is available via the separate web reader; it must not be declared unavailable merely because this executor cannot acquire it. No source digest or real parse manifest has been produced. |
| D6: evidence boundaries | Local command/environment/results below distinguish fixture L0, prior Desktop L1 and incomplete live-service L2. The entire issue is not declared complete. |

### Explicit opt-in corpus probe

[Manual probe](../../apps/paper-agent/test/manual/scientific_html.py) calls the
existing `acquire_bounded` / `prepare_html` / `PublicMetadata` product owners for
exactly `https://arxiv.org/html/2606.03979v2`. Consent does not extend to images,
PDF, TeX, models or another version. It creates no second downloader or runtime.
The existing 45-second worker and 8 MiB source bound apply. Original HTML and IR
stay in an automatically removed private temporary directory; only an allowlisted
metadata/structural summary is written to the caller's output. On success that
summary freezes source URL/version/digest/size, parser manifest, block counts,
limitations and bounded-read coverage. It checks repeat parse identity and JSON
roundtrip, not semantic fidelity or scientific correctness. It does not claim
App consent, store/ledger or Desktop acceptance.

From repository root:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 apps/paper-agent/test/manual/scientific_html.py \
  --allow-official-html --output /tmp/pero-html-acceptance-result.json
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover \
  -s apps/paper-agent/test -p 'test_scientific*.py' -v
```

Observed on Linux x86_64 / Python 3.12.14, 2026-11-01 at
23:10:13.187839 UTC: `outcome=acquisition-not-completed`,
`acquisitionStatus=failed`, reason `Metadata request failed: gaierror`.
No original bytes, source digest, parsed document or model result were obtained.
One reviewed retry could not launch because the execution sandbox reported a
read-only-filesystem startup error; it did not reach the product transport. No
alternative downloader or permission workaround was used.

Separately, read-only web inspection at 23:08 UTC found both the official
[v2 abstract](https://arxiv.org/abs/2606.03979v2) and
[v2 HTML](https://arxiv.org/html/2606.03979v2) available and explicitly identifying
v2 dated 10 July 2026. That reader's representation is not original bytes and
cannot supply a product digest or substitute for the real parser regression.
The next required evidence is this opt-in probe succeeding in an authorized
executor with working official-site DNS/HTTPS, or a precisely recorded actual
source failure. This environment failure does not satisfy D5's source-unavailable
alternative.

Local deterministic verification: 19 scientific-document/probe tests passed,
including metadata-only projection, changed-byte/missing-structure refusal and
mandatory opt-in. Acceptance guards also execute under optimized Python (`-O`);
optimization cannot turn changed bytes or missing corpus structure into a pass.
Normal CI discovers only offline tests and never invokes the
manual network probe. No dependencies, workflow, timeout, UI or production code
changed in this increment.

Final local full Paper regression on this increment:
`PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s apps/paper-agent/test -v`
completed 210 tests in 58.320 seconds: 209 passed, one existing platform skip.
Local documentation links and `git diff --check` passed. This is L0 evidence;
it does not replace the still-blocked live acquisition or claim fresh Desktop CI.
