# Data Workspace P0 + P1 — verification record

Issue: #105. Implementation base: `78881615e37790b0a0b4635a197e18f974ea6867`.
Recorded: 2026-11-02. This record separates executed checks from required acceptance.

## Implemented boundary

The independent Data App reads/writes the existing Host-authenticated catalog.
Logical datasets reference immutable existing asset identities. Schema-2 metadata
and the legacy backup remain inside that owner; the downloader and Paper handoff
are not replaced. Bounded CSV/TSV inspection adapts into the existing exact-value
core; JSON/JSONL and typed filtering reuse that core. Views freeze input identity,
SHA-256, parser, columns/filter/units and a full-input report.

Project references are organizational strings, not Host directory lookups or
permissions. Archive retains bytes. Local import and inspection remain bounded
at 10 MiB; downloaded opaque/larger assets are still catalogued. Pagination is a
bounded response over an in-memory admitted file, not streaming large-data support.
Data Agent, new Agent tools, Run/Compute integration, live scientific validation,
remote storage and signed-product acceptance are outside this increment.

## Executed locally

A partial checkout was reconstructed from the base's fetched sources. The shared
parser and unchanged downloader/source modules matched their Git blob hashes:

| File | Baseline blob |
| --- | --- |
| `harness/go/charts/python/dataset.py` | `e02840435ebb70105295697e6fb0cd87bfcf4332` |
| `apps/data/backend/downloads.py` | `1c00ebaa74edc44b3a2eb44062e06b56c1d9df07` |
| `apps/data/backend/sources.py` | `41007d9699ca14e8e3ca5fc78bbfb59df7561560` |

- `python -m unittest discover -s apps/data/test -p test_workspace.py -v`:
  **22 passed**. Covers exact JSON tokens, literal CSV IDs and source lines,
  missing/null/empty/duplicate semantics, bounds, immutable version transitions,
  legacy catalog migration, failed persistence, archive/restore, project references,
  saved-view reopening, byte modification/missing files, scoped version references,
  actual existing downloader publication with tiny in-memory transport, authenticated
  loopback HTTP, and an independent temporary installed-App layout with packaged
  shared core and no Data Agent/source checkout dependency.
- `node --experimental-strip-types --test apps/data/test/model.test.ts`:
  **4 passed** on Node 22.16.0. Catalog filters, exact-version selection preservation,
  opaque byte encoding across a chunk boundary, and non-verification status wording.
- TypeScript `transpileModule` syntax checks of the four changed `.ts/.tsx` modules:
  no diagnostics. **This is not strict TypeScript checking, bundling or UI execution.**
- `node --check` on the App build script and both modified Desktop journeys: passed.

No tests here used a public dataset/model download, credentials, a model provider,
or the user's machine. Fixtures are authored test data, not scientific evidence.

## Required before acceptance

The following were **not executed in this local environment**: the full pre-existing
Data regression suite, strict App TypeScript checking, full App/Host builds, real
Workbench/standalone Desktop journeys, visual inspection of their screenshots,
Paper→Host→Data end-to-end regression, and platform/release acceptance. Network and
the repository's normal React/GPUI/Host toolchain were unavailable locally. Do not
substitute the syntax checks or Python fixture results for these gates.

Run the README commands in the normal repository/CI environment. The Desktop tests
now require persisted catalog state and exact bytes after restart; they must not be
changed back to accepting ephemeral imports. Preserve real Electron/Host execution,
App-origin authorization, profile isolation and no-model/no-download boundaries.

Expected receipts: `test-results/data/result.json` and
`test-results/data-product/result.json`. Expected screenshots: `data-light.png`,
`data-dark-narrow.png`, `standalone-data.png`. These paths are planned outputs, not
proof they exist. Record the tested commit and actual CI artifacts before marking
#105 complete or removing draft status. Do not merge based on this local record.
