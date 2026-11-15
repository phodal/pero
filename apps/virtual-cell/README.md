# Virtual Cell for Pero

The first Pero App: an independently bundled Web panel and a Host-supervised,
stdlib-only Python backend. Run `npm ci --prefix apps/virtual-cell`, then
`node scripts/build/apps.mjs` from the repository root. Install this directory
from Pero's Apps screen and open Virtual Cell. Python 3.10 or later must be available on
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
can be exported, and are not Project artifacts. App-local comparison execution
uses its existing ComparisonHistory; shared Task/Run dispatch and automatic
Project artifact registration remain separate capabilities.

## Runnable CPU task package

The Comparison view exposes `virtual-cell.comparison` v1.0.0: frozen dataset,
task parameters and split, versioned baselines, a reusable additive endpoint,
real CPU execution, immutable predictions/evaluation and an independent ΔMSE
checker. The directly accessible CPU example is synthetic. The method computes
actual empirical baselines; it has no trained weights and is not a learned cell
model or evidence of biological prediction quality.

The Host prepares its declared Python 3.12 backend using the existing environment
owner; the underlying CPU method also supports direct Python 3.10+ execution.
Inspect or prepare the configured interpreter through Host Environments, then
load/import inputs, start the endpoint, run, check, export and rerun. The App
backend retains the training view; Host owns that backend's process lifecycle.
Endpoint unload does not cancel existing comparisons. A failed or differently
bound selected endpoint blocks another run until it is corrected or unloaded.

[Method guidance](backend/comparison-method.md) describes the input/output and
remote deployment contract. Remote connection requires explicitly provisioned
matching inputs and a ready endpoint, configured by Host deployment environment
`PERO_VIRTUAL_CELL_MODEL_URL` and optional `PERO_VIRTUAL_CELL_MODEL_TOKEN`.
Disconnect only releases the local connection; it does not stop a remote service.
No scientific data or weights are downloaded by model start or run.

App-scoped Agent sessions receive the same bounded task path through the existing
App Agent Plugin: `import-inputs` and `comparison-step`, with 12 calls per mounted
connection. Host retains permission checks, approvals and ACP lifecycle.

From this App directory, exported runs are usable without Host:

```sh
python3.12 backend/cli.py compare --bundle export.json --out recomputed.json
python3.12 backend/check_comparison.py --export export.json --out check.json
```

The separate checker imports no production evaluator or baseline code. Its PASS
is limited to artifact binding, equal-batch ΔMSE and complete numerical
denominators. It does not validate preprocessing, biological data, blind
isolation, other metrics or researcher acceptance.

## Provenance

Ported from `phodal/point`, `apps/virtual-cell` version 0.2.0 at source revision
`dcd549a9cc8807eda5ce682eef4621afbd9a02d9`, on 2026-10-28.
Domain source and JSON schema identities are retained for input compatibility;
the SDK, iframe entry and authenticated transport are adapted for Pero.
See `THIRD_PARTY_NOTICES.md` for CELLxGENE fixture and Three.js attribution.
The included `evidence/norman-sc0-v1/*/evaluation.json` files are historical
Point reference reports, not evidence produced or scientifically accepted by
Pero. Norman preparation tooling is in `tools/norman`; the raw source matrix
and a researcher-reviewed preparation protocol are not bundled with this App.

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
