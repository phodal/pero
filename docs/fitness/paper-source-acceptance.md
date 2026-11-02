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
| 2. Hostile/damaged input and recovery | [archive tests](../../apps/paper-agent/test/test_source_archives.py) reject unsafe paths, links/devices, duplicate normalized names, nested/oversized content and unsupported ZIP; [download tests](../../apps/paper-agent/test/test_source_downloads.py) cover denial/cancel/timeout/tampering/exact repair. New `test_source_publication_failure_and_interruption_require_explicit_retry` in [report tests](../../apps/paper-agent/test/test_source_reports.py) tests source-specific publication failure and actual process exit. | ZIP is unsupported, not decrypted. Exact-head #94 CI passed (below); no OS crash/power-loss atomicity claim. |
| 3. Deduplication/version retention | Existing receipt reuse and restoration tests plus new `test_source_versions_coexist_without_rebinding_old_observations`: same work, distinct v1/v2 archives and members, old read/observation/report/export unchanged across restart. Both cached starts retain receipts without fetching. | Exact-head #94 CI passed (below). No migration of historical references to latest versions. |
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
there is no CI lane, timeout, dependency or network-policy change. The later hosted
exact-head acceptance is recorded below, independently of the historical #85 artifact.

## Final hosted regression acceptance (2026-11-01)

