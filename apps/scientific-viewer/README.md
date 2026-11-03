# Scientific Viewer

Repository-owned Pero App: no Point checkout, SDK, backend or runtime dependency.

The default view shares `packages/molecule-viewer` with the website in `pages/`.
It opens ethanol, with water and benzene alongside it. These are idealized
illustrations, not experiments, optimized structures or AI predictions. Rotation,
keyboard controls, reset, theme and language are shared; there is no automatic
animation. File imports remain available in the compact toolbar, with provenance
and local-copy actions under the expandable source status. The unverified state stays visible.

```
npm ci --prefix apps/scientific-viewer --ignore-scripts
node scripts/build/scientific-viewer.mjs
npm test --prefix apps/scientific-viewer
npm run typecheck --prefix apps/scientific-viewer
```

User-selected files persist in this App's IndexedDB profile: 10 MiB per file,
50 MiB library. Clearing the profile removes them. Removing a local copy never
deletes the original disk file. No background import or model execution occurs.

- CSV/TSV opens a labeled Chart when it contains numeric pairs, otherwise Table.
  X/Y column selection preserves source order, units and gaps. Isolated points
  remain visible, and keyboard arrows inspect exact values. Table exposes all
  rows through 100-row pages; missing cells stay explicit rather than becoming zero.
- Actual public Mol* renders PDB/mmCIF structures; it does not verify science.
- Official RDKit Python wheel 2026.9.1 draws and checks up to 200 SMILES/MOL/SDF
  records in the existing Host-managed local backend (no browser dynamic eval).
  Host prepares the declared Python environment; preparation failures remain visible.
  Records are limited to 32 KiB each, the request to 1 MiB, and the worker to 20 seconds.
  Seven descriptors are reported: MolWt, ExactMolWt, MolLogP, TPSA, NumHDonors,
  NumHAcceptors, NumRotatableBonds—not the browser wrapper’s full descriptor set.
  Imported structures use a compact selectable grid and a resizable property
  inspector. The inspector follows the selected record and stacks below the grid
  in narrow windows; invalid records retain their error alongside valid structures.
  Stop waiting discards the response; it does not claim to stop the backend worker.
  Unix teardown uses Host process-group ownership. On Windows the server binds
  a non-inherited kill-on-close Job Object before sending any molecule input;
  ownership failure rejects computation rather than running an unowned child.
- Actual public PDF.js renders PDF evidence. Quotations/crops and explicit
  quotation review use Pero's existing Host Agent authority, never App credentials.
- JSON displays escaped metadata. Unsupported formats and model weights remain opaque.
- `.ipynb` opens a read-only Datalayer Viewer (`@datalayer/jupyter-react`) for
  stored cells and outputs. No kernel starts and imported notebook bytes are not
  executed as code. Complex MIME outputs follow JupyterLab rendermime; scientific
  validity remains unverified.
- Thirteen independently authored CC0-1.0 synthetic examples are not Point's sample
  set, experimental observations or scientific benchmarks.

Browser engines are pinned in package-lock.json: Mol* MIT, PDF.js Apache-2.0,
fflate MIT, Three.js MIT, `@datalayer/jupyter-react` MIT (with JupyterLab/Lumino
runtime). RDKit BSD-3-Clause is pinned in the App Python environment, not npm.
Build retains notices and public-engines.json. Molecule records go only to this
App’s local authenticated backend, never a remote provider. No model weights or
user scripts are loaded or executed; notebook preview does not start a kernel.

Structure text containing `<`, `>`, or `&` is deliberately rejected before Mol*
creation because its stock labels interpret metadata as HTML. Original bytes
remain unchanged. Stock import controls are disabled and the public drop manager
consumes all drops, so imports cannot bypass this boundary or the file-size limit.
Empty molecule records fail explicitly before starting RDKit.

This is independent implementation, not full Point equivalence or scientific
acceptance. Real GUI tests and release validation must produce their own receipts;
unit/build success does not establish graphical or physical validity.

**Open Paper App** explicitly selects the existing enabled paper-agent/main
Workbench entry. It transfers no file, query or source text and starts no search.
Products without Paper report unavailable; the current Electron handoff reports
an unacknowledged request on unsupported shells rather than claiming success.

## Browser inspection

The focused regression uses the production App bundle, actual IndexedDB imports,
the shared SDK and the real local RDKit backend. Its HTTP fixture replaces only
Desktop transport/context; it does not emulate molecule results or certify the
full Electron/GPUI shell, PDF/Agent workflow or signed package.

```
npm run build --prefix apps/scientific-viewer
PERO_SCIENTIFIC_PYTHON=/path/to/prepared/python node tests/e2e/scientific-viewer-browser.mjs
```

The test needs Playwright Chromium (`npx playwright install chromium`) or
`PERO_CHROMIUM_PATH`. Append `--serve` to inspect the same bundle interactively.
The server prints its chosen loopback port and stops when stdin receives `stop`.
Screenshots and the bundle hash are saved in `test-results/scientific-viewer-browser/`.
