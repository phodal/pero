# Website prototype

```sh
npm ci
npm ci --prefix apps/virtual-cell
node pages/scripts/build.mjs
```

Serve `docs/` over a local HTTP server to preview the Chinese and English pages.
The generated 3D viewer uses local assets under `docs/assets/molecule-viewer.*`;
keep those files alongside the generated pages when deploying. No CDN or App
backend is required.

The main example is a small ball-and-stick molecule explorer with water, ethanol
and benzene. Coordinates are idealized illustrations, not measured structures,
optimized conformers or AI predictions. Rotation is pointer- and keyboard-driven;
there is no automatic animation. The viewer uses the existing pinned Three.js
dependency from Virtual Cell without changing the App.

The research workflow and perturbation benchmark are expanded by default and
can be collapsed. The benchmark embeds
`apps/virtual-cell/examples/synthetic.json` and mirrors the App's control,
training-mean and empirical additive definitions. Its predictions use training
conditions only; all five frozen test combinations contribute to the reported
median delta MSE. Skill is calculated per combination against additive, then
aggregated by median; exact additive cases remain listed as excluded from Skill.

This is a non-blind browser demonstration. It trains no AI model, establishes no
biological validity, and simulates collaboration and acceptance roles locally.
