---
kind: verification_report
status: complete
github_issue: 180
github_state: open
github_url: https://github.com/phodal/pero/issues/180
---

# Notebook candidate evaluation cards

Observed 2026-11-11 on macOS 27.2 arm64, base `5072cbc6`. This completes the
selection experiment after the [initial PoC](notebook-runtime-poc.md). Decision:
[ADR-0033](../adr/0033-notebook-interop-and-computation.md). P0 is the existing Lab
Notebook and three computational candidates; other surveyed projects remain
references. Cards use the same seven dimensions, without subjective scores.

## Existing Pero Lab Notebook — directly usable

| Dimension | Observed result / boundary |
| --- | --- |
| Upstream / license / security | Existing React 19.2.8/Tiptap 3.33.0 implementation. Actual `@tiptap/core/LICENSE.md` is MIT. App package lock/npm CycloneDX inventory retained; npm audit reports zero advisories among 61 dependencies. Paid extensions and other Pero dependencies are outside this observation. |
| Engineering cost | Reuses Entry revisions, App SDK, actual Rust Host and Python owners. No extra runtime/UI framework. Notebook core/transport tests: 11 pass; build/typecheck pass. |
| Notebook semantics | Existing typed blocks, parameters, procedures, sources, `.ipynb` recorded documents and JSON exchange. Interop v0 projects saved state rather than copying domain state. |
| Execution / safety | Notebook has no execute/cancel capability. Existing Canvas uses Host approval and Control Lab execution. Changed inputs invalidate the binding; a new binding creates a new frozen experiment. |
| AI control | Existing read-entry/apply-edits, baseRevision and reference proposals remain the mutation/review routes. New describe-notebook is authenticated App data, not a second Agent. |
| Scientific trust | Real Paper → parameters → Control solver/verifier → PASS/FAIL → original Finding preserved → Project link. Scientific/human acceptance remains not assessed. |
| Pero boundary | Keep the Lab Notebook App; Paper, Data, Control Lab, Project and environment owners stay authoritative. Other Notebook representations need independent lifecycles to justify new Apps. |

## marimo — reusable standalone reactive runtime, not selected as default

| Dimension | Observed result / boundary |
| --- | --- |
| Upstream / license / security | 0.25.2, `b0e402345e0a0c0731e745c8e1183ef0840804b2`, release 2026-10-19. Pinned root LICENSE inspected: Apache-2.0; root NOTICE absent. Wheel license files/RECORD hashes inventoried. Updated combined comparison environment: 68 packages, no PyPI version-advisory matches after remediation below. |
| Engineering cost | Actual Python service and Chromium editor. Combined environment about 240 MiB logical size, including Jupyter comparison modules; not marimo's incremental package cost. Service readiness 1.97 s; process-tree RSS 158.4 MiB. No Pero iframe/packaging bridge. |
| Notebook semantics | Native `.py` DAG. Same CSV displays expected table in the actual editor; run-stale shortcut/reload pass. CLI relocation and both `.py`/`.ipynb` conversions pass for the linear fixture. Conversions are derived artifacts, not universal lossless archival. |
| Execution / safety | Authored exception and recovery pass. CLI SIGINT still needs SIGKILL after 10 s; this does not establish interactive cell cancellation. Loopback service, ordinary process privileges, no untrusted-notebook sandbox acceptance. |
| AI control | No native AI provider configured. Upstream would own the DAG/editor; Host grants cannot be inferred from native editor actions. |
| Scientific trust | Frozen input/source/environment/result receipts; changed input lives separately. Existing Pero importer retains old output and marks edits stale. Completion does not confer scientific acceptance. |
| Pero boundary | Retain for a concrete reactive-App requirement. Reject default migration: lifecycle/offline assets/authority need an explicit seam. Earlier default HTML was blank with CDN requests blocked, while plain table HTML remained usable. |

## JupyterLab + AI — reuse file/kernel modules, not the default full stack

