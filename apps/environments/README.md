# Environments

Host-backed inspection of the **configured software** used by existing Paper and
Control Lab methods. This is an observation UI, not a second compute scheduler.

## Available paths

- Open the Environments App, search/filter the three supported methods, switch
  table/grid, inspect one or all, and review installed versions and missing requirements.
- Paper's reproduction panel opens the same inspector scoped to PC-Gym.
- Control Lab's engine availability opens it scoped to python-control and ngspice.
- Export a versioned metadata observation. It is **not** a verification report,
  managed EnvironmentUse, proof of a running process, or scientific acceptance.

Opening the catalog does not spawn probes. Check and the single-method task
inspector call a fixed read-only Host probe. No arbitrary code, package installer,
resource allocation, scientific run, data movement or approval is introduced.

## Ownership

```
App / shared SDK view
  POST /host/environment {target}
  Electron or Native app-origin adapter
  apps / environment (caller from the actual App origin)
  AppStore::inspect_environment_for
  existing configured-interpreter probe + existing Rust requirement matcher
```

The management App requires its `environments` Host grant. Paper can inspect only
PC-Gym; Control Lab can inspect only its two methods. The method and caller are
checked before a probe starts. The frontend does not duplicate scientific
matching or change execution authorization. Paper's original approvals and
Control Lab's frozen experiment budgets/verifiers stay unchanged.

## Scope intentionally not claimed

There is no Create/Prepare Runtime action, independent interpreter selection,
GPU/Slurm/cloud selector, historical Use browser, or auto-repair. Those need the
planned managed-use/runtime-separation work; this UI must not simulate them.
An observation is explicitly `metadata_only`, uses the configured interpreter,
and does not establish the software loaded by an already-running backend.

## Build and validate in the repository

```sh
npm run gen:contracts
npm run check
node --test packages/app-sdk/test/environments.test.mjs
node --experimental-strip-types --test desktop/src/main/environment-inspection.test.ts
node scripts/cargo.mjs test -p pero-runtime environment
node scripts/cargo.mjs test -p pero-host
node scripts/build/apps.mjs --app environments
node scripts/build/apps.mjs --app paper-agent
node scripts/build/apps.mjs --app control-lab
npm --prefix apps/environments run check
PERO_ENVIRONMENTS_TEST_VENV=/absolute/path/to/existing/venv node tests/e2e/environments.mjs
```

The product manifest includes the App as optional. The normal existing builtin
catalog exposes it; no alternative shell navigation or App installation system
is added. Dependency pins and lock are inherited from the existing Connectors
App, with the package identity changed. Actual development verification and
remaining Native/scientific acceptance are recorded in
[Environments UI](../../docs/fitness/environments-ui.md).
