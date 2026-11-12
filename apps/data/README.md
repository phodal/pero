# Data

The dataset and model browser in the Workbench sidebar and
`products/data/product.json`. Data owns the only catalog. Table, field, chart,
and Ask Agent actions run on the selected dataset version. An Agent session is
optional; inspection does not call a model.

## Use

**Add data** stores the original file bytes in the Host-managed Data directory.
Choose a file, review its type/source/license/project reference, then press
**Import**. Imports are limited to **10 MiB**. Files and metadata survive restart;
there are no automatically populated demo assets or downloads.

The list supports search, explicit project-reference filters and archived items.
Each row shows the name, kind (Dataset or Model), size of the selected or latest
version, and version count. A present file shows its project reference, or
Unassigned when it has none. Missing and Changed stay on the row because those
files need attention. Stored is not repeated for a healthy file.
The detail header shows the dataset name, format, and the next action: Explore data
for a tabular file, and Ask Agent. Edit, Add version, and Archive are in More.
A summary row shows size, type, version count, the selected version's admission
date, source, and availability. Record and field counts appear after a successful
inspection. Checksums, revision, license, and the exact custody wording stay under
Provenance. A completed download is not kept as a status strip. **Table** is one page of
the full inspection of the admitted file. Switching versions keeps the current tab.
**Add version** appends a file to the selected logical dataset;
existing bytes and IDs do not change. A normal import creates a separate dataset,
even when its filename matches. Repeated explicit imports create separate files
or versions, not automatic content deduplication.

A project reference is editable organizational metadata, **not** a Host-validated
project identity, tenant boundary or access grant. Archiving hides a dataset and
is reversible; it retains originals, saved views and download receipts and **does
not free disk space**. Products retain separate profiles; standalone and Workbench
catalogs are not automatically shared.

### Inspection and saved views

- UTF-8 CSV, TSV, JSON and JSONL/NDJSON support deterministic inspection without an
  LLM. The backend checks the selected file against its stored size and SHA-256
  before parsing; missing or changed originals do not use a cached preview.
- Inspection is bounded to 10 MiB, 100,000 records and 256 fields. It reads the
  whole admitted input, then returns pages of 50 records (API maximum 200) and at
  most 32 selected fields. This is **not** an out-of-core or GB-scale reader.
- CSV/TSV values remain text, including identifiers such as `001`; empty cells
  remain empty strings. There is no inferred numeric conversion or unit guessing.
  In **Fields**, **Preview number** checks a decimal interpretation over the full
  input and shows source-row examples and conversion failures. **Apply type** is
  explicit; **Cancel** leaves the analysis unchanged. Signed decimal/exponent
  notation is accepted, without trimming whitespace or guessing locale, currency
  or thousands separators. Failed and empty values retain their text, never zero
  or null. Original files and displayed leading zeros are unchanged. **Revert to
  text** removes the interpretation. Numeric filtering on uninterpreted text is
  an error, not a successful empty result. Valid numeric filters exclude failed
  values, which stay visible in the full-input conversion checks.
  JSON uses the existing shared exact-value core: numbers retain their original
  tokens, and missing fields, explicit `null`, and empty strings stay distinct.
- Fields and Checks report the full input, even when Preview is filtered. Exact
  duplicate counts include all admitted rows; the first ten duplicate examples
  retain original row/source-line locations. These checks do not establish
  scientific validity. Parse errors and exceeded bounds are explicit; no partial
  sample is represented as a full report.
  **Show issues** opens all matching issue rows, explicitly pausing the table
  filter and selection; **Return to analysis** restores them. Missing, null,
  empty and conversion counts are cells, so several cells may belong to one
  issue row. Duplicate counts and drilldown include repeated rows after the first
  occurrence. Row identities and source lines do not change with sorting or
  pagination. The API can additionally intersect an issue condition with a filter.
- Units are user-supplied view labels, not conversions. **Save view** freezes the
  columns, filter, sort, selection, chart choice, explicit interpretations, issue
  condition and units, plus the exact asset
  ID, SHA-256, parser version and check report. A catalog written by an older
  build stores only columns, a contains-filter and units. That shape is read as
  operator `contains` with no sort, selection or chart. The next successful
  mutation writes schema 3 and, once, `catalog.v2.backup.json`. Opening a saved view
  from Overview reopens that input and rechecks current bytes. **Export reference** exports a JSON
  reference and report, not original files or a runnable experiment. Historical
  reports remain readable if the current original becomes unavailable.
  Saved issue views reopen the issue condition; the transient return-to-analysis
  navigation is not saved. New versions start with no inherited interpretation.
- **Chart** is available only after inspection is `ok`. It uses the same matching
  records or explicit selection, up to 2,000 rows, and reports an error instead of
  drawing a partial chart as complete. Saved chart documents live under `charts/`
  beside the catalog, addressed by content digest, and are not rows in `catalog.json`.
  **Source**, **Export records** and **Ask Agent** use that same version. Ask Agent
  attaches the catalog dataset id, asset id, SHA-256 and view id. Embedded chat is
  the host conversation slot. There is no Run or Compute handoff and no host query
  language.
  Record exports contain interpreted numeric values and unchanged failed strings;
  their manifest includes the interpretation, parser and full-input report. Source
  remains the immutable original. Charts retain the Data view and conversion
  report alongside their existing exact-value and excluded-value evidence.