| Dimension | Observed result / boundary |
| --- | --- |
| Upstream / license / security | Lab v4.6.6 / `8d57791d0254820dfa4a540e010105803e128bcd` (release 2026-11-06); AI v3.2.0 / `995b53b651c39bf9a7744bfe0d2d85b0967b672c` (dereferenced annotated tag). Both root LICENSE files: BSD-3-Clause; root NOTICE absent. Resolved lock: 158 distributions, including Server MCP 0.3.0 and ACP client 0.3.4; no PyPI advisory matches after remediation. |
| Engineering cost | Actual Lab Server/Contents REST, kernel WebSocket, saved notebook and Chromium Notebook/Jupyter Chat UI. About 245 MiB logical environment. Final readiness 1.60 s, complete probe 10.80 s, process-tree RSS 215.3 MiB. |
| Notebook semantics | Exact sources, execution counts and outputs survive Contents save/read. Same CSV computes 2/4 mg/L. Error/interrupt/restart/fresh recomputation pass. Existing nbformat/nbclient tests also exercise inert Pero import. |
| Execution / safety | Isolated config/data/runtime, ephemeral loopback ports and temporary Jupyter token. Interrupt reaches idle; restart re-executes from fresh state. Venv is not an OS sandbox. |
| AI control | Real MCP initialize/list-tools returns 17 tools without a Jupyter token. Its separate port/host-origin policy sits outside Server token/XSRF protection. No ACP Agent/model request or Host bridge was exercised. |
| Scientific trust | Execution, fixture equality and acceptance recorded separately. Native save is not a Pero verification receipt. A future adapter must freeze inputs/environment and use existing Task/Run/artifact owners. |
| Pero boundary | Select Jupyter format/kernel modules for concrete compatibility requirements. Existing Science Kernel stays the execution owner today. Full Lab/AI/MCP default installation is rejected because it adds UI/Agent authority without a product requirement. |

## nteract — working native protocol and architecture reference, not default deployment

| Dimension | Observed result / boundary |
| --- | --- |
| Upstream / license / security | `v2.9.0-stable.202610230557`, `9c85319021bdcd4b03bdfe010ccb4bbc4dc8ed57`, release 2026-10-23. Root and both nested Wasm LICENSE files: BSD-3-Clause; root NOTICE absent. Release asset list has no named SBOM. Cargo-lock inventory: 1,116 packages; 1,072 registry versions queried; 55 matched versions/101 advisory IDs. IDs include aliases and maintenance advisories, not 101 proven reachable binary vulnerabilities. |
| Engineering cost | Official arm64 `runt` 21,023,744 bytes + `runtimed` 39,458,016 bytes; custom cache about 823 MiB logical size. Native create/read/mutate/execute/save/results/interrupt/restart exercised. Kernel-ready wait 1.58 s after create returned; process-tree RSS 190.4 MiB with one pool slot. GUI/Tauri embedding unverified. |
| Notebook semantics | Same result digest; real `.ipynb` save and fresh-client reconnect by Notebook ID. Mutation reformats source: exact text differs, AST/result match. Preserve original source separately for archival. Concurrent human/Agent merge semantics were not tested. |
| Execution / safety | Zero UV pool failed preparation; one slot/restart recovered. Real ValueError retains old result; an observed running marker precedes interrupt; completed error/KeyboardInterrupt retained; restart recomputes equal result. Foreground daemon/custom socket/cache/blob paths only; owned PID stopped, no user service installed. |
| AI control | Official CLI uses native tool schemas/structured results and reconnect-specific handles. No remote service/model/Host bridge. Native mutation/execute permission is not a Pero Host grant. |
| Scientific trust | Actual automatic environment: Python 3.13.7, 60 distributions, no PyPI advisory matches. It differs from Python 3.12.11 in other probes and resolves default packages automatically. Environment is observed, not a frozen Pero binding or independent verifier. |
| Pero boundary | Learn from one daemon/document mutation chain and receipts. Reject default daemon/environment pool adoption. Binary-specific advisory triage and explicit Host lifecycle/authority precede any future deployment proposal. |

## License and security evidence

`upstream_inventory.py` fetches pinned official LICENSE/NOTICE files and records
hashes. Python SBOMs record distribution versions, RECORD hashes and hashes of
license/NOTICE/COPYING files, including bundled files when present. These are
inventories, not full build/dependency-graph attestations. Root licenses do not
clear bundled JS, fonts, scientific assets or proprietary extensions. No upstream
source/binary is vendored by this change.

