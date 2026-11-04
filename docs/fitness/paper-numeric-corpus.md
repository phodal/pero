# Paper numeric extraction: real scanned-paper corpus

Issue #124, diagnostic run on 2026-11-04. This corpus contains three different
historical NACA scientific reports downloaded directly from NASA NTRS. They are
actual scanned originals with archival OCR layers, **not digitally generated
plots rasterized for testing**. Each selected page contains an embedded raster
image; full-page and enlarged-region pixels were inspected independently from
selectable text. All three NASA catalog records mark the reports Public and
“Work of the US Gov. Public Use Permitted.” PDFs and generated images are not
committed. The manifest pins exact downloaded bytes by SHA-256.

## Reproduce

Manifest: `apps/paper-agent/test/fixtures/numeric-corpus.json`.

1. Explicitly download each manifest `downloadUrl` to an external directory with
   its `fileName`. Do not overwrite a hash mismatch or silently update the pin.
2. Install the Paper PDF dependencies and local Tesseract with English data.
3. Run from the repository root:

   `python apps/paper-agent/test/manual/numeric_corpus.py /path/to/pdfs /path/to/results`

This is an opt-in diagnostic, not an ordinary network-dependent test. The runner
never downloads anything. It checks original hashes, constructs version-bound
PDF anchors, invokes the production `NumericExtractor`, and saves the raw
result JSON (native page/region text, raw OCR TSV, scores, boxes, proposed
observations) and the exact rendered crop. Output remains outside the repository.
The committed expectations are conservative status/ground-truth descriptions,
not brittle exact OCR strings or an assertion of automatic numeric accuracy.

Coordinates are normalized `x,y,width,height`, unrotated page space, top-left
origin. Pages are one-based PDF indexes, not printed page numbers. Literal tick
transcriptions preserve decimal commas and omitted leading zeros; `^` describes
a visibly raised exponent, not a literal caret printed in the scan.

## Three fixed originals

### Negative ticks and linear y scale

