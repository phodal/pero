# Library PDF / TeX copies and the existing source owner

Status: implementation on `feat/paper-library-source-unification`, based on
`master@5c17ea45`. This is a narrow #75 / #79 integration, not closure of either
issue or of #76 / #77. No live network, model, scientific execution or user Mac
was used for this increment.

## Contract

`POST /api/papers/:paperId/files` is a Library UI endpoint, not a new Agent write
route. Empty legacy requests are rejected. Existing App-token authentication is
not presented as a native human approval or additional Host execution authority.

- `prepare` starts the real `ResearchImports.inspect` over the saved PDF source
  (or the original Library PDF URL when no PDF is saved). `draftId` polls that
  actual draft without downloading PDF/TeX. A ready response supplies the exact
  candidates, version/unknowns and a hash of the draft and current PDF identity.
- `confirm` requires that unchanged review hash, `pdf: true`, explicit `tex`, and
  `confirmedDownloads: true`. It calls the existing `ImportSelection` /
  `ResearchImports.commit` with only the selected PDF/source IDs. It does not
  synthesize a ready draft or infer old consent. Model/data/HTML are not selected.
- The UI starts, polls, cancels and retries existing `research-pdf` and
  `research-source` jobs. There is no Library job, new download receipt or new
  evidence ledger. Repeated same-version selections reuse existing grants/jobs.
- `export` reads the approved job receipts and verified original bytes. Download
  success never creates an observation; an actual source-read still does.

The original `PdfDownloads` receipt continues to name its byte-identity local-PDF
Paper and document. If the Library paper has no PDF, export creates a separate
`PdfDocument` association for the original Library paper using exactly the
receipt's original digest/pages/request URL. It does not rewrite either Paper,
receipt, annotation, study or report. A concurrently added different PDF causes
refusal rather than replacement. The association is reproducible through the
bundle/resource receipt and equal original digest, not title similarity.

An arXiv fixed-version association checks both receipt request and final URL.
An initially unversioned URL is fixed only by actual official metadata returned
during inspection. If metadata cannot establish a version, the original exact
PDF URL may still be acquired as a **file-level, version-unknown PDF-only**
resource. Non-arXiv exact-URL PDFs retain this PDF-only behavior. Later metadata
must not relabel those already saved bytes as a confirmed version.

Existing PDFs are never replaced. Unknown/conflicting saved versions and local
PDFs remain exportable without a network inspection, but have no automatic TeX
pairing. A cached PDF can select TeX only when an existing real PDF acquisition receipt
binds the same digest and available bytes, its recorded document has that digest,
and both request/final URL identify the same work **and** vN. An explicit URL
label alone is insufficient. The legacy default `_NoRedirect` refused redirects;
this is a limit of its persisted provenance, not a discovered historical
v1-to-v2 redirect-following vulnerability. No receipt is invented and no PDF is
automatically re-downloaded to manufacture this proof. A source receipt's request/final URL and recorded version are checked again
at export. PDF-only source responses remain `no-tex`, not source success.

Copies remain under the configured `PERO_PAPER_DIR` or `~/.pero/paper` default.
Same bytes reuse the copy; different bytes get a digest suffix without replacing
existing bytes. A temporary file is flushed and atomically linked into the final
name without overwrite; failed writes/publication remove staging. Unsupported
filesystem publication fails explicitly, never falls back to overwriting a copy.
Archive extensions reflect the actual saved format. Copies are not a ledger and
old `*-src.tar.gz` files are not retrospectively granted or imported as evidence.

## Scope limits

- The first shared PDF acquisition retains two legitimate identities: the
  original Library metadata Paper and the acquisition receipt's byte-identity
  local-PDF Paper. Repeated Save reuses the existing acquisition rather than
  creating more identities. Neither is deleted by digest: an existing local
  paper may own user annotations and reading history. The UI only distinguishes
  the PDF file type; this increment adds no global deduplication or relation ledger.
- `paper-live.mjs` was statically migrated to Save → Confirm → Export while
  retaining its fixed material, 37-page and model assertions. No real provider
  or model campaign was rerun. Until the actual Desktop/e2e entry succeeds, the
  migration is not L1 evidence.

- Cached pre-existing PDFs do not acquire a fabricated historical download
  receipt. Consequently a newly saved TeX source does not automatically make
  source/PDF comparison available for such PDFs: that existing feature requires
  its separately approved PDF acquisition receipt.
