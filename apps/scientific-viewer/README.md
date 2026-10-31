# Scientific Viewer

Repository-owned Pero App: no Point checkout, SDK, backend or runtime dependency.

```
npm ci --prefix apps/scientific-viewer --ignore-scripts
node scripts/build/scientific-viewer.mjs
npm test --prefix apps/scientific-viewer
npm run typecheck --prefix apps/scientific-viewer
```

User-selected files persist in this App's IndexedDB profile: 10 MiB per file,
50 MiB library. Clearing the profile removes them. Removing a local copy never
deletes the original disk file. No background import or model execution occurs.

- CSV/TSV tables and first-two-column spectra retain missing values and gaps.
- Actual public Mol* renders PDB/mmCIF structures; it does not verify science.
- Actual public RDKit draws and checks up to 200 SMILES/MOL/SDF records.
- Actual public PDF.js renders PDF evidence. Quotations/crops and explicit
  quotation review use Pero's existing Host Agent authority, never App credentials.
- JSON displays escaped metadata. Unsupported formats and model weights remain opaque.
- Twelve independently authored CC0-1.0 synthetic examples are not Point's sample
  set, experimental observations or scientific benchmarks.

Public engines are pinned in package-lock.json: Mol* MIT, RDKit BSD-3-Clause,
PDF.js Apache-2.0, fflate MIT. Build retains notices and public-engines.json.

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
