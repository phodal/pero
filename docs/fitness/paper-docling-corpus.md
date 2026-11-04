# Docling versus PDFium/Tesseract on three original scans

Issue #124, real local runs on 2026-11-04. These are the same pinned NASA originals
and original PDF pages used by [the numeric corpus](paper-numeric-corpus.md), not
synthetic fixtures. This compares proposed layout/evidence, not scientifically
validated measurements or human-approved figure reading.

## Reproduce without downloading

Use the already installed optional Docling runtime and official local Heron model
artifacts. The script does not install packages, download models, or fetch PDFs.

```sh
python apps/paper-agent/test/manual/docling_corpus.py \
  /path/to/pdfs /path/to/results --engines both \
  --docling-python /path/to/docling-venv/bin/python \
  --models /path/to/models
```

`--engines baseline` runs without Docling. `--engines docling` runs only the
optional provider. Each engine/page runs in a fresh subprocess. Offline Hugging
Face/Transformers environment flags are set; CPU thread count is two. Production
`convert_docling_pdf` is used, not a separate mock converter. Expected hashes come
from `numeric-corpus.json`. `docling-corpus-layout.json` contains approximate
**AI visual inspection guides**, explicitly not human ground truth. The original
page pixels, panel labels, captions and existing selected crops were inspected
before conversion.

Outputs preserve:

- PDFium original page/region text and native character boxes (bottom-left PDF
  points); full-page and selected-region Tesseract raw TSV, scores and pixel boxes.
- Original page and region renderings, plus the original PDF SHA-256.
- Docling raw export, original bboxes/origins, text, picture-caption references,
  child references, mapped anchors or unresolved reasons, engine/model versions.
- Per-process logs, timing, peak RSS and a geometry-only guide-overlap report.

A geometric overlap score is not an axis/series/caption correctness score.
`completed` means the conversion returned, not that its text or relationships
are correct. Child refs may include captions and junk OCR, not only useful labels.

## Actual configuration and timing

Docling 2.146.0, official Heron revision
`8f39ad3c0b4c58e9c2d2c84a38465abf757272d8`, CPU two threads, full-page
Tesseract 5.5.0 English, OCR scale 3 (216 PDF pixels/inch). Table structure and
picture enrichment were disabled. The production baseline uses PDFium plus
Tesseract 5.5.0 English, 300 dpi and PSM 6. Thus this is a comparison of the
configured pipelines, **not an isolated equal-OCR-configuration model contest**.

| Original and PDF page | Baseline region / full-page seconds | Baseline total seconds | Docling conversion / total seconds | Process peak RSS: baseline / Docling MiB |
|---|---:|---:|---:|---:|
| TN-2825, p28 | 0.779 / 0.910 | 1.788 | 5.073 / 8.198 | 43.9 / 924.6 |
| TM-768, p17 | 0.271 / 2.072 | 2.428 | 7.509 / 10.911 | 38.2 / 854.4 |
| TM-842, p67 | 0.646 / 1.951 | 2.755 | 6.139 / 9.077 | 56.0 / 945.4 |

Totals include imports, whole-PDF page inspection, selected-page conversion and
result preparation. Baseline totals include **two** OCR passes: regional and full
page. Docling conversion excludes imports/inspection. All are one local run per
input; filesystem/model caches may already be warm, and these are not performance
percentiles or guarantees. Peak RSS is the isolated Python process's Linux
high-water mark, not simultaneous process-tree/GPU memory or a configured cap.
Separate child high-water marks are retained in JSON and must not be added to
parent peaks (forked children can inherit the parent's footprint).

## Findings against the original pixels

### TN-2825 p28, figure 10

Baseline gives selectable archival text and OCR boxes, with **no automatic
picture-caption or child-text relationships**. Full-page OCR reads the caption
fairly well, but its figure number is `Figure /0` and chart numerics remain noisy.

Docling finds one picture (`#/pictures/0`), approximately covering the selected
figure (IoU 0.916 with the approximate visual guide), and links caption
`#/texts/3` containing the correct Figure 10 description. There are 128 child
references including that caption; useful labels such as Upper/Lower surface are
split into text items alongside garbage. This is useful structural evidence, not
correct numeric extraction: a visible `.8` tick is returned as `8`, for example.

### TM-768 p17, selected panel 5a

The page visibly has 12 panels, two six-panel groups, individual panel labels and
two shared group captions. Baseline full-page OCR retains readable panel/group
caption fragments, but supplies no layout relationships.

Docling merges all panels into **one large picture**, not separate panels or
six-panel groups. Selected-panel guide IoU is only 0.064 (group guides each
approximately 0.441). The picture has **zero explicit caption references** and
465 child references. Two child items are labelled caption, but their OCR is
largely unreadable/reversed-looking, including the group caption near the page
bottom. A caption-labelled child is not the same as a confirmed caption link.
This is a real failure for panel 5a localization and reliable figure-caption
association; no automated reading of its scientific multipliers is established.

### TM-842 p67, selected figure 11

The page's spatial order is figures **10, 12, 11**, not numerical order. Baseline
full-page OCR retains a mostly readable Figure 11 caption (with errors such as
`Bheoretical`), but supplies no figure grouping.

Docling finds three pictures in the expected spatial positions and assigns each
an explicit caption reference at the corresponding caption location. Selected
figure 11 is `#/pictures/2`, caption `#/texts/225`, with 17 child references
including the caption. However, **all three caption strings are badly garbled**;
geometry alone does not confirm their meaning. The selected curve-label text is
also inadequate for reliable numerical interpretation.

The initial mapper left all page-67 anchors unresolved (`page-size-mismatch`):
Docling exported 621.359×798.96 points while PDFium reported approximately
621.359008789×798.960021973. The corrected production mapper requires exact
float32 equivalence to PDFium's source dimensions; it does not use an arbitrary
numeric tolerance. Both exported/source dimensions and the equivalence decision
are retained. The final three-page run reported here uses that correction; all three picture
anchors on p67 now bind to the original version, with `float32-equivalent`
recorded for the page. Initial raw
exports remain available separately; they were not rewritten to conceal failure.

### Rejected alternate backend experiment

A separate scratch experiment used Docling's official `PyPdfiumDocumentBackend`
on the original p17 and p67. It gave exactly matching p67 page dimensions and
made the p17 group-6 caption more readable, but did not separate the 12 panels.
More importantly, on p67 it linked bottom figure 11 to **figure 12's caption**
above it, while the true Figure 11 caption remained unlinked. Figure 12 itself
had no explicit caption link. Caption OCR remained badly garbled. This is a
measured association regression, so production retained the default DoclingParse
backend; only the justified dimension-equivalence handling changed. A backend
that aligns coordinates is not thereby a more accurate caption reader.

## What this establishes

All three originals were actually converted. Docling can add useful layout
relationships on simple/three-panel pages, while the dense 12-panel scan fails
and OCR remains a separate, serious quality limitation. The baseline remains
valuable because its native text is preserved and some of its caption OCR is
better here. Neither provider output should overwrite the other or become an
admitted scientific number merely because a picture or caption relation exists.
The replayable AI-labelled numeric reference demo remains a separate wiring test,
not evidence that Docling reproduced or independently verified its value.
