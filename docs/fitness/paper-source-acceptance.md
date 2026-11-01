# Source-first acceptance reconciliation (#75)

Scope: source acquisition, bounded original reading and traceable reports, not
scientific reproduction or universally correct model interpretation. Audit base:
`48aa9ad88d433817267edb02fa2262f70e8e6e69` (2026-11-01). This reconciliation does
not itself close [issue #75](https://github.com/phodal/pero/issues/75).

## Evidence owners

- [#80](https://github.com/phodal/pero/pull/80): source-first discovery, independent
  source/PDF grants, bounded archive indexing, original reads, raster delivery,
  same-core CLI and existing Harness/Skill integration. [Desktop/live acquisition
  evidence](https://github.com/phodal/pero/actions/runs/41294468896/artifacts/13078727844).
- [#84](https://github.com/phodal/pero/pull/84): cached PDF original integrity and
  exact-byte restoration. Its PDF publication tests do not by themselves verify
  source-archive publication.
- [#85](https://github.com/phodal/pero/pull/85): server-issued observations and
  same-bundle reports, exact-window reopening, original availability separated
  from historical evidence. [Three-material live product evidence](https://github.com/phodal/pero/actions/runs/41311263825/artifacts/13086447309):
  Aptamer `2610.24806v1` and Epitope `2610.33195v1` are actual TeX/PNG archives;
  VERID `2610.32755v1` is explicitly PDF-only. No model ran in this acceptance.
  [Report verification and limitations](paper-source-reports.md) distinguishes
  reviewed feature-head full CI from subsequent merged-base standard CI.

## Issue acceptance, criterion by criterion

| Item | Established scope and evidence | Limit / remaining gate |
| --- | --- | --- |
| 1. Three materials | #85's live product CLI receipts classify both archives and PDF-only VERID accurately. | No claim that VERID contains TeX; future changed responses must be recorded rather than forced to this result. |
| 2. Hostile/damaged input and recovery | [archive tests](../../apps/paper-agent/test/test_source_archives.py) reject unsafe paths, links/devices, duplicate normalized names, nested/oversized content and unsupported ZIP; [download tests](../../apps/paper-agent/test/test_source_downloads.py) cover denial/cancel/timeout/tampering/exact repair. New `test_source_publication_failure_and_interruption_require_explicit_retry` in [report tests](../../apps/paper-agent/test/test_source_reports.py) tests source-specific publication failure and actual process exit. | ZIP is unsupported, not decrypted. New regression needs exact-head CI; no OS crash/power-loss atomicity claim. |
| 3. Deduplication/version retention | Existing receipt reuse and restoration tests plus new `test_source_versions_coexist_without_rebinding_old_observations`: same work, distinct v1/v2 archives and members, old read/observation/report/export unchanged across restart. Both cached starts retain receipts without fetching. | New regression needs exact-head CI. No migration of historical references to latest versions. |
| 4. Literal TeX structures | Authored [archive fixtures](../../apps/paper-agent/test/test_source_archives.py) cover longtable, tabular/tabularx, caption*, no labels, includes and bibitem; #85 supplies actual source windows from the public archives. | Literal indexing is not macro execution or a reconstructed scientific table. |
| 5. Source/image/PDF anchors | [source report tests](../../apps/paper-agent/test/test_source_reports.py) bind archive/member/content/preview hashes and returned offsets. Positive and zero-match comparisons retain consulted PDF identity; unmatched cases are unresolved. | Image delivery is `not_reviewed`, not semantic interpretation. |
| 6. Shared core and repeatable automation | [HTTP](../../tests/e2e/paper-source-http.py), [CLI](../../tests/e2e/paper-source-cli.py), [live CLI](../../tests/e2e/paper-source-live.py) and App routes use production domain owners. #85 establishes report creation, restart, export and repair. | Fixture transport and live acquisition are separate evidence. |
| 7. Actual App UI | [Desktop journey](../../tests/e2e/paper-source-study.mjs) and #80/#85 artifacts cover selection, cancel/retry, original text/image, PDF comparison, report reopening and missing-original recovery. | Development Desktop evidence, not signed-package acceptance on every OS. |
| 8. Actual Harness/provider versus fixture | [#80](https://github.com/phodal/pero/pull/80) publicly states that real-model exercises were performed, with interpretation limitations. #85 explicitly claims no fresh model pass. | This PR does not republish historical model details or independently establish every provider scenario in criterion 8. No new provider campaign is performed. |
| 9. Trace-driven improvement | [#85](https://github.com/phodal/pero/pull/85) publicly preserves earlier failures and describes review findings fixed with regressions. | Detailed historical model trajectories are not republished here. This public record alone does not establish complete criterion 9; these deterministic tests must not be treated as a replacement. |
| 10. Evidence layers separated | [report scope](paper-source-reports.md) distinguishes acquisition, actual returned text/image scopes, model attention and semantic correctness. | Earlier model errors and semantic limitations remain recorded as stated publicly in #85; no new interpretation-quality pass is claimed. |
| 11. Explicit live/model opt-in | Existing CI runs authored fixtures without paid models; live source helper refuses without its explicit opt-in. | No new workflow, timeout or credential use in this increment. |
| 12. Safe public artifacts | #85 live artifacts contain receipts/hashes/locations/outcomes; Desktop screenshots are authored fixture content. | No third-party originals, extracted full text, credentials or raw model reasoning are added. |


### Public evidence boundary

Only the existing public PR descriptions, artifacts and repository tests are
cited here. #80 says detailed validation reports were excluded from its public
branch pending publication review; they are not republished, identified or
summarized here. Public engineering artifacts are not proof of every historical
provider scenario or model-quality improvement. Criteria 8–9 therefore retain a
qualified evidence status rather than being declared complete by this increment.

## New recovery boundary

Both new tests use self-authored synthetic archives and the existing domain owner.
The failure case injects a filesystem publication error after the original blob
has been published; the acquisition reports failure with no receipt and removes
that newly created original. A separate owned process exits immediately after
publishing the original, before the archive index or receipt. This bypasses Python
exception cleanup deterministically, rather than killing a process after a sleep.

Reopening the store marks the persisted running job `interrupted`, exposes no
successful receipt or readable source index, and starts no fetch. Only an explicit
retry completes acquisition. Existing version-one report/receipt/read identity is
checked throughout. This tests one precise crash boundary, not every filesystem
failure or a global transaction. Production logic and authority are unchanged.

## Closure interpretation

Exact-head ordinary CI can establish these two source recovery/version
regressions and complete the public engineering evidence described here. It does
not by itself establish all of #75: criteria 8–9 remain qualified by the public
evidence boundary above, and the issue is not automatically closed. A maintainer
must reconcile that remaining acceptance separately without inferring a model
campaign from deterministic tests.

The three-material live acquisition and server-owned observation/report evidence
are established by the linked #85 artifacts, not left uncompleted merely because
older comments predate them. Passing tests must not erase failures, turn
`not_reviewed` into visual validation, or claim scientific reproduction.

This increment performs no new public-network/model/scientific run and changes no UI.
Fresh GUI screenshots or paid inference are not a prerequisite for these two
backend regressions. See the PR's exact-head checks for final integration status.

## Local regression verification (2026-11-01)

Python 3.12.14 with the App-pinned Pillow 12.0.0 and pypdfium2 5.0.0: full
Paper suite 137 tests, 136 passed and the existing Windows-only lifecycle test
skipped on Linux. The 11 source-report tests were rerun after review fixes;
independent review also passed all 11 with no leaked crash staging directory.
Review moved the intentional crash's temporary staging under parent-owned cleanup
and installed the observed transport before store construction, so the no-fetch
check covers restart admission as well as subsequent status reads.

Authenticated HTTP and separate-process CLI fixture journeys also passed with
synthetic transport (HTTP uses loopback only). Local document links and
`git diff --check` passed.

No production fix was needed. The new tests run in the existing Paper test discovery;
there is no CI lane, timeout, dependency or network-policy change. Hosted exact-head
acceptance remains pending, rather than inherited from the historical #85 artifact.
