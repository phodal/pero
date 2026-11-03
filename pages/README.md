# Website prototype

```sh
npm ci
npm ci --prefix apps/virtual-cell
node pages/scripts/build.mjs
```

Serve `docs/` over a local HTTP server to preview the Chinese and English pages.
Pushes to `master` publish this site and the WASM workbench together through
`.github/workflows/pages.yml`. The workbench is at `/workbench/`.
The generated 3D viewer uses local assets under `docs/assets/molecule-viewer.*`;
keep those files alongside the generated pages when deploying. No CDN or App
backend is required.

The main example is a small ball-and-stick molecule explorer with water, ethanol
and benzene. Coordinates are idealized illustrations, not measured structures,
optimized conformers or AI predictions. Rotation is pointer- and keyboard-driven;
there is no automatic animation. The website and Scientific Viewer App mount the
same component from `packages/molecule-viewer`, including the default ethanol
illustration, controls, theme and language. The website build resolves the pinned
Three.js dependency from Virtual Cell; Scientific Viewer declares the same version.

The page follows the README: Architecture, then Distributed collaboration,
then Tasks, then Apps. The collaboration studio and the perturbation
benchmark are shown directly. The benchmark embeds
`apps/virtual-cell/examples/synthetic.json` and mirrors the App's control,
training-mean and empirical additive definitions. Its predictions use training
conditions only; all five frozen test combinations contribute to the reported
median delta MSE. Skill is calculated per combination against additive, then
aggregated by median; exact additive cases remain listed as excluded from Skill.

This is a non-blind browser demonstration. It trains no AI model, establishes no
biological validity, and simulates collaboration and acceptance roles locally.
