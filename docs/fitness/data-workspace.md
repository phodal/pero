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
Run/Compute integration, live scientific validation, remote storage and
signed-product acceptance are outside this increment. Chart analysis and Ask
Agent now run on the selected Data catalog version; the standalone Data Agent
app and its digest store are not a second catalog.

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

## Acceptance gaps at initial review

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

## Fields keyboard correction (2026-11-03)

Follow-up to #110 review `discussion_r4449333470`, based on merged master
`f3336eec7b50b4680e408bad962d2a5b19686048`:

- Keep field controls mounted while inspecting a changed view of the same input.
  Pending statistics are explicitly labelled as the last successful inspection.
  Preview rows and Checks still require the current request; switching input,
  parser, integrity metadata or explicit refresh invalidates retained fields.
  A failed inspection clears them. Unit drafts have stable identity; asynchronous
  replies cannot replace a field being edited. Units remain labels, not conversions.
- `npm --prefix apps/data run typecheck`: passed.
- `node --test apps/data/test/model.test.ts`: 4 passed.
- `python3 -m unittest discover -s apps/data/test -p 'test_*.py' -v`: 47 passed
  (2.124 seconds), including authenticated HTTP and immutable input checks.
- `node --test scripts/ci/*.test.mjs`: 42 passed (12.052 seconds).
- The new `test:browser` bundles the real Data React frame and SDK against a
  synthetic loopback API, with explicitly released delayed replies. It covers
  native Tab navigation, continued unit typing across a reply, successive field
  selections, version-switch stale replies, and integrity/transport failures.
  It is included in the existing Data CI job, without a Desktop/GPUI build.

Browser assertions have **not run locally**: Chromium startup was rejected by the
cloud sandbox (`process_singleton_posix.cc`, `socket(): Operation not permitted`),
including one permitted execution retry. No alternate desktop was used and no
screenshots were produced. CI must establish behavioral evidence; successful
bundling and static review are not substitutes. Full App build was also blocked
by absent `PERO_GPUI_KIT_PATH`; strict App type checking above did run. This
follow-up does not establish full Host, standalone or Workbench GUI acceptance.

## macOS Electron acceptance (2026-11-05)

Verified the #110 implementation and this follow-up from master
`68ee694c6ba42e65871b990383cd3fbe4672ff54` on macOS arm64 with disposable
profiles. Rebuilt the Data App, Rust Host, Workbench Wasm/web and Electron shell.
The local GPUI Kit checkout was `944803984cf0ba3111861d6e1aa9d6265c109ff9`.

| Command | Result |
| --- | --- |
| `npm run check` and `npm --prefix apps/data run typecheck` | Passed |
| `python3 -m unittest discover -s apps/data/test -v` | 59 passed, including legacy catalog migration, JSON/JSONL exact values, and source-line errors |
| `npm --prefix apps/data run test:ui` and `npm --prefix apps/data run test:browser` | 4 UI tests and 6 Chromium tests passed, including keyboard focus and retry |
| `go -C harness/go test -race ./charts` | Passed against the shared Python core |
| `node tests/contracts/research-import.mjs` | Passed with installed Paper and Data fixture composition, real Rust Host and Data downloader, synthetic metadata and byte streams |
| `node tests/e2e/data.mjs` | Passed real Electron/Host import, exact bytes and SHA-256, v1/v2 history, pagination, saved reference download, project unlink, archive/restore and restart |
| `node tests/e2e/data-product.mjs` | Passed real Electron/Host import and restart in a separate standalone development profile using system Python |

Workbench also exercised a rejected filter and recovery with units retained, a
same-size byte modification while viewing a saved version, and a malformed JSONL
file that remained stored with its original bytes and reported its physical line
and column. The install contract stages the shared parser, view and chart
modules explicitly. It does not rely on generated files from a prior App build.

Inspected actual Electron light, dark and narrow captures. Local receipts and
screenshots are under `test-results/data/` and `test-results/data-product/`.
The Paper handoff fixture checks consent, verification, scoped cancellation,
receipt reuse and restart without a public download. Linux and Windows Desktop
and bundled or signed product acceptance were not run locally.
