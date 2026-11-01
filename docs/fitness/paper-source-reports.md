# Source evidence reports

## Delivered scope

A successful source `read`, `image`, or `compare` operation records an immutable,
server-issued observation ID. Listing an archive and downloading it do not record
reading. Text observations bind the archive/member SHA and the exact returned
character/line window; table source is literal text, not a reconstructed scientific
table. Image observations bind original/preview hashes and say `not_reviewed`:
preview delivery cannot establish that a human or model saw or understood it.
Comparison observations preserve actual literal source/PDF offsets and exact file
identities, or explicitly remain unresolved. Figure numbers alone are not matches.

`research-source-report` / CLI `source-report` can select only recorded IDs from the
same approved bundle. Create cannot accept caller-supplied read scopes, verdicts or
image-review assertions. Optional interpretations are always unresolved. Read
rechecks original availability independently of frozen historical evidence; reports
survive restart and exact-byte restoration without changing their identities.
The existing research export includes these location/hash manifests, not original
members, image payloads or paper quotations.

These App operations use the existing declared App-write route and persisted source
selection, not new download or execution authority. The Skill requires a user
request to save a report. Read observations record tool delivery, not independent
human consent or proof of model attention. The journal retains the existing bounded
record budget: if full or unavailable, reading still succeeds with a warning and
without a reportable ID; existing evidence is not silently pruned.

The existing source browser adds a compact report selection/list, unresolved notes,
and version-checked links back to source windows or matched PDF pages. No new
reader, model backend, scheduler, compiler or research execution framework is added.

## Verification

- Backend suite: 132 tests run, OK (131 passed; one Windows-only lifecycle test skipped on Linux).
  New report tests cover observed-only references, cross-bundle rejection,
  immutable/idempotent exact-window reopening (including partial-line character windows), image interpretation boundaries, exact PDF
  comparison scopes, original loss/tampering/restoration, and journal-capacity failure.
- `tests/e2e/paper-source-http.py`: authenticated same-core report creation/reopening;
  fabricated observation IDs rejected. Synthetic transport only.
- `tests/e2e/paper-source-cli.py`: actual JSON CLI report creation, evidence-only
  export and reopening in a separate process. Synthetic transport only.
- Desktop App Use/asset bridge: 14 tests passed, including actual text-plus-image
  MCP responses, optional observation ID/warning validation, legacy compatibility,
  and no base64 image leakage into text metadata.
- Paper UI TypeScript check passed. Desktop source-study fixture assertions are
  extended for report save/reopen and interpretation boundaries; this local browser
  execution was blocked by the environment's IPC/process launcher. Those new UI
  assertions remain pending an actual Desktop acceptance run; compilation alone
  does not establish UI acceptance.
- Independent actual CLI verification against a private copy of authentic Epitope
  source bytes passed two source windows, image delivery, unresolved PDF comparison,
  report creation, duplicate creation, process restart, export and exact-byte repair.
  This was recorded/offline material, **not a new live-network acquisition**. Image
  visual review and interpretation remained unresolved; no new model call ran.

## Explicit live verification path

The existing opt-in Desktop source journey also invokes a bounded, serial CLI
check for the three fixed-v1 materials, reusing its approved Aptamer cache and the
App's configured Python environment. It records real response classification,
short original source scopes, safe image delivery, report reopening/export and
local preview repair. A changed VERID source response is reported explicitly,
not forced to match an older PDF-only observation. The helper refuses to run
without the existing live opt-in; ordinary fixture CI remains network-free.
No workflow policy or timeout is expanded. Live artifacts contain only receipts,
hashes, locations and outcomes; source/image payloads and screenshots are omitted.
This new three-material path has syntax/opt-in-gate checks only until run by CI.

## Remaining acceptance

Issue #75 is not closed by this feature. Historical Aptamer source and Google VERID
PDF product-live evidence remain separate from authentic-material replay. Fresh
three-material live verification is blocked in this execution environment; it is
not upgraded to success from cached originals. Earlier real-provider failures and
semantic limitations remain unchanged. This report verifies evidence provenance
and tool scopes, not scientific correctness, complete reading, visual understanding,
original experiment reproduction, or correctness of arbitrary model claims.
