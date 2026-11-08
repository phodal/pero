# Notebook verification

Local development verification on 2026-11-08, from
`8b4906e1` with the Notebook changes on `codex/notebook-blocks`.
The App appears in the Workbench. The package and its backend use isolated
test data.

| Check | Evidence |
| --- | --- |
| Formula and workbook | `npm run test:notebook` covers recalculation, named worksheets, errors and cross-sheet cycles, worksheet renaming, lookup and linear regression, relative and absolute fill, XLSX formula source and literal types, and out-of-bounds import. |
| Persistence and Agent writes | The backend test covers immutable SQLite revisions, competing saves, scoped reads, atomic edit batches, and retention of cell units and evidence. It rejects a mismatched Paper reference and changed values in a Control Lab receipt. An isolated installed App also passed through the existing Desktop write adapter and Pero Host. |
| Owner evidence import | The parser tests read exports produced by the actual Paper and Control Lab stores. Paper uses a synthetic PDF. Control Lab uses a deterministic solver fixture. The tests check exact quotes, stored trial and observation identity, check values and digests, and reject altered source data. |
| Browser App | `npm --prefix apps/notebook run test:browser` uses built App files and the real Python backend. It imports and renames a worksheet, verifies dependent formulas still calculate, imports both owner exports, links them to a Finding, saves, reloads and exports. It also verifies stale-draft recovery and immutable history. |
| macOS development Electron | `npm run test:notebook:desktop` opens Notebook via the Workbench, enters and recalculates a formula, saves through the Host, and attaches the saved revision to the shared Chat draft. The light Desktop and narrow dark browser layouts were inspected. |
| Source reopening in Electron | With `PERO_NOTEBOOK_OWNER_FIXTURES=1` and the pinned App dependencies, the test imports owner-generated reports, opens the PDF on page 2 at the selected quote, and opens Control Lab on the exact saved trial. The report and trial IDs match the exported receipt. Both screenshots were inspected. |

The screenshots are local test output in `test-results/notebook/`. The browser
and Electron flows use fixture inputs. Source opening was compiled for Native
GPUI. Live Agent execution, physical validation, packaged distributions, and
running the Native GPUI surface were outside this verification.
