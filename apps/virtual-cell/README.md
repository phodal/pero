# Virtual Cell for Pero

The first Pero App: an independently bundled Web panel and a Host-supervised,
stdlib-only Python backend. Run `npm ci --prefix apps/virtual-cell`, then
`node scripts/build/apps.mjs` from the repository root. Install this directory
from Pero's Apps screen and open Virtual Cell. Python 3 must be available on
the execution machine. The Desktop Host chooses the executable; an App cannot
choose arbitrary executables or command arguments.

The panel contains the original Point App's linked cell atlas, perturbation
analysis, first-order reaction simulation, and three-channel WebGL volume view.
No dataset/model download, Agent execution or scientific acceptance happens when
the panel opens. The initial atlas is a stored PBMC3k reference subset. Reaction
and volume examples are explicitly illustrative; perturbation evaluation is
non-blind and retains its full denominator and acceptance limitations.

The Python backend keeps imported inputs and computed results in the data root
provided by Pero Host. Disabling/uninstalling the App stops its backend; data
retention is controlled by the Host. Display-only imports remain in the panel,
can be exported, and are not Project artifacts. Task/Run execution, Project
artifact registration and Agent observation are not connected in this slice.

## Provenance

Ported from `phodal/point`, `apps/virtual-cell` version 0.2.0 at source revision
`dcd549a9cc8807eda5ce682eef4621afbd9a02d9`, on 2026-10-28.
Domain source and JSON schema identities are retained for input compatibility;
the SDK, iframe entry and authenticated transport are adapted for Pero.
See `THIRD_PARTY_NOTICES.md` for CELLxGENE fixture and Three.js attribution.
The included `evidence/norman-sc0-v1/*/evaluation.json` files are historical
Point reference reports, not evidence produced or scientifically accepted by
Pero. Reproduction tooling and Norman source matrices are not included.

## Verification

```sh
npm test --prefix apps/virtual-cell
npm run test:ui --prefix apps/virtual-cell
npm run typecheck --prefix apps/virtual-cell
node scripts/build/apps.mjs
```

Python tests drive the domain core and one authenticated loopback HTTP flow;
the frontend tests check atlas alignment, reaction mass conservation and voxel
input bounds. Desktop integration is verified by the repository Apps e2e suite.
