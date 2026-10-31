# Pero Apps

`npm run dev:apps` builds and opens the first App, Virtual Cell, in an isolated
developer profile. `npm run dev` uses the ordinary Desktop profile. Both discover newly bundled Apps at startup and when the Apps catalog is
requested. Existing enable state is retained; removals are recorded per App so
refreshing or restarting does not reinstall it. An installed builtin is
replaced when the bundled package changes. Its enable state and domain data
stay.

An App is a built local directory. Install it from **Apps → Install from folder**,
enable it and open its panel. Version 1 supports one HTML entry and an optional
Python backend:

```json
{
  "schemaVersion": 1,
  "name": "example",
  "version": "0.1.0",
  "displayName": "Example",
  "description": "A domain workflow",
  "contributes": {
    "panels": [{ "id": "main", "title": "Example", "entry": "dist/index.html" }]
  },
  "backend": { "type": "python", "entry": "backend/server.py" }
}
```

Omit `backend` for a frontend-only App. Unsupported fields and Host grants are
refused. App and panel names contain lowercase letters/digits separated by
hyphens. Entries must be relative files inside the package; symlinks are refused.
Python backends may declare pinned `dependencies` such as `["numpy==2.2.6"]`.
The Host prepares them on enable or first open; package copying never runs an App build or setup command.

The panel runs at `pero-app://<name>/<entry>`. Only its entry's asset directory
is served. It has no Electron bridge. Bundle `packages/app-sdk` with the panel
(see `scripts/build/apps.mjs`) to consume parent-owned theme, locale and active
state. The SDK announces `{type:"pero:app:ready"}` to its parent after mounting;
the parent replies with `{type:"pero:app:context",context:{locale,dark,active}}`.
Hide/show retains the document; disable/remove disposes it. Pause expensive work
when inactive and keep imports/drafts until the user explicitly saves or exports.

`useAppApi` supports JSON `get`/`post` under `/api/…` on the App's own origin.
Desktop privately proxies those requests to the enabled backend. Python binds
`127.0.0.1:0`, prints and flushes `{"port":<actual-port>}` after binding, and
authenticates API requests against `X-Pero-App-Token` using `PERO_APP_TOKEN`.
The Host supplies `PERO_APP_DATA` for durable domain data and owns the process.
Do not print the token or put it in responses. Domain data is outside the package
and survives uninstall. The Python backend remains trusted machine-local code.

## Python environments

The Host prepares Python environments before enabling or starting an App backend.
Both Electron and native Desktop use this implementation. Python backends declare
`backend.dependencies` as an array of `package==version` requirements; URLs, pip
options and unpinned requirements are refused. Control Lab and Paper Agent declare
their numerical and PDF dependencies this way.

A new workbench default is `~/.pero/environment/pero-python312`, CPython 3.12,
the bundled minor. An existing `pero-default` binding and its directory stay,
so packages already installed there remain selected for other Apps. Control Lab
is bound to a CPython 3.12 environment when the selected interpreter is a
different minor. Other explicit defaults and `app_python.apps` overrides remain
selected. Isolated profiles and custom App roots keep their managed environment
under that profile's App-root parent when no default is configured.

When an environment is missing, the Host downloads the pinned official uv
installer (0.12.20), installs uv under `environment/tools`, and creates a CPython
3.12 venv. Managed Python installations and cache stay under `environment/python`
and `environment/cache`; shell profiles and global PATH are untouched. uv installs
binary wheels for the pinned packages. Dependency versions are checked again
before backend startup, and each pinned distribution is imported, so a removed
package or a wheel that cannot load does not count as ready.

The installation view shows creation, dependency installation, readiness, failure,
and recent output. A failed install does not launch the backend or newly enable
the App. Retry repeats preparation and reuses packages already installed. Builtins
that were enabled at discovery are prepared on first open. Backend readiness has
its separate ten-second deadline after preparation completes; installer commands
have a ten-minute bound. App-specific commands requiring the catalog fail with a
retry message while preparation holds the store; the Host input loop and existing
Agent traffic remain available.

Explicit environments must be isolated venv roots with
`include-system-site-packages = false`. The Host uses their `bin/python` or
`Scripts/python.exe`, disables ambient Python settings and user-site packages,
and sets `VIRTUAL_ENV` and the executable PATH for backend children. An invalid
explicit environment fails visibly rather than falling back to a system Python.
Frontend-only and Node Apps do not invoke Python preparation.

This provisions Python dependencies. External executables such as Control Lab's
`ngspice` retain their separate capability checks and are not installed by uv.
Downloading uv/Python/wheels requires network access on first use. Windows and
Linux installation paths require platform acceptance separately.

Opt-in real installation and Desktop checks:
`PERO_APP_PREPARATION_NETWORK=1 node tests/e2e/app-preparation.mjs`.