Old nbconvert 7.17.0 matched CVE-2026-39378 (image-embedding file read),
CVE-2026-39377 (attachment path write), and CVE-2026-6658 (Mermaid HTML output).
Upstream names 7.17.1 as patched for [file read](https://github.com/jupyter/nbconvert/security/advisories/GHSA-7jqv-fw35-gmx9)
and [file write](https://github.com/jupyter/nbconvert/security/advisories/GHSA-4c99-qj7h-p3vg).
The [PyPI 7.17.1 record](https://pypi.org/pypi/nbconvert/7.17.1/json) returned no
advisories. The requirements were updated and full comparison/native Lab probes
rerun; old evidence was retained. No-match does not mean complete security clearance.

nteract source-lock matches include `rmcp`, `tauri`, archive libraries and
maintenance notices. Full IDs are retained in OSV results. Mapping each match to
compiled binary/feature/OS remains unperformed: default distribution is therefore
explicitly rejected. That is a selection outcome, not a deployment acceptance.

## Actual measurements and cross-App acceptance

Single observations on warm disk/network caches, with different boundaries:
marimo readiness includes browser launch; nteract wait excludes daemon startup
and create latency. RSS is one root/descendant `ps` sample, may double-count shared
pages, excludes Chromium and is not peak memory. `du` counts linked caches.
These values establish working paths, not a speed ranking or package-size promise.

The existing Canvas scenario was extended, not duplicated: original PID chapter
→ real Paper PDF/citation → Notebook parameters → PI 8 s PASS / 2 s FAIL → unchanged
Finding → persisted Host Project reference. Old revision 3 remains readable after
head revision 6 and Host restart; its descriptor digest/references are unchanged.
Original Paper file/page and original Control trial/report resolve in their owners.
The chapter motivates an authored PI golden check, not book reproduction.

Source: [Åström/Murray PID chapter, 28Sep12](https://www.cds.caltech.edu/~murray/books/AM08/pdf/am08-pid_28Sep12.pdf),
SHA-256 `bc4212db9b7d3381bde55727d5d7e4cbcb9ab9bf4dcf5adbde841b5d25221588`.
Only a short exact passage is cited. CI uses the existing synthetic PDF;
`PERO_NOTEBOOK_INTEROP_PDF` selects the original file for the same scenario.

Original-source flow: 35.8 s. Both offline Canvas tests: 33.6 s. Coordinating agent
independently reran both with the original PDF: 2/2 pass in 29.7 s. Existing
`control.timeresp` matrix RuntimeWarnings remain in logs; this does not fix them
or establish scientific validity. Inspected light-theme Chromium screenshots show
the linked Project revision and read-only original source/PASS. Shell confirmation
callbacks are test-driven. Native, packaged Electron, dark theme and other OSes
are not newly verified.

After screenshot review, the historical view now waits for the actual 8 s /
1001-sample read-only Canvas, asserts no loading/alert, and reopens the original
trial/report after restart. This strengthened original-source scenario passed in
46.7 s (47.2 s including runner); its final screenshot was visually inspected.

## Evidence ledger

Root: `/Users/phodal/workspaces/pero-notebook-interop-180/test-results/notebook-interop/`.
[Rerun commands](../../experiments/notebook-runtime/SERVICES.md).

| Evidence | Scope |
| --- | --- |
| `original-source-crossflow-final/` | Final original-source receipt and inspected fully loaded Project/old-revision screenshots |
| `crossflow-final-2.log`, `canvas-offline.log`, `host-binary.sha256` | Runs and copied Host identity |
| `jupyter-mcp-final/` | Final Lab+AI/MCP receipt, schemas, screenshots, redacted logs |
| `marimo-native-final/`, `nteract-native-final/` | Native service/protocol receipts, RSS and actual environment |
| `comparison-final/` | Remediated CLI conversion/error/cancel/recovery receipts |
| `jupyter-inventory-final/`, `comparison-inventory-final/`, `nteract-inventory/` | Python CycloneDX inventories, package locks and PyPI advisory responses |
| `upstream-inventory/` | LICENSE/NOTICE hashes/status, Cargo lock/source SBOM and OSV responses |
| `notebook-sbom.cdx.json`, `notebook-audit.json`, `tiptap-license.sha256` | Existing Lab Notebook npm/license observations |
| Earlier numbered runs / old inventories | Harness discovery failures and vulnerable baseline retained |

Normal CI already calls `notebook-canvas.yml`; its test step has a 10-minute cap,
versus under a minute locally. Dependency/Rust preparation is outside this test
budget; the enclosing job remains capped at 20 minutes. Upstream downloads,
advisory scans, other OSes and model evaluations are opt-in. Remote CI belongs to
integration; no local run is represented as a remote CI pass.
