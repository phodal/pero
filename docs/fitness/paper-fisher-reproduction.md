---
kind: verification_report
github_issue: 77
github_state: open
github_url: https://github.com/phodal/pero/issues/77
---

# Real-source Fisher Table III reanalysis

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
