---
kind: verification_report
date: 2026-10-30
---

# Paper public search verification

Scope: macOS arm64 development build at `eb5a0af`; Paper's selected public
sources and local search UI. Acceptance: L2 for the single live Hugging Face
search and thumbnail read below; offline Desktop coverage is L1. This does not
establish a signed package or comprehensive provider availability.

The search adapter queried Hugging Face for `Meta-Harness` and returned three
papers with IDs, dates, likes and thumbnail IDs; one result also supplied a
GitHub URL. The real CDN thumbnail for `2603.28052` returned a valid PNG. The
official [Paper Pages documentation](https://huggingface.co/docs/hub/paper-pages)
describes related resources as links associated with a paper, not necessarily
author-provided implementations.

The complete Python suite passed 29 tests, including source aggregation,
deduplication, ordering, missing metrics, authenticated thumbnail access and
failure cases. TypeScript and root `npm run check` passed. The actual Electron
journey passed all 16 groups in an isolated checkout of the committed changes:
search metadata and sorting, same-origin thumbnail success and failure, light
and dark narrow layouts, and existing Paper reading, reports and restart.
The image error and invalid-input responses recorded in the result are expected.

`test-results/paper-search-ui/result.json` and the light and dark PNGs in the
same directory retain the local fixture evidence. The images and test data are
synthetic. An initial test in the shared worktree was interrupted by an unrelated
in-progress Paper list change; the isolated checkout excludes that change. Its
first launch also exposed reader assets copied as symlinks, which the App
installer rejects. Replacing those links with actual files restored the intended
test environment before the successful run.

Default all-source ordering places Hugging Face first; newest and citation
ordering applies to the returned, deduplicated candidates. Missing citations
and dates sort last. Citation counts, likes and stars have distinct sources and
are not combined into a quality score. The image is the provider's social
thumbnail and may not be a figure from the paper.
