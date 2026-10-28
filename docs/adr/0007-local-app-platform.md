# Local App packages and Web panels

Status: accepted for the first implementation slice, 2026-10-28.

## Context

Pero needs domain tools alongside its GPUI Wasm workbench. KiroCrew and Point
provide useful manifest, lifecycle and SDK references, but their React App
components cannot mount directly into a GPUI view. Virtual Cell is the first
App port; its existing scientific methods and source attribution stay in the App.

## Decision

- A local App is a directory containing a versioned `app.json`, one HTML panel
  and an optional Python backend. Version 1 supports one panel per App. Installed
  resources have stable App and panel names; unknown manifest fields, unsupported
  Host grants, unsafe entries and unsupported backend types are refused.
- Rust `pero-runtime::apps` owns manifest validation, the installation catalog,
  enable state, data locations and backend children. `pero-host` exposes these
  operations through the existing stdio transport. Electron is an adapter, not a
  second installation or backend lifecycle owner. Go Task/Run authority is unchanged.
- Installation copies a selected local package into the managed App root and
  leaves it disabled until explicitly enabled. Installation state is durable.
  Builtins are pretrusted by the composition root: a one-time seed installs and
  enables the bundled catalog, with a durable marker so an uninstall survives
  restart. There is no marketplace or automatic update mechanism in this slice.
- Domain data lives outside the package at the App root's sibling
  `app-data/<name>`. Disable stops the backend; uninstall removes the installed
  package and retains domain data. Reinstall does not import a source package's
  data as accepted research results.
- The backend starts lazily when an enabled App is resolved. Python binds
  loopback port `0` and writes one readiness line, `{"port": <bound-port>}`.
  The Host waits at most ten seconds. The backend receives `PERO_APP_DATA`,
  `PERO_APP_NAME` and a fresh `PERO_APP_TOKEN`, plus a small allowlist of host
  environment variables. Host shutdown, disable and uninstall clean up the
  owned backend. The trusted `PERO_APP_PYTHON` setting selects the interpreter;
  App manifests cannot choose an arbitrary command or install dependencies.
- Private `apps_result` replies carry installed paths and optional backend
  URL/token only to Electron main. Main consumes every such reply rather than
  publishing it to the renderer. Public catalog events contain display metadata,
  enable state and panel entries.
- Electron serves each App at `pero-app://<name>/…`, without the workbench's
  Electron preload. Static serving is confined to the panel entry's asset
  directory. `/api/…` resolves only that enabled App's backend; main replaces
  caller credentials with `X-Pero-App-Token` and bounds request bodies. The
  token stays out of App JavaScript, UI snapshots and public catalog events.
- GPUI owns navigation, selection and the content slot. The Web shell positions
  an iframe in that slot, retains it across navigation, and supplies theme,
  locale and active-state messages. Loading, timeout/retry, disabled and removed
  states remain visible. Disabling or removing an App disposes its frame.
  Native GPUI preview reports the Web App surface as unavailable.

The packages are trusted local executable code. Separate browser origins and a
bounded proxy reduce the exposed UI surface; they do not sandbox Python's access
to the machine or establish safe execution of untrusted third-party packages.

## First App and boundaries

Virtual Cell includes its local reference atlas, perturbation workflow,
first-order reaction simulation and volume viewer. Its stdlib Python backend
serves the existing domain methods through the private proxy. Data sources,
illustrative examples and recorded evaluations retain their original labels.
Rendering the App or completing a calculation does not establish scientific
validity or research acceptance.

This slice does not connect Apps to Task/Run creation, Agent tools, ACP/MCP
injection, Project artifact registration, remote Worker environments or automatic
dependency provisioning. It does not claim binary compatibility with Point App
bundles, portable packaged-Desktop acceptance or production hosting.

## Verification

See [App platform verification](../fitness/apps.md). Contracts are defined in
[`protocol/apps.tsp`](../../protocol/apps.tsp), imported by the Host contract.
