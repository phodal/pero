---
kind: verification_report
github_issue: 77
github_state: closed
github_url: https://github.com/phodal/pero/issues/77
---

# Real-source Fisher Table III reanalysis

## Issue #77 closure review — 2026-11-11

**The original six-item software acceptance is complete; #77 is resolved.**
This review read the [issue body and all four comments](https://github.com/phodal/pero/issues/77)
on 2026-11-11 and checked current `master@7ff7c637732606286940b50bafee4d0d3b47a2f5`.
The coordinator publishes this record with GitHub closure. The current
[canonical tracker](../issues/2026-11-11-paper-fisher-acceptance.md) is resolved.

The original requirement is one paper and one reported result, with its software
reproduction loop. It does not require a second paper, every platform, signed
installation, a generic execution platform or independent human scientific peer
review. Earlier wording below that made those additional scopes closure gates
is superseded by this acceptance mapping. Historical failed runs remain failed.

### Six original requirements and observed evidence

All Desktop evidence below is the real macOS Electron/Host/Paper run recorded in
the [2026-11-11 acceptance section](#macos-browser-and-electron-acceptance--2026-11-11),
not the component transport fixtures. Its original PDF, protocol and receipts
are retained under `/Users/phodal/workspaces/pero-issue-77/test-results/paper-fisher/`.

| Original acceptance | Actual observation | Result |
| --- | --- | --- |
| Create a verification item from a PDF table number and locate the original | Import the pinned original Fisher PDF; **Select Fisher Table III result** creates a normal page-4 region annotation at 19.1434. The original-cell action returns to that same visible region; source and result anchor/rects are equal. `desktop/reproduced-light.png` shows the selected original and adjacent result. This is a supported curated cell, not arbitrary-PDF/OCR recognition. | Met |
| Save data version, environment and command; one-click rerun | Frozen Spec `61478f27748b1f668302c4d0031be0f05103979baf0b24b31ea3a0af7b7a35a6` retains PDF/data hashes, Python version/interpreter digest, method/checker identity, selection and explicit CLI command. **Confirm and run a new attempt** creates distinct attempts under that unchanged Spec. App close/reopen and Host restart retain the same items/attempts. | Met |
| Show reported, actual and difference beside the annotation | Real arithmetic and the independent checker produce reported **19.1434**, actual **19.1434**, difference **0 cm²** in the adjacent verification panel; the linked result note contains the same values and exact original anchor. | Met |
| Configure tolerance and judge pass/fail | The predeclared absolute tolerance **0.00005 cm²** yields `REPRODUCED`. A separately frozen **bounds 0..1** protocol yields `MISMATCH` after successful execution; the earlier absolute protocol is unchanged. Absolute/relative/bounds are supported, while this Desktop run exercised absolute and bounds. The artificial bounds case is a control, not a claim that the Fisher result is wrong. | Met |
| Distinguish environment failure and result mismatch, with logs | Altering the method bytes in the disposable installed App after freeze produces `environment_failed`, no actual/checker result and a readable failure log. Restoring the bytes permits a new successful attempt. The bounds control instead has `completed`, `MISMATCH` and independent numerical `PASS`, with its own log. Both were opened through **Read attempt logs**. | Met |
| Complete the loop for at least one real paper/result | Fisher's original Table I supplies all 100 measurements for Table III's sepal-length within-species sum of squares. Selection → frozen inputs/environment/command/policy → explicit real computation → independent check → same-region note → rerun → ZIP download/recheck completed in actual Electron/Host. | Met |

The calculation is not fabricated test output: primary centered float arithmetic
gives `19.143400000000003`; a separate `python -I -S verify.py` recomputes from the
100 primitive CSV values using Fraction/raw moments and gives **95717/5000**.
The selected-result verdict is `REPRODUCED`; `paper_verdict=NOT_ASSESSED` remains
unchanged. Software reproduction of this published statistic is complete without
asserting independent laboratory replication or acceptance of biological claims.

### Four comments, including the reopening reasons

| Comment | Reconciliation with later evidence |
| --- | --- |
| [2026-11-01, after #82](https://github.com/phodal/pero/issues/77#issuecomment-6558337864): checker/adapter alone was insufficient; UI, trusted rerun, identity, comparison, tolerance and logs missing | Agree with the historical reopening. The later Fisher App plus actual 2026-11-11 Electron run now establish all six rows above. Its bounded built-in arithmetic is explicitly confirmed inside the Host-managed App; it accepts no executable/path/code, performs no installation/network/model call and does not bypass PC-Gym's separate private Host route. |
| [2026-11-01, after #93](https://github.com/phodal/pero/issues/77#issuecomment-6565261520): real Run-once/configured execution, forced-destroy and real-paper loop unverified | The [2026-11-05 PC-Gym Desktop record](paper-direct-reproduction.md#2026-11-05-macos-electron-acceptance) records actual native Run once and configured Host→worker execution, while honestly retaining its `INCONCLUSIVE` paper verdict. The [later #106 Linux record](paper-linux-host-approval.md#consolidated-pr-106-themed-owned-native-acceptance) records actual abort/owner-close/forced-destroy denial and semantic Cancel/Run once. That Linux run is a **no-computation fixture**, not the scientific execution. Fisher independently supplies the completed one-result numerical loop required here. |
| [2026-11-02, #97](https://github.com/phodal/pero/issues/77#issuecomment-6566128976): original GTK positive probes blocked; no approval executed | Those #97 runs remain blocked and the original GTK bridge is not declared repaired. The later owned Linux approval surface in #106 is a separately verified implementation. Do not turn its native permission evidence into a worker/science claim or imply that Fisher uses that dialog. |
| [2026-11-02, tolerance/data feedback](https://github.com/phodal/pero/issues/77#issuecomment-6569765669): choose one real result, freeze tolerance and distinguish environment/data/result causes | Fisher uses the printed-fourth-decimal half-unit tolerance before running. Changed-data tests return `input_mismatch` without observations; changed environment returns `environment_failed`; completed out-of-policy execution returns `MISMATCH`. Thus tolerance cannot conceal a different dataset or an unavailable environment. |

Native run [41434159265](https://github.com/phodal/pero/actions/runs/41434159265)
was queried again: GitHub still reports `success` at
`a95d6bbd8f434d66b526e8bebbb1ec3a96099bab`. Its previously inspected artifact
`13135926825` now returns HTTP 404; this review does **not** claim a fresh download
or fresh native execution. The dated #106 report retains its inspected receipt,
exact-target semantic outcomes and archive digest. Current approval contracts
were rerun separately as described below.

### Current-base recheck and exact retained evidence

No Fisher backend/UI source or `paper-fisher-desktop.mjs` differs from the tested
`7362b4c59699014afbed6fe1c661d5f524335aa5` commit. The original Electron evidence is
therefore retained rather than presented as a new desktop run. This review also
reopened the successful, environment-failed and mismatch screenshots.

- **18/18 original-PDF tests**, no skips, pass on the new base: authenticated
  loopback API and real computation/checker, wrong-token HTTP 401, PC-Gym public
  start HTTP 403, explicit frozen-spec confirmation, wrong-source/data/command
  refusal, no replay of unfinished attempts, failure logs and ZIP recheck.
- **22/22 approval contracts**, no skips, pass with existing Node 24: current
  sender/frame/nonce/refusal/close/destroy handling and Host orchestration. These
  are contract tests and do not replace the historical actual native run.
- The actual Electron `desktop/handoff.zip` was extracted into a fresh directory
  and rechecked with site packages disabled: exit 0, count 100, exact total
  95717/5000, `REPRODUCED`, `NOT_ASSESSED`. Its frozen method digest and interpreter
  identity match this checkout/environment; the exported checker bytes match the
  current standalone checker source.

Successful exported attempt: `6ac4e71e6e114714a5786aee27d0e254`.
Archive SHA-256: `5246051c807931fbff64c18c0bac9db0813cc3166fb8d6a4d1a5c6c5bf2a0df8`.
Retained environment-failed attempt: `561833c2f3894a73b829f376ee9651de`.
Successful restoration attempt: `562257e8cfa24b11bf889537d969ac17`.
Mismatch control attempt: `561fc5a1dec144298013f04fe2c4df90`, under separate Spec
`d574106c2eb25a6ba2c4f3e08666874aa0badc2b6426330e98c14c47682c6c52`.

Current review artifacts are local and gitignored:
`/Users/phodal/workspaces/pero-issue-77-close/test-results/paper-77-closure/`:
`fisher-staged.log`, `approval-node24.log`, `evidence-audit.json`,
`checker.stdout.log`, `checker.stderr.log`, `handoff-rechecked/` and
`linux-ci-status.json`. The initial unstaged run failed to import the shared PDF
parser; the existing packaging command fixed the checkout prerequisite.
Node 26 rejected the historical transform flag, and its strip-only retry could
not load a TS parameter property; the existing Node 24 runtime ran the unchanged
contracts successfully. Both failed invocations remain in the same evidence
directory, not counted as passes. No production change was needed.

```sh
node scripts/build/source-parsers.mjs
PERO_FISHER_PDF=/Users/phodal/workspaces/pero-issue-77/test-results/paper-fisher/fisher1936.pdf PYTHONPATH=apps/paper-agent/backend /Users/phodal/.pero/environment/pero-python312/bin/python3 -m unittest discover -s apps/paper-agent/test -p 'test_fisher*.py' -v
/opt/homebrew/opt/node@24/bin/node --experimental-transform-types --test desktop/src/main/reproduction-approval-linux.test.ts desktop/src/main/apps-reproduction.test.ts tests/fixtures/paper-host-approval.test.mjs
/Users/phodal/.pero/environment/pero-python312/bin/python3 -I -S test-results/paper-77-closure/handoff-rechecked/verify.py
```

## Historical implementation and acceptance

Date: 2026-11-07. Implementation base: `master@bc20ef9f4e0a31802f0eafc4ec6e3b0066a149be`.
Numerical validation used no model calls, package installation or user-computer access.
Source changes are published for review in [Draft PR #160](https://github.com/phodal/pero/pull/160);
the original PDF and execution artifacts remain local.
Verified implementation tree: `6024d3cf3390c4d7851b827ae04609f34328425d`,
published as `8a9196fee322a05c0a523e9f8cc49080d3f461e9` and identical to the local
validation commit `89fd81282b4b97b5981806824b85d65cdc122743`.

## Target and scientific boundary

[Fisher (1936)](https://doi.org/10.1111/j.1469-1809.1936.tb02137.x), *The use of
multiple measurements in taxonomic problems*: Table III, printed page 181,
sepal-length row/column, reports a within-species sum of squares of
**19.1434 cm²**. Inputs are the two 50-observation sepal-length columns of Table I,
printed page 180. All 100 observations are retained. Virginica is not part of
this two-species calculation. No new biological observations or model training
are claimed.

The formula sums squared deviations from **each species' own mean**, then adds
the two groups. It is not a population-wide centered statistic or a variance;
there is no division by 98. That number is the degrees of freedom.

The source is the actual
[11-page university-hosted PDF](https://lgross.utk.edu/Math589Fall2020/RAFisher1936measurementsFlowerTaxa.pdf),
494,926 bytes, SHA-256
`d3a49aaa4f2d283931544f58cb12b1174f537642b83def7ae9119a1d8717b740`.
Its first page is an archive notice, so data and result are PDF pages 3 and 4.
The original PDF is not committed or replaced with a generated fixture.

Two separately prepared visual transcriptions agreed on all 100 measurements.
The reviewed CSV SHA-256 is
`63bc335cdbbecc311a3dced4a28b210a94bc2ccc71b0df5535b72c30091623fc`.
The scan shows **5.4** for setosa row 32; its text layer incorrectly yields 6.4.
The selected Table III value is also absent from usable PDF text extraction.
The case therefore binds a visually checked original region, not a fabricated
text token, guessed OCR correction or sklearn/UCI substitute.

The default absolute tolerance is **0.00005 cm²**, half a unit in the printed
fourth decimal. It is frozen before execution and is not adjusted by a result.
An exploratory source/arithmetic check preceded the final implementation run;
this is a reproducibility demonstration, not a blinded prospective experiment.

## Implemented path

- `fisher_result.py`: typed observations, fixed metric, frozen protocol and comparison.
- `fisher_table1.csv`: attributed, reviewed raw sepal-length transcription.
- `fisher_reproduction.py`: explicit prepare/run CLI, exact-input/environment checks,
  new attempts, execution evidence and same-region result annotation.
- `fisher_verify.py`: standalone standard-library checker with no candidate imports.

Preparation reads the real PDF through existing `PdfFiles`, saves it in a
disposable `ResearchStore`, and binds the original `PdfAnchor`. The selected region
on PDF page 4 is `(x=.34, y=.339, width=.065, height=.012)` in the existing
unrotated top-left coordinate space. Its crop was inspected and contains only
19.1434, excluding the following table row.

The protocol binds original PDF/data digests, selection, exact Python version and
interpreter bytes, implementation/checker hashes, metric, command and comparison.
Changes require a new protocol. `run` needs explicit confirmation of that exact
digest; it has no arbitrary command/path execution route, downloader, model
client, scheduler or approval bridge.

Primary computation uses float means and `math.fsum` of centered residual squares.
The independent `python -I -S verify.py` process instead uses `Fraction` and
`sum(x²) - sum(x)² / n`. It checks primitive inputs, both species' contributions,
coverage, units, execution/spec identities and the fixed evidence manifest before
evaluating the frozen policy. Exact arithmetic owns tolerance-boundary decisions;
the primary floating-point value is separately retained as `observed_actual`.

The result annotation is an immutable linked revision at the same source region,
not a replacement of the original annotation or an overwrite of a previous run.
Input mismatch, failed environment admission, numerical mismatch, verification
failure and post-computation annotation failure remain distinct. Annotation
failure preserves an already-established numerical verdict and reports an
incomplete workflow with a nonzero CLI exit.

## Actual execution

Cloud Linux, Python **3.12.14**, with the already-installed PDF reader. Final Spec:
`7beb76197884076baa1da6fafb5b1cd82c65682266d9a1afaa243316d3eeea26`.
Its implementation fingerprint is
`73f0e991ff782e7f8b5f58f7bccf94d0131b958ec9925d2e9daf986cd36aea51`.

| Result | Value |
| --- | ---: |
| Setosa count / mean / within-species sum | 50 / 5.006 cm / 6.0882 cm² |
| Versicolor count / mean / within-species sum | 50 / 5.936 cm / 13.0552 cm² |
| Primary floating-point total | 19.143400000000003 cm² |
| Independent exact total | 95717 / 5000 = 19.1434 cm² |
| Published value / exact difference | 19.1434 cm² / 0 cm² |
| Fixed result verdict | REPRODUCED |
| Whole-paper verdict | NOT_ASSESSED |

Attempts `2edc81c0cb5a4bac977854c8be8d3e7a` and
`f2b641696ef74ee58f62b1db687cb4c6` both completed under that same Spec, retained
separate receipts and saved result annotations. The first attempt was copied to
a fresh directory and rechecked with site packages disabled; exit 0, exact total
95717/5000 and numerical verification PASS. Hashes establish content consistency,
not OS execution attestation or an independent laboratory replication.

Reproduction instructions are in the shipped
[protocol reference](../../apps/paper-agent/skills/paper-reproduction/references/reproduction-protocol.md#fixed-real-source-reanalysis-fisher-table-iii).
Evidence from this execution is retained locally under the gitignored
`test-results/fisher-verified-20261107/`, `test-results/fisher-verified-offline/` and
`test-results/fisher-source/` directories. They include original source bytes,
the two transcriptions, inspected renders/crops, frozen protocol, command logs,
attempt manifests, independent outputs and test logs. These are local artifacts,
not assumed to be remotely accessible CI evidence.

## Verification and remaining scope

- 13 focused tests pass, including original-PDF preparation, real computation,
  independent process, restart/readback, rerun identity, explicit approval,
  environment failure, changed data, mismatch bounds, tampering, unknown prior attempt
  refusal and annotation failure.
- Final complete Paper suite: **376 tests, 372 passed and 4 skipped**, with the
  original-PDF integration enabled. No failed tests. Command:
  `PERO_FISHER_PDF=/absolute/fisher1936.pdf PYTHONPATH=apps/paper-agent/backend python3 -m unittest discover -s apps/paper-agent/test -p 'test_*.py'`.
- Existing shared App payload staging includes all four new runtime/data files.
- Python compilation and whitespace checks pass.
- `npm run check` is blocked at `tsc: not found` because this fresh clone has no
  root Node dependencies. No TypeScript or frontend files changed.
- The external App bundle unit test passes. The workbench payload test cannot
  load its existing `esbuild` dependency in this clone. Direct shared staging of
  the changed Paper backend/data does pass; this is not full product acceptance.

**This does not close #77.** It establishes a real-paper numerical reanalysis with
saved original-region evidence, not a new Desktop-native acceptance. The Fisher
case is CLI-only and uses its own disposable Paper data home; it is not connected
to the PC-Gym-only **Run once** button, public reproduction API or existing live
user annotations. There was no Desktop click-through or installed-product run.
The original PC-Gym Table 6 identity/granularity gaps remain `INCONCLUSIVE`.

## Paper App workflow increment — 2026-11-07

Base: `master@371ea0895f8dbd12d7fcc97e320f3a9499b3e94b`. This section supersedes
only the CLI-only integration boundary above; the historical numerical run and
Native acceptance limits remain separate.

### User path and ownership

1. Import/open the exact reviewed original PDF in Paper. The PDF toolbar offers
   **Select Fisher Table III result** only for that file digest. It saves the
   existing curated page-4 region as a normal figure annotation, shows its crop
   and opens verification beside it. No OCR substitution or generic result
   recognition is claimed.
2. Inspect all 100 reviewed Table I measurements (50 per species), the data SHA,
   within-species formula, units, reported value, Python/method identities and
   comparison rule. Confirm the method, then freeze a new immutable item. An
   absolute/relative tolerance or numeric bounds is saved before the attempt;
   changing the policy creates another item instead of editing history.
3. Explicitly confirm the fixed arithmetic run. The existing Host-managed Paper
   process computes the bounded built-in method and runs the same 30-second
   standard-library checker. It cannot accept an executable, path, code, package
   install, model or network destination. This is a small local App calculation,
   not another generic execution owner or a PC-Gym Host-approval bypass. It is
   intentionally not advertised as an Agent write tool.
4. Inspect execution, the single-result verdict, original/actual values and
   difference, independent numerical check, and annotation receipt separately.
   Source navigation goes back to the same original region. A result note is
   saved in the **active Paper store**, not a disposable CLI library.
5. Rerunning creates a new attempt. A stable request ID reconciles a lost response
   without duplicating computation; an unfinished recorded attempt is not
   replayed. Saved items and attempts remain available after process restart.
6. Export the selected attempt as a ZIP. It includes original PDF, reviewed data,
   frozen protocol/selection, raw observations, execution/checker evidence,
   comparison and annotation receipts, logs and readable instructions. Extract
   into a fresh directory and run `python -I -S verify.py`. No package dependency,
   model credential or network is required for this independent numerical check.

The active-source selection, command admission and existing comparison contract
remain domain values; the HTTP adapter only maps authenticated requests. The new
`/api/fisher/step` and `/api/fisher/evidence-archive` routes do not change
`/api/reproduction/step`, PC-Gym configuration or its `INCONCLUSIVE` verdict.
Whole-paper acceptance always remains `NOT_ASSESSED` for Fisher.

### Design and reference decisions

The PDF reader remains the primary surface. The new panel reuses SDK Button,
Checkbox, Select, Input, Table, Disclosure and Feedback; primary confirmation and
result states stay visible, while version/command detail is disclosed. No shared
tokens, existing PC-Gym controls or numeric-observation state owners were replaced.

The workflow uses two published product ideas, not copied implementations:
[Wisp Publication Evidence](https://github.com/xuzhougeng/wisp-science/blob/main/docs/publication-evidence.md)
separates explicit freeze from verification and preserves exact evidence;
[AIPOCH research packages](https://aipoch.com/docs/guides/research-packages/)
separates inspectable handoff from executing received code. Wisp's current
[license](https://github.com/xuzhougeng/wisp-science/blob/main/LICENSE) is AGPL-3.0;
AIPOCH's [license](https://github.com/aipoch/open-science/blob/main/LICENSE) is
Apache-2.0. No code, assets or documentation text from either project is copied.
This increment does not implement either project's general capsule or import
format, nor does it claim their runtime behavior was independently tested.

### Verified so far

- Original-PDF API integration covers authenticated select/freeze/run/status,
  the real float calculation and separate exact checker, result note in the
  active store, request reconciliation, restart, a distinct rerun and ZIP
  extraction/recheck. Independent exact value remains `95717 / 5000 = 19.1434`.
- Policy changes create a new item; deliberately excluding the actual value
  produces `MISMATCH` with successful execution and an independent `PASS`.
  Environment change produces `environment_failed`/`INCONCLUSIVE`, not mismatch.
- A recorded unfinished attempt, including a crash after calculation but before
  comparison, blocks a new attempt. Changed spec/source and arbitrary command
  fields are rejected. Existing PC-Gym public execution still returns HTTP 403.
- Complete Paper suite with the original PDF enabled: **381 tests, 377 passed,
  4 skipped, no failures**. `test-results/fisher-app-20261107/python.log` records
  the 82.680-second run; new App workflow tests are 5 of these.
- Paper TypeScript typecheck passed. Full root `npm run check` is blocked at the
  pre-existing missing generated `web/src/reader-wasm/pero_reader_web` module.
  Full Paper product build is blocked by absent `PERO_GPUI_KIT_PATH`; the shared
  Reader build requires the GPUI Kit checkout. Neither blocked stage is a pass.

Browser interaction, visual and current final-source verification are recorded
below when completed. Native GPUI, Electron Host integration, signed packages,
other platforms, human scientific review and a second non-curated paper remain
unverified. This bounded engineering slice does not close #77 or establish
scientific generality or product-market fit.

### Independent local verification follow-up — 2026-11-07

Source: `371ea0895f8dbd12d7fcc97e320f3a9499b3e94b` plus the uncommitted Fisher App
increment. No push, PR publication, model call or API credential was used.

- `tests/e2e/paper-fisher-state.mjs` now passes and exits normally. The previous
  remount assertion incorrectly expected the input-review editor in the restored
  frozen-result stage. The test now checks that stage, closes its disposable
  Node MessageChannels, and verifies rapid repeated freeze/run clicks dispatch
  once. It also covers all 100 inputs, failed refresh retaining results,
  unresolved submission surviving remount, no replay of an unfinished attempt,
  same-request recovery, missing annotation warning and environment failure.
  This is production React in JSDOM with transport fixtures, not a browser or
  scientific execution claim.
- Original-source focused Python suite: **18/18 passed**, 2.605 seconds,
  including authenticated real loopback HTTP, real arithmetic, independent
  exact checker, restart, repeat-request reconciliation and exported ZIP
  extraction/recheck. Log: `test-results/fisher-app-20261107/focused-final.log`.
- Shared bundle/staging checks: **5/5 passed**, including staged Paper CLI.
  Log: `test-results/fisher-app-20261107/staging-final.log`.
- Both Chromium suites were attempted, including the production PdfViewer with
  a real local Python backend. Bundling and backend readiness succeeded, but
  Chromium exited before page creation: `process_singleton_posix.cc:297`,
  `socket() failed: Operation not permitted (1)`. An approved escalated retry
  hit the same runtime restriction. Logs: `component.log` and `browser.log` in
  `test-results/fisher-app-20261107/`. No current browser screenshot or visual
  acceptance was produced. Narrow/dark layouts, keyboard/focus, PDF close/reopen
  and source-navigation interaction therefore remain unverified in Chromium.

The browser test scripts remain executable acceptance candidates, not passing
acceptance evidence. Native GPUI, Electron/Host integration and signed-package
acceptance remain unverified. No scientific-generalization or #77 closure claim
is made.

Final-source aggregate rerun: **381 Python tests, 377 passed and 4 skipped, no
failures**, 87.398 seconds (`python-final.log`). Paper TypeScript typecheck passed
(`typecheck.log`). Root `npm run check` remains blocked by the existing missing
`web/src/reader-wasm/pero_reader_web` generated module (`root-check.log`), so its
later generated-asset checks did not execute. `git diff --check` passed. Logs
are under `test-results/fisher-app-20261107/`.

## macOS browser and Electron acceptance — 2026-11-11

Source: `b1b95293` plus `codex/paper-fisher-acceptance`; isolated checkout
`/Users/phodal/workspaces/pero-issue-77`. This supersedes the prior browser and
Electron acceptance gaps for this bounded Fisher path only. GitHub #77 is still
open; original implementation PRs #160 and #166 were confirmed merged.
Canonical engineering tracker: [Fisher acceptance](../issues/2026-11-11-paper-fisher-acceptance.md).

The new Electron journey imports the university-hosted original bytes through
Paper's PDF importer, inspects all 100 inputs, freezes the unchanged absolute
0.00005 cm² policy, runs the real float method and independent exact checker,
reruns under the same spec, exports the actual ZIP and rechecks it in a fresh
directory with `python -I -S`. Both reported and independently measured values
are **19.1434**, difference **0**; the exact total remains **95717/5000**.
The active-store result annotation has the same source anchor and PDF page 4.

A deliberate comment appended to the disposable installed method file changes
its real fingerprint after freezing. Running then yields
`environment_failed / INCONCLUSIVE`, no actual value or independent check, and
readable failure logs. Restoring the file permits a new successful attempt under
the original frozen spec. This is an injected environment-admission failure,
not a claim that an external Environment/Compute machine failed and recovered.
A separately frozen **bounds [0, 1]** test policy produces
`completed / MISMATCH / independent PASS`; this intentionally excludes the actual
value and never alters the default policy or earlier spec. Both protocols and
all five attempts survive closing/reopening the reader and restarting Desktop/Host.

Observed repairs: opening Fisher notes no longer lets automatic PDF fit return
to the previous page; source navigation keeps the current zoom using the existing
capability. Environment failures no longer claim a missing result annotation,
and both environment failure and mismatch provide specific recovery guidance.
Components remain the shared SDK controls and Feedback; no token migration or
new state owner. The test runners use canonical SDK aliases, stage the existing
PDF parser and accept `PERO_APP_PYTHON`; the CLI fixture resolves its temp parent.

### Reproducible commands and local evidence

Run from the isolated checkout with a Python 3.12 environment containing the
App's declared dependencies and the exact PDF identified above:

```sh
export PERO_APP_PYTHON=/Users/phodal/.pero/environment/pero-python312/bin/python3
export PERO_FISHER_PDF="$PWD/test-results/paper-fisher/fisher1936.pdf"
node scripts/build/source-parsers.mjs
PYTHONPATH=apps/paper-agent/backend "$PERO_APP_PYTHON" -m unittest discover -s apps/paper-agent/test -p 'test_fisher*.py'
TMPDIR=/private/tmp PYTHONPATH=apps/paper-agent/backend "$PERO_APP_PYTHON" -m unittest discover -s apps/paper-agent/test -p 'test_*.py'
node tests/e2e/paper-fisher-state.mjs
node tests/e2e/paper-fisher-component.mjs
node tests/e2e/paper-fisher-browser.mjs
npm run typecheck --prefix apps/paper-agent
node scripts/build/apps.mjs --app paper-agent --reader-dist /Users/phodal/workspaces/pero/web/dist-reader
node tests/e2e/paper-fisher-desktop.mjs
```

Results: focused **18/18**; full **381 / 377 pass / 4 skip**, 62.308 seconds;
state, component Chromium, real-source Chromium, Electron, App build and
TypeScript all pass. The full suite's first run with macOS's default symlinked
temp directory failed (43 errors / 1 failure); `python-full.log` retains that
attempt. The CLI-specific fixture is fixed here; unrelated PC-Gym fixtures
continue to require canonical TMPDIR. No domain path restrictions were relaxed.

Artifacts are local, gitignored, and not remotely published CI evidence:
`/Users/phodal/workspaces/pero-issue-77/test-results/paper-fisher/` contains
`python-focused.log`, `python-full-canonical.log`, `state.log`, `component.log`,
`browser.log`, `typecheck.log`, `desktop.log`, and `desktop/result.json`.
The latter records immutable specs, five attempts and the disposable profile.
`desktop/handoff.zip` contains the independently rechecked successful attempt.

Visually inspected screenshots: `actual-reader-light.png`,
`desktop/reproduced-light.png` (page-4 original cell with report/actual/difference),
`desktop/environment-failed.png` (missing actual/check, recovery text),
`desktop/mismatch-dark-narrow.png` (mismatch distinct from independent PASS),
`desktop/mismatch-source-dark.png` (keyboard focus and original cell).
Desktop window sizes: 1440×1000 and 1000×900; narrow notes intentionally overlay
part of the PDF while the selected cell remains reachable. The 390px component
fixture additionally verifies no document-level horizontal overflow. These are
Web/Electron observations, not Native GPUI, physical IME or exhaustive accessibility
acceptance. The result section and input review remain vertically scrollable.

Runtime: macOS 27.2 (26B123), Node 26.8.1, Electron 45.1.0, Python 3.12.11.
Paper was rebuilt from this checkout. Existing development Desktop, Host and
Reader outputs were reused; they were not rebuilt or packaged here. SHA-256:

- Desktop `main.cjs`: `1da42bd99b3ca1778d0cd30d2036fedeb23619d80725a8a2c239680c98015aa2`.
- Host executable: `9fa3ce64d462609fc7f4cf7a36a4b68aeaaa783506ba248c37a72fd5ce35466d`.
- Built Paper `index.js`: `08f9a5628a704e9d466293c16f62abaaf0e8f6adfd2e4a599f11a1a0b9fc4e5e`.

Still not established: independent scientific review, a second non-curated paper,
general Environment/Compute execution, Native GPUI, signed installation/update,
other platforms or whole-paper reproduction. Fisher remains `NOT_ASSESSED` at
whole-paper level; PC-Gym remains outside this increment. These are separate
acceptance scopes, not additional gates on #77's original six items; see the
closure review above. No model call or external account was used.
