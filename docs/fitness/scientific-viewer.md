# Scientific Viewer and website molecular illustrations

## Imported-file inspection redesign (2026-11-03)

This change replaces the imported molecule stack with a selectable structure
grid and SDK Split property inspector. Numeric files open a labeled Chart when
possible, retain missing-value discontinuities and individual points, and expose
every source row through Table pagination. Imports, source hashes, local-copy
removal and the real RDKit backend retain their existing ownership.

Local checks: 16 App tests, 8 Python backend tests, 2 production-build checks and
the App typecheck pass. A real HTTP fixture also returned RDKit 2026.09.1 SVGs
for all three solvent records; no scientific responses were mocked.

The focused browser acceptance is `tests/e2e/scientific-viewer-browser.mjs`.
It uses the production bundle and SDK with real IndexedDB and RDKit; only the
Desktop HTTP/context transport is replaced. CI saves screenshots, the engine
version, bundle SHA and check results under `test-results/scientific-viewer-browser/`.
Browser visual acceptance is pending that run: the current cloud browser blocked
the local preview URL and the local Chromium download did not produce a valid
archive. No local browser pass is claimed.

The full Electron/GPUI, PDF/Agent/export flow and signed package have not been
rerun for this change. The earlier Native/browser evidence below concerns the
default illustrative molecular explorer, not this imported-file redesign.

## Earlier default-explorer verification

2026-11-03, macOS development checkout based on `b2d35d24` with the scoped
working-tree changes. L0 build/unit checks and L1 Native/browser inspection;
no signed release, remote publication or scientific-validity claim.

The default App view and `pages/` mount the same implementation in
`packages/molecule-viewer`. Ethanol opens first; water and benzene retain the
website's idealized coordinates. These are illustrations, not experiments,
optimized conformers or predictions. Three.js is pinned to 0.185.1 in both
builds, with its license included in the App output.

## Observed flow

| Step | Result | Evidence in `test-results/scientific-viewer-design/` |
| --- | --- | --- |
| 1. Open Viewer | Before: title, metadata and file list push the structure below the fold. After: model occupies the main area, compact toolbar remains above it. | `01-native-before.png`, `04-native-after.png` |
| 2. Switch molecules | Water shows H₂O and 3 atoms / 2 bonds; ethanol shows C₂H₆O and 9 / 8; benzene shows C₆H₆ and 12 / 12. Native water/ethanol and browser all three checked. | `03-pages-light.png`, `04-native-after.png` |
| 3. Change theme and language | Native light/dark checked and original light preference restored. The website's Chinese/English parent frames update the shared illustration and dark theme. | `06-native-dark.png`; browser DOM observations |
| 4. Use a narrow window | 480 × 720 CSS px: model, controls and notice fit; imported-file toolbar wraps to two rows without horizontal overflow. Source and 64-character hash wrap within the panel. | `05-viewer-narrow.png`, `07-file-details-error.png` |
| 5. Inspect a file | Built-in CSV import and file selection work. The source status stays visible; provenance and local-copy actions expand on demand. Invalid spectral pairs retain an explicit gap warning. | `07-file-details-error.png` |
| 6. Use the keyboard | Browser arrow rotation and reset work. Removal confirmation focuses Cancel; Escape cancels and returns focus to Remove local copy. | browser interaction and focus observations |

Screenshots were captured and inspected in this run. Native was restarted to
load the rebuilt App rather than treating the browser preview as Native proof.
The renderer has no animation loop; it redraws for input, resizing and reset.
WebGL failure keeps a visible retry action, but forced context-loss recovery
was not exercised. Full screen-reader and contrast certification remain open.

## Checks

- `npm run typecheck --prefix apps/scientific-viewer` passed.
- `npm test --prefix apps/scientific-viewer` passed, 15 tests.
- `node --test scripts/build/scientific-viewer.test.mjs` passed, 2 tests.
- `npm run build --prefix apps/scientific-viewer` and `node pages/scripts/build.mjs` passed.
- `npm run check` and `git diff --check` passed.
- Existing Electron regression selectors were updated for the file selector and
  source disclosure; the complete Electron PDF/Agent/export suite was not rerun.

App JS SHA-256: `65d93ea0fe1dd0728b6bcefe4cd7b79bd6245c92260ca319c81e2d59cd8b757f`.
App CSS: `2a6d6353db974cbdfdf69b68100259bec7fc261f0acaaed3a773e53ea32ddb3c`.
Website viewer JS: `94a5c8a7c4cf7dd552f42a200d64c560d5a958ceea879aabc942ac062a6580cb`.
Website viewer CSS: `37ace2c4f71733287bcb6e4d9191dbf2b398eae5ea37ec8d7319466453751b02`.

No Point files or ChatGPT Pages documents were changed. Website assets were
rebuilt locally; publication remains separate.
