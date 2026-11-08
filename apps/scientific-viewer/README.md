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
- GenBank DNA (`.gb`, `.gbk`, `.genbank`) opens a read-only double-strand
  sequence view with a linked circular or linear map. Search by annotation,
  literal motif or 1-based coordinate. Exact ranges, `join` and `complement`
  are supported. Unsupported locations are counted and the original file
  remains available. Examples include unchanged GenBank records for
  [pBR322](https://www.ncbi.nlm.nih.gov/nuccore/J01749.1),
  [pUC19](https://www.ncbi.nlm.nih.gov/nuccore/M77789.2) and
  [pACYC184](https://www.ncbi.nlm.nih.gov/nuccore/X06403.1).
  Their source is shown separately from the synthetic examples.
  See the [GenBank data usage policy](https://www.ncbi.nlm.nih.gov/genbank/genbank/#genbank-data-usage).
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
- Images, code and Markdown have shared read-only previews. HTML opens in a static
  sandbox without scripts or external resources; the original source stays available.
- `.ipynb` opens Datalayer Viewer (`@datalayer/jupyter-react`) for the original
  cells and outputs. Start Python kernel opens an editable working copy.
  Individual code cells share a local Jupyter kernel. Interrupt, restart and
  close control that kernel. Download working copy exports the edited cells
  and outputs as a separate notebook. The original snapshot stays available.
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

## Conversation snapshots

`dist/artifact.html?thread_id=…` is the conversation artifact browser. The Chat
shell supplies its typed catalog, selected exact version and saved Icons/List/
Gallery preference through App context. Single click selects; double click or
Space opens quick look; Escape returns to the selected item and prior scroll
position. Gallery keeps a large reader above a horizontally scrollable film strip.
Images and small source files use their saved content for thumbnails; other
formats use the shared content icons. The shell owns import, source return and
whole-artifact context actions. Selected text/PDF page discussion receives its
success or failure from actual Composer admission in the original Chat.

`dist/artifact.html?thread_id=…&artifact_id=…&version=N` also retains the single
version preview surface for Host-owned conversation artifacts. It does not open the local
IndexedDB library or start the molecule Python backend. It reads exactly one
version from `/host/artifacts/<thread>/<artifact>/<version>`, checks the returned
bytes against the Host SHA-256 header, then uses the same image, code, Markdown,
CSV/TSV, PDF.js and saved-Notebook renderers. Download preserves original bytes.
The Host owns authorization, provenance, versions and persistence.

Continue in chat carries the fixed version identity and selected text or current
PDF page text. The owning shell binds this action to the original conversation
and requests the Host-owned context for the same snapshot, including actual image bytes. A preview is not
scientific acceptance; a saved Notebook does not start a kernel.

`node apps/scientific-viewer/test/artifact-browser.mjs` checks the production bundle
in Chromium with fixture Host bytes/chat transport, including byte-exact download,
dark/narrow Notebook preview, digest rejection and recovery. Screenshots go to
`test-results/session-artifacts-viewer`; Native/Electron bridges need their own checks.

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

## Research Lab and local GLB

**Research Lab** in the toolbar opens three bundled Polyfork low-poly models:
Optics Table, Research Microscope, and Sample Tube Rack (222,720 bytes total).
These are illustrative meshes, not calibrated instruments, scientific observations,
or validated simulations. This is not the complete Research Lab kit.

Open a model to save a local copy, orbit/zoom with pointer or arrow keys and +/−,
reset/fit with Home, inspect bounds, and download the exact GLB plus attribution
in a ZIP. Sources, CC BY 4.0 credit, license URLs, modification notes and SHA-256
are pinned in `assets/research-lab/manifest.json`; `ATTRIBUTION.md` is copied into
built distributions. No thumbnails, HD assets or parameterized MJS are included.
Saved models reopen offline. Removing a local copy leaves the bundled original
and the user's disk file untouched.

Import file also accepts `.glb` or `model/gltf-binary`. The read-only renderer
supports a deliberately bounded subset: static triangle GLB 2, one embedded BIN,
embedded PNG/JPEG, and native unlit/transmission/ior/specular/clearcoat materials.
It rejects external/data URIs, animations, skins, morphs, compression, unknown
extensions, invalid graphs/accessors/indices and excessive decoded resources before
GLTFLoader. Bounds are reported in glTF's metre convention, not certified units;
camera fitting never changes mesh data. Unattributed local imports remain unknown.

Budgets: 10 MiB file, 1 MiB JSON, 250,000 triangles (including instances), 1,024
nodes, 128 materials, 64 MiB accounted decoded resources, 8,388,608 image pixels,
and 4,096 pixels per image dimension. GPU resources are disposed on replacement,
retry and unmount. There is no animation loop, remote decoder, network search,
asset hotlink, new permission, or CSP relaxation. Mol*, RDKit and Virtual Cell
retain ownership of their scientific data and computations.

`PERO_SCIENTIFIC_PYTHON=/path/to/python node tests/e2e/research-lab-browser.mjs`
checks the production bundle under the shell's CSP, including all three meshes,
byte-exact licensed export, offline/reload, keyboard/theme/narrow views, invalid
imports, embedded textures, context loss/retry, unavailable WebGL and cleanup.
Screenshots go to `test-results/research-lab-browser/`. Electron, Native and signed
packages require separate acceptance; browser checks do not certify those shells.