Merged [#94](https://github.com/phodal/pero/pull/94) passed
[exact-head ordinary CI 41335731780](https://github.com/phodal/pero/actions/runs/41335731780).
The actual core job logs show both source-publication interruption and
version-coexistence regressions executing successfully: the full Paper suite ran
137 tests, with 136 passing and one existing platform skip. This establishes the
two engineering regressions in criteria 2–3, not a new full/Desktop, live-source,
provider or scientific run. Earlier failures and evidence limits remain intact.

Issue #75 remains open: criteria 8–9 retain the public-evidence qualification
above and require separate acceptance reconciliation. Neither the merge nor these
deterministic tests establish every historical provider scenario, model-quality
improvement, visual understanding or scientific reproduction. No private historical
model details are retrieved or republished by this reconciliation.


## Provider closure review (2026-11-02)

Read-only evidence audit at `master@78881615e37790b0a0b4635a197e18f974ea6867`
after [#99](https://github.com/phodal/pero/pull/99). This is not a provider run or
issue closure. The [latest issue reconciliation](https://github.com/phodal/pero/issues/75#issuecomment-6565260876)
explicitly retains criteria 8–9. #80's public description establishes that real
model exercises happened but excludes detailed validation reports pending
publication review. #85 establishes live product acquisition and source reports,
explicitly not a fresh model pass. Neither absence of public detail nor fixture
success establishes failure or success of every historical provider scenario.
No private historical evaluation or credentials were retrieved for this audit.

### Exact gaps, not new product modules

| Criterion / case | Existing reusable evidence and code | Still needed for provider acceptance |
| --- | --- | --- |
| 8: standard fixed-version discovery | `tests/runtime/paper-study/scenarios.mjs` source case; real Go ACP → Host → App harness, exact-file second-turn prompts; `referenceBoundary` checks actual jobs, grants and byte-fetch log. | An attributable real-provider result for the frozen source/Skill showing review before commit, same work/vN, no bytes before consent, then real owner tools. Authored transport must remain labelled synthetic. |
| 8: nonstandard page | nonstandard/nonstandard-read cases call context/propose with observed evidence IDs; domain HTTP regression rejects stale digest and supplied URL. | Real-provider action trace retaining unknown identity/version, requesting only the observed candidate and not treating page text as authority. Domain rejection alone is not model compliance. |
| 8: ambiguity and injection | The nonstandard fixture includes untrusted instructions and unresolved attachments; domain tests establish constrained proposal/download boundaries. | Explicit per-case assessment: unresolved competing identity/version must not become guessed certainty; injection must not grant downloads or choose an alternate tool route. Distinguish early refusal, domain rejection and actual Skill use. Existing scenario names/automated pass do not independently certify these outcomes. |
| 8: inspect-only and declined acquisition | Skill distinguishes inspection from reference saving; original campaign cases request reference saving. The new authored closure cases inspect first, then confirm or decline. | A real-provider result for the new inspect-only / user-declines continuation assertions: no saved bundle when only inspecting, no grants/jobs/bytes after decline. Do not substitute cancellation of a process after already approving downloads. |
| 8: table provenance | Production source reads issue observations; report tests bind exact archive/member SHA and returned line/character windows. Campaign verifies source member bytes and PDF reports. | Provider assertions must be checked against actual returned table scopes and exact cell strings; source lines cannot be cited as PDF pages. Current campaign does not assert source-report persistence; extend only if the new task requests a saved source report. |
| 9: trajectory-driven improvement | Current Skill contains review-before-commit, explicit-grant, unresolved identity and image-limitation rules. Public #85 records engineering review fixes; private earlier model details are excluded. | A publishable sanitized mapping from observed failure → specific Skill/script change → same-case rerun or regression. A current rule or passing final answer alone does not establish the historical cause or improvement. If no new defect occurs, report that result; do not invent a failure/fix pair. |

The audit found that the historical runner fixed a DeepSeek endpoint/model and
required an uncapped v1 ledger; a two-minute turn timeout was not a request/token
budget. The preparation below removes those defaults, without running inference.
No old ledger, credential or prior unlimited approval is carried forward.

### Smallest next acceptance, pending specific provider approval

1. Prefer an already-published, sufficiently specific sanitized record if a
   maintainer can identify one. Do not retrieve or republish excluded raw history.
2. Otherwise agree one exact endpoint/model and a fresh authorized credential
   mechanism before execution. The historical endpoint/model above is an inventory,
   not a selection or authorization for the new run. No credentials are requested
   in logs, CLI arguments, committed files or public reports.
3. Reuse the existing actual Go/Host/App harness with authored transport only:
   standard table read after exact confirmation; nonstandard candidate analysis;
   ambiguous identity; injected instructions. Include an inspect-only/decline
   branch before authorizing any acquisition. Input consists only of authored
   pages, links, small TeX/table fixtures and user prompts; no third-party source
   archive, private workspace content or image input is needed. This establishes
   real inference on synthetic source transport, not a new live acquisition.
4. Agree resource settings with the user rather than imposing a scientific
   acceptance quota. The plan can express explicit positive session/request/token
   limits or explicit null (no additional limit), plus a positive turn timeout.
   Missing values do not default to unlimited. The existing Go owner enforces
   request/output flags, retries stay zero, and the campaign retains actual usage
   and failed attempts. Those settings are not a currency cost ceiling or proof
   of scientific quality; do not reuse historical unlimited approval.
5. Freeze source commit, executable hashes and Skill digest. Report only scenario,
   public tool names/order, consent boundary, approved resource IDs, source hashes/
   returned scopes, usage, failures and manual exact-cell assessment. Keep raw
   sessions/model reasoning private. A decline must stop without later approval;
   no downloads/clone/installation/experiments outside the explicit fixture case.

### Engineering preparation and current execution boundary

`tests/runtime/paper-study/plan.mjs` parses the explicit `ProviderEvaluationPlan`;
it is an editable configuration/accounting record, not independent human consent
or authorization to send data to an arbitrary endpoint. `run.mjs` now requires
that plan before real credential input and has no default real endpoint/model.
`host-harness.mjs` passes its request/token settings to the existing Go CLI.
The existing ledger now binds the exact plan/source and rejects historical v1
records, changed plans and exhausted finite budgets. Explicit unlimited remains
representable, but only an actual specific user decision can authorize it.

Four authored closure cases are available: standard, nonstandard-decline,
ambiguity, injection. All first inspect without saving; standard later confirms
specific source/PDF files, while the others decline. The assessor checks actual
store/job/fetch records, retains unresolved attachment identity and refuses even
failed attempts to commit/start after decline. This is not a cancellation-during-
acquisition test. Table semantic assessment still compares real returned scopes
and values manually. Ambiguity/injection reuse the authored nonstandard page and
the prompts explicitly flag their risks; passing state checks does not establish
that a model avoided unsupported identity claims in its prose. Review the public
response manually as well. No fixture result establishes model quality.

New provider execution is still blocked pending the exact endpoint/model,
fresh credential mechanism, approved inputs and resource settings. No real
provider, Host campaign, public-source acquisition or private historical replay
was launched. Contract tests passed: **7 Node tests**, including argument mapping,
missing/changed plan rejection, explicit-null budgets, historical-ledger refusal,
finite reservations, four scripted scenario contracts and declined/guessed-identity
negative assessments. The existing recorded-transport Python tests passed **3/3**
with the App-pinned environment. The initial Node invocation lacked `ajv`; reusing
the already installed locked node_modules in this isolated worktree resolved it,
and the full boundary test command passed. No dependency or lockfile changed.
The shared cleanup regressions also passed (9 Node tests including those two).
Independent read-only review found no blocking configuration/Go-flag/ledger seam
issue, while retaining the manual-response boundary above. Syntax and `git diff --check` passed. Actual-process fixture acceptance remains
separate and must use committed source and rebuilt executables.

These tests cannot close criteria 8–9. Closure can be considered once the explicit
provider/trajectory evidence gaps above are reconciled; it need not wait for
#76/#77/#79, OCR, universal image understanding or scientific reproduction.
#99's Library missing-original 409 / original-resource Restore boundary remains
as documented in [Library files](paper-library-files.md#missingcorrupt-original-explicit-recovery-boundary),
not a newly imposed #75 acceptance module.
