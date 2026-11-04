# Selected-result reference preparation POC

Issue [#124](https://github.com/phodal/pero/issues/124), based on
`master@ddd3650454de1fea7a35a46200756bec4fe71754`. Implemented 2026-11-04.

## Scope

This increment prepares a numerical reference for one saved PDF figure region.
It does not run experiments, claim whole-paper reading, or change the existing
PC-Gym/ResearchStudy scientific acceptance rules. A completely image-only PDF
can be imported, selected, observed, assessed and reported through this path;
the full-paper text study still requires its original observed passages.

The functional core owns numeric observations, linear/log axis calibration,
source conflicts, corrections and reference admission. The shell owns PDFium,
local Tesseract, original-image storage and immutable records. No network call,
model credential, automatic dependency installation or second execution service
is introduced.

## Try the POC

1. Use the existing Paper App development setup. Install its pinned PDFium/Pillow
   dependencies. A local `tesseract` executable and English trained data are
   optional; if unavailable, the report explicitly preserves that limitation and
   the original crop remains available for manual reading.
2. Import a PDF, select a figure region including its axes, labels and legend,
   save the figure annotation, then open **Values** next to that annotation.
3. Choose **Extract region text**. Inspect the source crop, native regional text,
   separately retained native page context and OCR output. All numeric tokens
   are proposals with unknown confidence, not verified measurements.
4. Enter a single result's metric, condition, series, statistic and unit (`1` for
   a dimensionless quantity). Use the literal numeric token for Raw text. Select
   the actual PDF source and acquisition method. Attached author data files are
   deliberately outside this PDF-region POC.
5. For a figure value, enter tick **image pixel positions and literal values**,
   select a linear or positive logarithmic scale, record the multiplier and
   target point's coordinate on that axis. Explicitly review scale, units,
   multiplier and transcription against the crop. The supplied value must equal
   the interpolated point. The core never silently repairs a minus sign or
   decimal point. Nonlinear transformed, broken, dual and symlog axes are not
   supported by this POC.
6. Optionally add a caption value only when it describes exactly the same
   metric/condition/series/statistic/unit. Save and assess. Unresolved identity,
   transcription, unit, scale, point-range and source conflicts block freezing.
7. All sources in this POC require explicit review, including native PDF text:
   a PDF text layer can itself be archival OCR, and the supplied semantic flags
   are not an automatic semantic matcher. Provide a reviewer label and reason. This is recorded
   as a client-reported local review, not authenticated independent peer review.
   A separate checkbox is required to assert reliable series identity and axis
   direction for a qualitative-only result.
8. To correct an observation, choose **Use evidence for new candidate**, change
   it, explain the correction and save a new assessment. Earlier evidence and
   conflicts remain in the history. Other contradictory sources are not dropped.
9. **Freeze reference** is enabled only for `numeric_ready`. Open the report and
   return to the original figure region. Reloading the App keeps old assessments,
   frozen references and reports; viewing history never performs OCR again.

The UI lives in the existing figure annotation panel, not a new application.
Empty, loading, disabled, failure and saved-history states are implemented with
English/Chinese copy. A source crop is a viewing aid, not proof of visual review.

## Deterministic report and API

All routes use the existing App-token authentication. The Host still owns tool
permissions. `numeric-extract` and `numeric-read` are declared App tools; the
manual review/freeze routes are not advertised as automatic Agent approvals.

- `POST /api/numeric/extract`: `{annotationId}`.
- `GET /api/numeric?annotationId=...`: saved extraction, assessment and reference
  history. Native text and OCR are stored independently.
- `POST /api/numeric/assess`: `{annotationId, extractionId?, evidence,
  previousAssessmentId?}`. A correction names `previousId`; the shell appends
  all known same-quantity evidence automatically, so an omitted conflict cannot
  disappear even without `previousAssessmentId`. Cross-quantity corrections
  are rejected before saving; start a genuinely new quantity instead. Each
  evidence retains its own extraction ID across OCR retries and aggregation.
- `POST /api/numeric/freeze`: `{assessmentId}`; blocked assessments return 409.
- `GET /api/numeric/references/{id}`: immutable reference, source anchor and
  selected evidence identities. It has `scientificAcceptance=not_assessed`.
- `GET /api/numeric/{assessments|references}/{id}/report`: deterministic sections,
  Markdown, full audit history and original anchor, `acceptance=unverified`.

The report always includes **图注和坐标轴不一致 / Caption and axis
inconsistencies**. `not_checked`, `conflict` and `no_conflict` are distinct.
General matching-source checks cannot stand in for a caption/axis check. Review
labels, reasons, prior conflicts, raw observations and confidence are retained.
No Agent-authored confidence or success statement can modify the core decision.

## Optional whole-page layout