[NACA-TN-2825, 1952](https://ntrs.nasa.gov/citations/19930083484),
*A comparative examination of some measurements of airfoil section lift and drag
at supercritical speeds*. PDF page 28, figure 10; region
`0.27, 0.12, 0.46, 0.63`.

- y: normal-force coefficients, dimensionless, linear; literal ticks
  `-.6, -.4, -.2, 0, .2, .4, .6, .8`.
- x: free-stream Mach number, dimensionless; ticks
  `0, .4, .5, .6, .7, .75, .8`. Their spacing is **not linear in Mach number**.
  Do not fit a linear x transform merely because y is linear.
- Native archival OCR reads the visually clear `-.4` as `74`. Airfoil numbers
  such as `0009` are legend identifiers, not ticks.

### Log axes, powers and decimal commas

[NACA-TM-768, 1935](https://ntrs.nasa.gov/citations/19930094649),
*The interdependence of profile drag and lift with Joukowski type and related
airfoils*. PDF page 17, figure 5a; region `0.075, 0.125, 0.395, 0.115`.

- x: dimensionless drag-coefficient increment, logarithmic; major labels
  `10^-3, 10^-2, 10^-1`, intervening labels `2,4,6,8` in each decade.
- y: dimensionless lift-coefficient increment, logarithmic; labels
  `0,2; 0,4; 0,6; 0,8; 1,0` (semicolon separates the decimal-comma labels).
- The tiny crop has archival caption text but effectively no selectable axis
  labels. Grid strokes, legend numbers and superscripts defeat simple text-block
  OCR. The source caption outside the crop explicitly describes logarithmic
  plotting; inspected tick spacing supports both log axes.

### Degraded dense log plot

[NACA-TM-842, 1937](https://ntrs.nasa.gov/citations/19930094574),
*Universal logarithmic law of velocity distribution as applied to the investigation
of boundary layer and drag of streamline bodies at large Reynolds number*.
PDF page 67, figure 11; region `0.17, 0.66, 0.72, 0.205`.

- x: Reynolds number, dimensionless, logarithmic; major labels
  `10^5,10^6,10^7,10^8,10^9`, densely printed minor labels `2` through `9`.
- y: frictional drag coefficient, dimensionless, logarithmic; labels
  `0.01,0.02,0.03`.
- Broken strokes, heavy curve labels and grid intersections coexist. The
  archival page text contains the figure caption but no selectable ticks in
  the selected crop. This is an original mixed raster/OCR PDF even though
  the regional classifier correctly calls this particular crop image-based.

## Observed production run

Local Tesseract 5.5.0, English, PSM 6, production 300-dpi bounded crop. All three
OCR calls returned `completed`; a timed rerun of all three took 2.063 seconds
(including PDF inspection and output writes) on this Linux environment. None established a trustworthy complete
axis extraction. `completed` only means the engine returned nonempty words.

| Report | Region class | Native chars | OCR chars | Proposed numeric tokens | Status |
|---|---|---:|---:|---:|---|
| TN-2825 | mixed | 274 | 310 | 18 | needs-review |
| TM-768 | image_based | 10 | 100 | 5 | needs-review |
| TM-842 | image_based | 0 | 336 | 8 | needs-review |

Tokens include legend identifiers, partial values and grid-induced garbage.
The new OCR often loses signs and leading decimal points. For TM-768 it does
not reliably reconstruct scientific powers; for TM-842 even decade ticks are
unreliable. Raw scores are not calibrated scientific confidence. Native text
remains separately available and is itself demonstrably imperfect.

This run verifies original-file binding, real regional rendering, local OCR,
separate evidence channels and conservative review status on three real papers.
It **does not** prove correct automatic ticks, unit inference, curve digitization,
uncertainty estimates, semantic admission, or readiness to close the broader
numeric-verification roadmap. Human-reviewed calibration and stronger chart OCR
remain necessary. No source numbers are silently repaired by these fixtures.


## Real-input reference wiring demonstration (AI-labelled, not human verified)

Re-run the explicit approximate reference input with:

`python apps/paper-agent/test/manual/numeric_reference.py /path/to/pdfs /path/to/reference-results`

Use a fresh output directory on each run; existing stores are not overwritten.
The script checks the pinned TN-2825 original, imports it into a fresh
production store, saves the actual page-28 figure annotation, runs production
regional extraction, records an unresolved observation, attempts and rejects
premature freezing, then appends an **AI-labelled** review and freezes that
reference. It reopens a new store and verifies the saved reference, correction
history, original PDF bytes and crop. Outputs include `source.pdf`,
`selected-region.png`, `report.json`, `report.md`, and `summary.json`, plus the
persisted local store. These local artifacts are not committed or published.

This is a supplied visual reference input, **not an automatic curve extractor**.
The explicit reviewer is `AI visual inspection for POC; not human verification`.
The visually traced solid NACA0006 upper-surface curve at the printed Mach `.7`
tick is approximately **0.50**. In the 1207×2115-pixel production crop, with a
top-left origin, the supplied approximate point is `(766, 441)`. The y-axis
calibration uses `.6` at pixel 309 and `.4` at pixel 585, with explicitly reviewed
linear scale, dimensionless units and multiplier 1. There is no x-axis fit:
Mach spacing is transformed/nonuniform. Legend and solid-curve correspondence
were visually inspected, not recovered correctly by OCR.

The observed local run produced an initial `unavailable` assessment (unknown
numeric value), rejected its freeze, then produced `numeric_ready` from the
explicitly supplied AI review. The arithmetic result is 0.5043478260869565,
but its scientifically appropriate presentation here is only **approximately
0.50**. Extra digits are interpolation arithmetic, not supported measurement
precision. Curve/grid overlap, thick strokes and manual point placement have
not been assigned quantified uncertainty; that limitation is in the review
reason and persisted report.

On reopening, `scientificAcceptance` remains `not_assessed`, report `acceptance`
remains `unverified`, and `captionAxisCrossCheck` remains `not_checked`: the
caption does not independently supply this numeric point. The initial unresolved
record is retained. This proves real-input storage/calibration/report wiring,
not human approval, independently validated scientific accuracy, or a successful
reproduction. The replayed visual choices are explicitly AI-labelled assertions.