- Unsupported formats, including opaque model weights, remain stored and listed.
  Model files are not parsed, charted, or sent to the agent as rows. No
  deserialization, inference, extraction or execution occurs. Larger existing
  downloads remain catalogued but exceed inspection limits. **Stored** describes
  presence/size, not a fresh digest or scientific check; **Bytes matched** applies
  to the successful bounded inspection of the selected file.

Older Data Agent directories (`*.source`, `*.meta.json`) are not imported and are
not a second catalog. Examples under `test/fixtures/` are test data only; the
user's catalog is not auto-populated.

## Storage and compatibility

Data owns `PERO_APP_DATA/files` and `catalog.json`. Schema version 3 stores existing
asset records, logical dataset version references and saved views in one atomic
metadata envelope. Asset ids are unchanged across schema 1, 2 and 3. Legacy list
catalogs remain readable with stable asset IDs and Paper `bundleId`/`sourceId`
references. The first successful mutation of a list saves it as
`catalog.v1.backup.json`. The first successful mutation of a schema 2 catalog
saves it as `catalog.v2.backup.json`. Unsupported catalog schemas fail without
overwriting the original. Do not run an older App against a migrated catalog;
back up the whole Data directory before a manual downgrade.

The existing downloader remains the sole owner of source downloads. Local imports
and Paper-authorized downloads enter the same catalog. Metadata failures do not
publish a successful import or mutate an old version. No filesystem scan, remote
sync, background retry, destructive garbage collection or second catalog is added.

## Sources and downloads

| File | Pinned size | License | Integrity metadata |
| --- | ---: | --- | --- |
| [Norman 2019 / scPerturb v1.0](https://zenodo.org/records/7041849) | 698,680,199 bytes | CC-BY-4.0 | Publisher MD5; separately labelled locally observed SHA256 |
| [MACE MP-0b2 small](https://huggingface.co/mace-foundations/mace-mp-0) | 67,622,684 bytes | MIT, this repository | LFS SHA256 at commit `e291ace2bfae073c3ebc7ae2f9479a525989baa7` |

Exact URLs, checksums and provenance remain in `backend/sources.py`. The historical
MACE HEAD check was not a full-file download/hash; live Norman availability was
not established. This implementation performs no new live availability or model
compatibility validation. Licensing metadata alone is not authorization.

**Add data → Public sources** exposes the fixed sources for explicit download.
Only registered HTTPS URLs and trusted redirect hosts are admitted. One download
runs at a time; `.part` files publish only after exact size and registered checksums
match. Progress, cancel and terminal errors use the existing worker. Restart marks
an active job interrupted; retry starts from zero. There is no Range resume or
startup retry. Cancel can wait for a network read, with the existing 20-second
read timeout; a download is bounded to one hour.

### Research files from Paper

Paper hands off explicitly confirmed files through the Host's fixed
`research-assets` operation. Data still admits only public Hugging Face model or
dataset files at a 40-character commit with exact size, LFS SHA-256 and known
license. Source, revision, approved bundle/file IDs, job and catalog asset form the
receipt. Private locations and temporary signed CDN URLs are not returned to Paper.

The same worker and `.part`/atomic-publication rules apply. Status and cancel remain
scoped to the approved bundle/file. The existing pinned-source reuse/retry behavior
is unchanged. Publication reuses the verified streamed SHA-256, not a second full
file read under the catalog lock. No Paper PDF/TeX ownership is moved into Data.

## Development and verification

Python 3.10+ standard library only. Host supplies the backend process, private
App token and data directory. The App build packages the shared
`harness/go/charts/python` modules `dataset.py`, `view.py` and `chart_document.py`
under `backend/_core`. Generated copies are not committed. Conversation
`chart_render` stays in the harness and does not open this App.

```sh
python3 -m unittest discover -s apps/data/test -v
npm --prefix apps/data run test:ui
npm --prefix apps/data run test:browser
npm --prefix apps/data run typecheck
npm --prefix apps/data run build
node tests/e2e/data.mjs
node tests/e2e/data-product.mjs
```

The two Desktop suites use disposable profiles and authored tiny data. They verify
real import requests, persisted identities/bytes and restart, without downloading
upstream data or calling models. The Workbench journey also exercises version
history, saved checks, pagination, project references, archive/restore and changed
originals. Screenshots/receipts belong under `test-results/data/` and
`test-results/data-product/`, not in source control. A configured test is not a
claim it has run. Executed evidence and remaining gates are recorded in
[Data Workspace verification](../../docs/fitness/data-workspace.md).

The browser regression bundles the real Data frame and App SDK with synthetic,
loopback HTTP responses. It delays inspection replies to check keyboard focus,
unit drafts, current field selections, version isolation and failure clearing.
Install Chromium with `npx playwright install --with-deps chromium`, or set
`PERO_CHROMIUM_EXECUTABLE` to an available browser. This is not a Host authorization,
persistence or full Desktop test; those remain in the two Desktop suites above.

`test/workflow-browser.mjs` also runs the real Python catalog and Data frame over
loopback, replacing only Host transport with an authenticated test proxy. It
checks explicit interpretation/cancel, failure and duplicate navigation, exact
numeric filtering/sorting, source/export/chart consistency, backend restart,
version isolation and changed-original recovery. Its light/dark/narrow screenshots
and bundle identities are under `test-results/data-workflow/`. This is not a
Workbench, Host permission, standalone packaging or scientific-validity test.
