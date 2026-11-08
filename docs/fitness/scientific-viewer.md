# Scientific Viewer and website molecular illustrations

## Research Lab GLB integration (2026-11-08)

Refs [#177](https://github.com/phodal/pero/issues/177), implementation
[PR #178](https://github.com/phodal/pero/pull/178). Source tested:
`750475f870e74b0a45320f7de644281f54a9c37d`, based on master `3c0c96c5`.

### Scope and ownership

The toolbar adds Research Lab alongside existing imports and molecular examples.
Three unmodified Polyfork low-poly GLB meshes are bundled under CC BY 4.0, with
pinned byte hashes, source links, attribution and modification statements. Their
combined size is 222,720 bytes. No thumbnails, HD, MJS or online catalog is bundled.
The library copies a selected model into the existing bounded IndexedDB store;
repeated opens reuse the copy. Removing that copy does not change bundled assets
or original disk files. ZIP export keeps the exact original GLB and credit text.

The GLB preview is an illustrative display. It preserves geometry/transforms and
reports bounds using glTF's metre convention without claiming calibrated dimensions.
Mol*, RDKit, existing scientific previews and Virtual Cell retain data ownership.
There is no additional execution service, remote decoder, automatic animation or
permission/CSP expansion. Input subset and resource limits are documented in the
App README and owned by `MeshAsset` admission.

The viewport uses existing App SDK Button/Disclosure controls and theme tokens;
the library uses LibraryHeader and existing file selection/persistence. No shared
component or token contract was replaced. Camera, rendering and disposal remain
inside the mesh preview; file provenance remains with its storage owner.

### Local checks

- Viewer unit tests: 31 passed, including official model admission, invalid and
  excessive resources, extension/URI rejection, original bytes, and actual Three
  interleaved accessor compatibility.
- Viewer typecheck and production build: passed.
- Production build tests: 3 passed, including shipped model hashes and credits.
  Corrected the pre-existing engine list expectation to include the already-shipped
  react-markdown and remark-gfm licenses.
- Python/RDKit regression: 10 passed using official RDKit 2026.09.1, Python 3.12.
- Theme, design, SDK tokens, locale and protocol generated checks: passed.
- `git diff --check`: passed.
- Whole-repository `npm run check`: blocked locally by absent generated
  `web/src/reader-wasm/pero_reader_web`; separate icon check needs the GPUI kit
  checkout. Neither generated output was stubbed or rewritten.

### Browser and platform boundaries

Local Chromium could not start because the command environment denied its process
socket, including the approved unsandboxed attempt. The cloud browser could not
reach that container's localhost. These attempts do not establish UI acceptance.

The focused browser test is part of the existing Scientific Viewer CI job and
uses the production bundle, actual Three.js, actual IndexedDB and the shell CSP.
It covers all three meshes, attribution/byte-exact exports, offline and reload,
keyboard, themes and 390px width, invalid imports and recovery, embedded PNG,
context loss/retry, unavailable WebGL and disposed canvases. Existing chart/RDKit
and conversation artifact regressions run in that same job.

All nine Research Lab check groups passed in the Scientific Viewer job of
[CI run 42431347094](https://github.com/phodal/pero/actions/runs/42431347094),
alongside all five existing Viewer browser groups and twelve artifact-viewer
groups. CI merge commit: `956ae878e760aa60ebb4a89438fa94e9fdc4a1a0`.
The recorded result contains no JavaScript errors or external model requests.

All eight Research Lab screenshots in the
[browser evidence artifact](https://github.com/phodal/pero/actions/runs/42431347094/artifacts/13598235034)
were visually inspected: the library, each of the three meshes, dark and 390px
layouts, rejected GLB feedback, and embedded PNG. Models are recognizable and
fully framed; controls, errors, provenance and dimensions remain readable without
blocking overlap or clipping. The white rack has modest surface contrast in the
light theme, consistent with the source material; its tubes and holes remain
visible. The artifact includes machine-readable checks and asset hashes.

This follow-up records evidence only; App and test code are unchanged. No
Electron, Native, signed-package or scientific-validity acceptance is claimed by
the browser fixture.

## Imported-file inspection redesign (2026-11-03)

This change replaces the imported molecule stack with a selectable structure
grid and SDK Split property inspector. Numeric files open a labeled Chart when
possible, retain missing-value discontinuities and individual points, and expose
every source row through Table pagination. Imports, source hashes, local-copy
removal and the real RDKit backend retain their existing ownership.

Local checks: 16 App tests, 8 Python backend tests, 2 production-build checks and
the App typecheck pass. A real HTTP fixture also returned RDKit 2026.09.1 SVGs
for all three solvent records; no scientific responses were mocked.

The focused Chromium acceptance, `tests/e2e/scientific-viewer-browser.mjs`,
passed all five check groups in [CI run 41559708803](https://github.com/phodal/pero/actions/runs/41559708803).
It uses the production bundle and SDK with real IndexedDB and RDKit; only the
Desktop HTTP/context transport is replaced.

| Browser check | Observed result |
| --- | --- |
| Imported molecules | Real RDKit SVGs and ethanol descriptors; images stay within their cards; pointer and keyboard selection and SDK splitter work. |
| Chart and Table | Actual headers/units and exact point values; missing records break the line and remain visible in the table; chosen axes survive view switches. |
| File import | All 205 source rows remain reachable across 100/100/5-row pages and persist after IndexedDB reload. |
| Failure and recovery | Invalid molecular records and empty-file errors stay visible; a subsequent valid import recovers. |
| Theme and width | Actual SDK dark theme and 390px molecule/chart/table layouts render without horizontal document overflow. |

All eight screenshots in the [browser evidence artifact](https://github.com/phodal/pero/actions/runs/41559708803/artifacts/13195937613)
were visually inspected. They cover light/dark molecules, narrow stacked molecule
panes, diffraction, missing-value charts and tables, and narrow dark chart/table
states. No blocking clipping, overlapping controls or misplaced structures were
observed. The artifact also includes the engine version and machine-readable
check results. This evidence is linked from [PR #112](https://github.com/phodal/pero/pull/112).

Tested source: `210c514f8ec8382542f1bf59662408a46d56663b`.
CI merge commit: `f5dbe1e5d5288743acb07de8e4769dc93e3a9da0`.
App JS SHA-256: `35832711448c20f0a2eed4e4c1026675ab841d7d3c3330acba605ee1e43ea078`.
The final follow-up records this evidence only; no App or test code changes.

Browser acceptance ran in CI. The cloud browser blocked the local preview URL,
and the local Chromium download did not produce a valid archive; no local
browser pass is claimed.

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
