# Data

Browse datasets and inspect the selected file. Data is a first-level entry after
Insights and also the entry of `products/data/product.json`. It does not depend
on Data Agent.

## Use

The page is a dataset browser: a search field, a table, and a preview of the
selected file.

- Sample files are synthetic servo measurements, so the preview has records and a chart.
- **Add data** parses CSV, TSV, JSON, or JSONL in the browser, up to **5 MiB** and
  10,000 records. Added files stay in the browser tab.
- Search matches names, types, sources, descriptions, and field names. The preview
  shows records, fields, source, and format, plus a chart when the file has a
  numeric series. Missing values stay visible in the row view.

The Python backend still serves the catalog import and pinned-source download API.
This page does not call it.

The backend stores immutable file copies under `PERO_APP_DATA/files` and atomically
updates `catalog.json`. Metadata is App-private, not project-isolated. The standalone
Product uses its own profile: its catalog is **not automatically shared** with Pero.
There is no external cache scan, automatic import, startup download or remote sync.

## Sources and checks

| File | Pinned size | License | Integrity metadata |
| --- | ---: | --- | --- |
| [Norman 2019 / scPerturb v1.0](https://zenodo.org/records/7041849) | 698,680,199 bytes | CC-BY-4.0 | Publisher MD5; additionally a locally observed SHA256 from 2026-10-30 (not a publisher SHA256) |
| [MACE MP-0b2 small](https://huggingface.co/mace-foundations/mace-mp-0) | 67,622,684 bytes | MIT, this repository | LFS SHA256 at commit `e291ace2bfae073c3ebc7ae2f9479a525989baa7` |

Exact URLs, checksums and provenance are in `backend/sources.py`. The pinned
MACE URL was observed by a HEAD-only check redirecting to `us.aws.cdn.hf.co`,
which returned HTTP 200 and the expected 67,622,684-byte Content-Length. That
exact HTTPS host is allowed, not arbitrary CDN subdomains. This metadata check
did not download or hash model bytes. Live Norman availability remains
unverified. Norman metadata
is pinned to the project's existing public scPerturb source record, not its private
cached files. MACE storage makes no compatibility claim. License and integrity
metadata do not establish scientific validity.

Only registered HTTPS URLs and explicit redirect hosts are allowed. One download
runs at a time. Files remain `.part` until exact size and all registered checksums
match; then the catalog records a locally computed SHA256. Failures never publish
an asset. Cancel may wait for the current network read (20-second timeout).
Restart marks an active job interrupted and removes partial files. Retry starts
from zero; there is no Range resume or background retry. Downloads time out after
one hour. No archive extraction is performed.

## Development and validation

Python 3.10+ standard library only. The Host owns the backend process, App token
and data directory; direct backend requests require `X-Pero-App-Token`.

```sh
npm --prefix apps/data run typecheck
npm --prefix apps/data run test:ui
python3 -m unittest discover -s apps/data/test -v
npm --prefix apps/data run build
```

Backend tests use temporary directories, in-memory download streams and loopback
HTTP only. They never fetch the real dataset/model or call an AI provider. The
standalone Product requests bundled Python; that declaration does not constitute
signed macOS/Windows package acceptance. Full Host/navigation builds require Rust
and the normal project toolchain. No Agent permissions are requested in this MVP.

Hosted Linux CI also runs `node tests/e2e/data.mjs` in an isolated display with the
real development Desktop/Host/backend. The page shows the sample library, search,
and preview, and adds a tiny CSV in the browser. The catalog stays empty: the page
does not call `/api/import` or download a source. The run captures light/dark
screenshots, checks the narrow layout, and confirms a restart shows the sample
library again. Synthetic download unit tests are separate evidence, not live
Zenodo/Hugging Face acceptance. The receipt and screenshots are uploaded under
`test-results/data/`; a configured test is not a claim it has passed before the
hosted run completes.

The separate `tests/e2e/data-product.mjs` hosted smoke stages the actual Data App,
Host and standalone shell. It opens Data directly and adds a tiny CSV in the
browser. That file is not written to the catalog, so a restart shows the sample
library again. Only its disposable product manifest uses `python: system`;
`products/data/product.json` remains `python: bundled`. Receipts and screenshots
under `test-results/data-product/` establish development-shell behavior, not
bundled Python, signed installer or live-source acceptance.
