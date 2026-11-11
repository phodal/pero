# Environments

Host-backed inspection of the **configured software** used by Paper, Control Lab,
and LCMS2Yield. This is an observation UI, not a second compute scheduler.

## Available paths

- Open Environments from the Workspace sidebar, search/filter the supported methods, switch
  table/grid, inspect one or all, and review installed versions and missing requirements.
- Paper's reproduction panel opens the same inspector scoped to PC-Gym.
- Control Lab's engine availability opens it scoped to python-control and ngspice.
- LCMS2Yield opens it scoped to `lcms2yield.inference`. Preparing that App
  installs its chemistry packages into `environment/lcms2yield-python312` and
  downloads the pinned release into the App data directory.
- Export a versioned metadata observation. It is **not** a verification report,
  managed EnvironmentUse, proof of a running process, or scientific acceptance.

Opening the catalog lists saved environments without probing or installing. Check
and the single-method task inspector call a fixed read-only Host probe. Creating,
preparing and binding are separate explicit actions. No arbitrary installation
commands or scientific execution are accepted by these actions.

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

The local environment section creates named conda prefixes with the pinned
micromamba 2.5.0-2. This trial uses CPython 3.12 from conda-forge for Paper,
Control, Circuit, and LCMS2Yield. Prepare installs the method pins with the
prefix's pip. Circuit also installs ngspice-exe 41 from conda-forge, except on
Apple Silicon, where conda-forge publishes no ngspice build and Homebrew supplies
it. LCMS2Yield then installs the PyG extension wheels from the upstream
find-links index. The solved package list is kept beside the profile as an
explicit export. App service environments stay on their uv virtualenvs.

Preparation runs outside the AppStore lock. Logs and state persist under the
Host profile's `environment/profiles`; reopening can inspect an ongoing job.
Interrupted preparation is marked failed at Host startup and can be retried.
Binding rechecks requirements, saves the existing runtime `app_python` setting,
stops the old App backend, and starts it with the selected venv. The UI requires
an explicit confirmation because this stops that App's current calculations.
Bound software cannot be modified in place. Create a new environment to change it.
Control and Circuit share Control Lab's App-wide interpreter binding.

The App environments tab is local App runtime binding, not independent per-attempt compute or managed
EnvironmentUse admission. PC-Gym source checkout and scientific approvals retain
their existing configuration and owners; installing packages does not authorize
training or establish scientific acceptance. Python transitive dependencies are
resolved by uv, not a complete cross-platform artifact lock.

## Locked scientific computation

The Compute tab prepares independent Control Lab or PC-Gym profiles. It saves
the exact uv/Python download identities, generated project, full native uv lock,
observed interpreter/build and distribution-file digest. Prepare publishes a new
prefix only after import/content checks; rebuild copies the same lock into another
prefix. Selecting compute does not restart the App service. A published profile is
immutable, and an existing experiment/specification refuses a different profile.

Preparation can be cancelled. Failures retain their bootstrap, resolution,
installation, observation, cancellation or interruption stage and diagnostics.
The current binding is preserved. A cancelled download of the bootstrap uv archive
can finish its bounded HTTP request before cancellation is observed; uv installation
subprocess groups are stopped at the next poll. Retry is explicit.

Original Control Store and PC-Gym CLI owners still control attempts. The Host's
private loopback bridge records the existing EnvironmentUse transitions, checks
the original Paper approval, verifies scientific child parent/process-group ownership,
and releases only after the entire registered scientific group is absent. App
shutdown also stops registered scientific groups. Restart reconciles saved records
without replay. Receipts accompany attempt exports. Native ngspice remains an
observed executable, with frozen path/version/content identity, not a reproducible
native installation.

Review project declarations reads only `pyproject.toml`, `uv.lock`, `.python-version`
and `requirements.txt` from a local directory or GitHub URL pinned to a full commit.
It produces a review proposal with source digests and unresolved requirements;
it does not import project code, run build hooks or install dependencies.
This inspection requires an existing Python 3.11+ interpreter.

All supported Desktop uv archives are fixed and verified; locked compute
preparation currently supports macOS arm64 and Linux x86_64. Linux PC-Gym uses
the explicit official CPU PyTorch index. See [production verification](../../docs/fitness/uv-scientific-production.md)
for observed acceptance and remaining platform scope.

## Build and validate in the repository

```sh
npm run gen:contracts
node scripts/build/scientific-runtime.mjs
node scripts/build/source-parsers.mjs
npm run check
node --test packages/app-sdk/test/environments.test.mjs
node --experimental-strip-types --test desktop/src/main/environment-inspection.test.ts
node scripts/cargo.mjs test -p pero-runtime environment
node scripts/cargo.mjs test -p pero-host
node scripts/build/apps.mjs --app environments
node scripts/build/apps.mjs --app paper-agent
node scripts/build/apps.mjs --app control-lab
npm --prefix apps/environments run check
python3 -m unittest discover -s packages/scientific-runtime/test
PERO_ENVIRONMENTS_TEST_VENV=/absolute/path/to/existing/venv node tests/e2e/environments.mjs
```

The product includes Environments as an optional App. Manage it from the Apps
catalog. Dependency pins and lock are inherited from the existing Connectors
App, with the package identity changed. Actual development verification and
remaining Native/scientific acceptance are recorded in
[Environments UI](../../docs/fitness/environments-ui.md).
