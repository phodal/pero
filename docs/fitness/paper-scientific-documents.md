# Scientific document verification

Issue [#76](https://github.com/phodal/pero/issues/76), draft implementation
[#78](https://github.com/phodal/pero/pull/78). Initial base:
`85453242733bef06b34f210bc22aa00b34291280`. Recorded 2026-11-01.

## Actually executed locally

Environment: Linux x86_64, Python 3.13.5, Chromium 144.0.7559.96.
The workspace contained the new files and exact fetched HTTP baseline, not a full
repository clone. Outbound repository/live-source acquisition was unavailable.

| Check | Observed result | Scope |
| --- | --- | --- |
| `python -m compileall -q apps/paper-agent/backend` | Pass | Syntax of locally present modules |
| `python -m unittest discover -s apps/paper-agent/test -p 'test_scientific_document.py' -v` | 11 passed | Values, math/cells/anchors, integrity, limits, hostile HTML and export |
| `python -m unittest discover -s apps/paper-agent/test -p 'test_paper_documents.py' -v` | 8 passed | Source fixture and explicit in-memory store seam; not disk persistence |
| Manual Chromium renderer, 1280px/light | Pass | Native math, spans, source disclosure, target IDs, no external requests/errors |
| Manual Chromium renderer, 1280px/dark | Pass | Same assertions in dark rendering |
| Manual Chromium renderer, 390px/light | Pass | Same assertions and no document-wide horizontal overflow |

A long SHA-256 value initially overflowed the narrow layout. The renderer now
wraps metadata hashes; the three checks were repeated after the fix. Chromium
navigation to file/loopback URLs was restricted by the environment. The successful
check therefore uses Playwright `set_content` with the generated local HTML.
It verifies rendering and target existence, not actual HTTP navigation, App
embedding, keyboard traversal, Desktop startup or a source-site journey.

Reproduce the explicit renderer test with an already installed Playwright and
Chromium (the script performs no installation or remote downloads):

```sh
python apps/paper-agent/test/manual/scientific_reader.py \
  --browser /path/to/chromium \
  --output /tmp/pero-scientific-reader
```

It writes `reader.html`, `result.json`, and light/dark/narrow PNGs. Images are not
committed. The input is explicitly synthetic; using an arXiv-shaped identifier
in the fixture does not turn it into the actual paper or scientific evidence.

## Executed in GitHub Actions (full checkout)

`test_document_http.py` uses the real ResearchStore, a temporary directory and
an authenticated loopback server; only the remote source is a fixture. It checks
unauthorized requests before acquisition, invalid arguments, offline cached
reads, safe HTML, bounded block reads, immutable source preservation, reload,
failed refresh and unchanged original snapshots/PDF/study collections.

[Run 41284791300](https://github.com/phodal/pero/actions/runs/41284791300)
completed successfully for head `0bebbcae710397f3f4a0f153b2fdd875afb7a269`
(PR merge checkout `62c32c35341d53b66db05c56ecfcaaa821b25d69`). The logs show
Python 3.12.15 on Ubuntu, with the App's pinned PDF dependencies installed.

- Scientific-document suite: 11 tests passed.
- Acquisition/store-seam suite: 8 tests passed.
- Real store/authenticated HTTP/restart suite: 1 test passed.
- Full Paper suite: 68 tests discovered, 67 passed, 1 skipped. The skipped case
  is the existing Windows-only child-process-handle lifecycle check, not a new
  document test. The full suite includes the 20 new tests above.

No paid model or external paper was used by these tests. This is actual backend
persistence/transport regression evidence, not a claim of Desktop or live-source
acceptance. Other repository workflows are independent checks.

## Not verified / not delivered by this slice

No complete App Read/PDF UI, declared structured-reading Agent command, HTML
observations admitted to the research ledger, PDF alignment, image download,
Docling/GROBID adapter, real `2606.03979v2` parse or full Desktop acceptance is
claimed. TypeScript/build, full pre-existing backend regressions and signed
packages were not executed in the partial local workspace. Keep #76 open.

This record provides component-level L0 evidence and a scoped browser-rendering
check; it is not L1 Desktop, L2 live-source/model or L3 release acceptance.
