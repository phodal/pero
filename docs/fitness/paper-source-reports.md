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

- Backend suite: 135 tests run, OK (134 passed; one Windows-only lifecycle test skipped on Linux).
  New report tests cover observed-only references, cross-bundle rejection,
  immutable/idempotent exact-window reopening (including partial-line character windows), image interpretation boundaries, exact PDF
  comparison scopes, original loss/tampering/restoration, journal-capacity failure, and rejection of reportable empty windows.
- `tests/e2e/paper-source-http.py`: authenticated same-core report creation/reopening;
  fabricated observation IDs rejected. Synthetic transport only.
- `tests/e2e/paper-source-cli.py`: actual JSON CLI report creation, evidence-only
  export and reopening in a separate process. Synthetic transport only.
- Desktop App Use/asset bridge: 14 tests passed, including actual text-plus-image
  MCP responses, optional observation ID/warning validation, legacy compatibility,
  and no base64 image leakage into text metadata.
- Paper UI TypeScript check passed. Local browser execution was initially blocked
  by the environment's IPC/process launcher; that failed attempt remains distinct
  from the later successful hosted Desktop acceptance. The hosted fixture exercised
  report save/reopen, exact-window navigation, restart and missing-original recovery.
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
[Exact-head CI for the reviewed #85 implementation](https://github.com/phodal/pero/actions/runs/41311263825)
passed all 42 checks, including Desktop acceptance and this real-network path.
The [acceptance artifact](https://github.com/phodal/pero/actions/runs/41311263825/artifacts/13086447309)
records Aptamer v1 as an 8,086,830-byte TeX/PNG archive, Epitope v1 as a
5,603,079-byte TeX/PNG archive, and VERID v1 as PDF-only (2,361,418 bytes,
zero TeX members). All expected classifications matched. Original text/image
scopes for the two archives, report reopen/export and local preview repair passed;
VERID correctly retains no source-text/image reading claim. No model ran.
This run identifies the reviewed pre-integration head; subsequent merged-base CI
is tracked separately rather than inheriting that result.

## Remaining acceptance

Issue #75 remains subject to its itemized acceptance review. Earlier local DNS and
process-launcher failures are retained as failed/inconclusive attempts; the later
hosted live success is separate evidence, not a relabeling of cached-original replay.
Earlier real-provider failures and semantic limitations remain unchanged. These
checks verify provenance, bounded tool scopes and product recovery—not scientific
correctness, complete reading, visual understanding, original experiment reproduction,
or correctness of arbitrary model claims.

## Review corrections

Zero-match comparisons now freeze the consulted PDF document/file digest separately
from match locations. Missing or corrupted PDF originals invalidate current
availability even when there were no caption matches, and exact-byte restoration
preserves the observation/report. Early returns explicitly record that no PDF was
consulted. Older negative comparisons without a recorded PDF identity retain their
IDs but require a new comparison to produce verifiable evidence; restoring bytes
cannot retroactively establish an unknown scope.

The source image bridge uses explicit fields/constructor assignments, not TypeScript
parameter properties. Direct Node 24 strip-only App Use tests passed (9 tests), and
the repository App Use unit command passed (18 plus 10 tests). Node 22 was not
available locally; the linked hosted Node 22 CI subsequently passed the exact-version
check. The prior transformed bridge test alone did not establish strip-only compatibility.
