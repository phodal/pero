# Environments

Host-backed inspection of the **configured software** used by existing Paper and
Control Lab methods. This is an observation UI, not a second compute scheduler.

## Available paths

- Open Environments from the Workspace sidebar, search/filter the three supported methods, switch
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

## Local preparation and binding

The local environment section creates named CPython 3.12 venvs from fixed method
recipes. Prepare installs the App backend pins and, for PC-Gym, the additional
pins in `crates/pero-runtime/src/apps/pcgym-dependencies.json`. Circuit also uses
Homebrew to install ngspice and binds its resolved executable into the venv.
Native dependency installation currently requires Homebrew.

Preparation runs outside the AppStore lock. Logs and state persist under the
Host profile's `environment/profiles`; reopening can inspect an ongoing job.
Interrupted preparation is marked failed at Host startup and can be retried.
Binding rechecks requirements, saves the existing runtime `app_python` setting,
stops the old App backend, and starts it with the selected venv. The UI requires
an explicit confirmation because this stops that App's current calculations.
Bound software cannot be modified in place. Create a new environment to change it.
Control and Circuit share Control Lab's App-wide interpreter binding.

This is local App runtime binding, not independent per-attempt compute or managed
EnvironmentUse admission. PC-Gym source checkout and scientific approvals retain
their existing configuration and owners; installing packages does not authorize
training or establish scientific acceptance. Python transitive dependencies are
resolved by uv, not a complete cross-platform artifact lock.

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

The product includes Environments as an optional App. Manage it from the Apps
catalog. Dependency pins and lock are inherited from the existing Connectors
App, with the package identity changed. Actual development verification and
remaining Native/scientific acceptance are recorded in
[Environments UI](../../docs/fitness/environments-ui.md).