- Existing Agent `prepare-research`/legacy `/api/pdf` semantics are unchanged.
  The Library reader no longer silently invokes that legacy download when a
  newly added paper is opened; explicit Library saves use the review above.
- Existing source-report and scientific-document window ledgers remain separate
  from legacy PDF ResearchStudy passages and PC-Gym verification bindings. This
  change does not implement the broader cross-type Claim/Spec contract.
- No #97 driver/approval change, #11 work, scientific Run-once, models, credentials
  or public redistribution of source originals is included.

## Verification

The existing `test_library_files.py` exercises the real imports, source/PDF
acquisition workers, immutable store and loopback authenticated HTTP. Only the
metadata/download transport seam returns self-authored fixture bytes. It covers
explicit confirmation, reference-only refusal, same-version PDF/TeX, official
version freezing and unavailable metadata, non-arXiv PDF-only, stale reviews,
changed final URLs, preserved historical objects, restart, cancel/retry/failure,
source PDF-only responses, non-overwriting copies and injected publication
failure. Listing/saving produces zero observations; actual reading produces one.

Pinned local command (Python 3.12.14, Pillow 12.0.0, pypdfium2 5.0.0):

```sh
PYTHONDONTWRITEBYTECODE=1 /workspace/scratch/859e376748c6/pero-verification-5c17ea45-logs/venv/bin/python \
  -m unittest discover -s apps/paper-agent/test -v
```

Use the App's equivalent pinned environment outside this executor; the absolute
command above records the actual tested interpreter, not a portable install path.
The first full run exposed a test-fixture multiprocessing Event created with the
wrong context; it was corrected to the production spawn context. The corrected full rerun completed **223 tests in 63.079 seconds: 222 passed,
one existing Windows-only skip**. All 13 Library tests passed at that revision, including the
publication-failure regression. A subsequent provenance review tightened cached
TeX pairing to require an existing same-byte, same-version PDF receipt; its
additional tests and final full rerun are recorded below. `git diff --check` passed. Browser/native/live/scientific acceptance is not
inferred from these Python tests.

Final cached-provenance full rerun: **225 tests in 60.970 seconds, 224 passed and
one existing Windows-only skip**. All 15 Library cases passed, including actual
same-byte acquisition proof, URL-only legacy refusal, changed final version,
different digest/missing bytes, and export-side refusal even with a source grant.
Log: `/tmp/pero-library-python-tests-provenance.log` (local test output only).
A subsequent assertion exercises repeat Save through confirmation, cached source
acquisition and export, retaining exactly the same two Paper IDs. Focused rerun:
**15 tests passed in 6.030 seconds**; no production code changed after the full
225-test run. `git diff --check` remained clean.

## Existing identity reuse and compact warnings

A final real-owner regression first reproduced two failures: an unversioned
arXiv URL officially frozen to v3 and a later explicit v3 Library paper reused
the same bundle, whose original `seedUrl` was retained; both orderings failed
export's former literal-seed check. A PDF URL carrying a tracking parameter also
failed prepare polling because the existing inspector had already normalized it.
The red run recorded three errors across the two tests (two reuse orderings).

The Library boundary now consumes the existing `PublicURL` normalized value.
Bundle membership uses exact recorded resource identities/aliases; an unversioned
URL can use its existing real ready inspection's fixed PDF identity. Export does
not run another inspection or fetch. Specific selected resources and receipt
request/final version/digest checks still apply. Negative cases refuse another
version/work, unrecorded `www` or `.pdf` aliases and an uninspected latest URL;
there is no new canonicalizer or global identity framework.

The compact review projects uncertainty from the selected PDF/source candidates,
not general import warnings about missing datasets/models. Failed or unknown
versions, missing receipt proof and unavailable TeX remain visible.

Focused post-fix run: **18 tests passed in 8.510 seconds**. Original red log:
`/tmp/pero-library-identity-red.log`; focused green log:
`/tmp/pero-library-identity-focused.log`. Final full rerun follows.
Final locked-environment full suite after these identity fixes: **228 tests in
62.679 seconds, 227 passed and one existing Windows-only skip**. Log:
`/tmp/pero-library-python-tests-identity.log`. `git diff --check` passed.
Production code and tests were unchanged after this run; this is L0 evidence,
not a claim of a completed Desktop/live/provider/scientific run.