The default regional reader remains PDFium/Tesseract. Image-based or mixed
regions can also benefit from an explicitly requested **Full-page Docling
layout**. This is a separate, optional installed capability, not a replacement
for the selected source or its manual review. Opening its panel only checks
availability; conversion requires a separate action and never installs software
or downloads models. Unavailable or failed conversion leaves the baseline and
manual reference workflow usable.

- `GET /api/numeric/layout/status`: pinned runtime/model requirements, offline
  availability, reasons and resource limits.
- `POST /api/numeric/layout`: `{annotationId}`; converts only that original PDF
  page with the trusted local offline configuration.
- `GET /api/numeric/layouts/{id}`: immutable derived layout, full raw export,
  original PDF digest, separately retained native text, and OCR/model versions.
- The annotation overview also returns saved `layouts`. They never enter
  numerical evidence or admission automatically. Picture/caption relationships
  are proposals; missing relationships and unresolved geometry remain visible.

The installed profile uses Docling 2.146.0, CPU Heron layout and local Tesseract
full-page OCR. Table cell reconstruction and picture/semantic enrichment are
disabled. Docling character spans are item-text offsets, never PDFium offsets.
Both original bbox coordinate origin and rotation are retained. See
[offline setup and limits](paper-docling-layout.md) and
[the measured three-original comparison](paper-docling-corpus.md).

Software installation and model download are separate user-consent steps. The
Electron Host owns the fixed optional-component installer and its native
confirmation dialogs; the Paper App can request setup but cannot approve it or
supply packages, URLs or commands. The initial supported profile is Linux
x86-64 with CPython 3.12 and existing Tesseract English data. Other platforms or
hosts retain explicit manual configuration and the original reading workflow.
Permission for the test environment is not permission for future installations.

## Verification

Run from the repository root:

```sh
PYTHONPATH=apps/paper-agent/backend python3 -m unittest discover -s apps/paper-agent/test -v
PAPER_AGENT_REAL_OCR=1 PYTHONPATH=apps/paper-agent/backend python3 -m unittest discover -s apps/paper-agent/test -p 'test_numeric*.py' -v
node_modules/.bin/tsc -p apps/paper-agent/tsconfig.json
```

Core tests cover wrong signs, decimal shifts, logarithmic-as-linear readings,
actual nonuniform pixel spacing, two-tick ambiguity, missing units/multipliers,
out-of-range points, tiny/large finite values, semantic mismatches, reproduction
outputs, explicit reviews and retained source conflicts. HTTP tests use a real
authenticated loopback server, generated image-only PDF and real extraction;
they cover review/correction/freeze, restart/reopen, report/source binding,
wrong anchors, invented OCR/native values and exact numeric-token provenance.
The same workflow succeeds without Tesseract by exposing unavailable OCR and
using an explicit manual review, not a fake OCR result.

Three **real** historical NASA/NACA scanned papers were rendered and processed
with Tesseract 5.5.0. All remain needs-review because signs, tick labels and powers
were not reliably reconstructed. Exact source hashes, page/crop coordinates,
manually inspected tick labels and rerun instructions are in
[the real scan corpus](paper-numeric-corpus.md). Synthetic workflow tests are
not presented as real-paper scientific validation.

The optional provider additionally has pure geometry/relationship tests,
preflight failure tests and opt-in real offline conversion and authenticated
HTTP persistence/reopen tests. The three-original comparison records actual
layout failures, caption text errors, timings and memory, not a blanket pass.

Full App build currently stops before Paper bundling because this environment
has no `PERO_GPUI_KIT_PATH`; the Host contract suite additionally needs a built
`target/debug/pero-host`. Component bundling and Paper TypeScript checks are
separate from those gates. Browser UI acceptance and screenshots remain pending:
Chromium launch is restricted in this execution environment, and the supported
cloud browser cannot reach its loopback test server. No Desktop, signed package,
light/dark visual or browser-interaction pass is claimed.

## Remaining boundaries

- English, single-text-block Tesseract is a real baseline, not reliable generic
  chart understanding. It does not identify tick roles, curves, points or units.
- Candidate semantics and tick positions are manually supplied and reviewed.
  Regional text/image classification is a heuristic, not scan-history detection.
- Source priority is used only for an exact quantity/version match. This POC
  binds PDF regions; author result files, HTML table cells and code identities
  still need their own concrete provenance adapters.
- Confidence levels describe evidence quality, not numerical probabilities.
  Pixel/line-width uncertainty is not estimated, and no reproduction tolerance
  or pass/fail comparison is implemented. Downstream #77 work must preserve that
  limitation rather than treat a scalar plot reading as an exact ground truth.
- This POC does not close #124 or #77. It supplies a runnable, conservative
  preparation path and fixed regression material for the next iteration.
