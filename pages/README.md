# OpenPero website and documentation

```sh
npm ci
npm ci --prefix apps/virtual-cell
node pages/scripts/build.mjs
```

Serve `docs/` over local HTTP to preview the Chinese and English pages.
The [Pages workflow](../.github/workflows/pages.yml) publishes `docs/` from the
admitted commit and adds the built WASM workbench at `/workbench/`. Include the
generated files when changing the site.

## Official documentation

The website navigation links to the Chinese guide at `/docs/` and the English
guide at `/en/docs/`. Each page links to its counterpart in the other language.
Edit the paired content in `locales/guide.zh-CN.mjs` and `locales/guide.en.mjs`.
Keep topic keys and section IDs aligned so links remain stable. The guide uses
the shared appearance palette and design dimensions.

The [documentation research](DOCUMENTATION-RESEARCH.md) records the official
docs reviewed and the decisions behind the first five topics.

## Interactive homepage

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
