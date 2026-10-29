# Pero Apps

`npm run dev:apps` builds and opens the first App, Virtual Cell, in an isolated
developer profile. `npm run dev` uses the ordinary Desktop profile. Both discover newly bundled Apps at startup and when the Apps catalog is
requested. Existing enable state is retained; removals are recorded per App so
refreshing or restarting does not reinstall it. Installed packages are not
automatically updated.

An App is a built local directory. Install it from **Apps → Install from folder**,
enable it and open its panel. Version 1 supports one HTML entry and an optional
stdlib Python backend:

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
Dependencies must already be bundled or available. Installation never runs an
App's build, setup command or package manager.

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

Apps share one default Python environment. An App-specific environment is an
optional override for dependencies that need separation. Without explicit
environment settings, the existing Host default remains `PERO_APP_PYTHON` or
`python3`, including Product-bundled Python.

To select a prepared shared venv, create it and install the required locked
dependencies there before opening the Apps:

```sh
python3 -m venv "$HOME/.local/share/pero/python/shared"
```

Merge `app_python` into the Host's existing `runtime-settings.json`
(`PERO_SETTINGS_PATH` when set), preserving its other preferences:

```json
{
  "app_python": {
    "default": "/absolute/path/to/pero/python/shared",
    "apps": {
      "paper-agent": "/absolute/path/to/pero/python/paper-agent"
    }
  }
}
```

`default` is shared by all Python Apps without an override. The optional `apps`
map selects dedicated environments; omit it to use only the shared environment.
Values are absolute **venv directories**, not executable paths or commands.
Keep them outside the App package; installation excludes `.venv`. Restart the
Host after changing bindings. The Host launches `bin/python` on macOS/Linux or
`Scripts/python.exe` on Windows from the selected environment. It requires
`pyvenv.cfg` with `include-system-site-packages = false`, ignores ambient Python
environment variables and disables user-site packages. App sibling modules and
the selected environment's packages remain importable. `VIRTUAL_ENV` points to
the selected directory and its executable directory leads `PATH`, so child
Python commands and installed console scripts also use that environment.

Selection order is the App override, then `app_python.default`, then the existing
Host default interpreter. A missing or invalid explicitly selected environment
fails with a repair message, without falling back to the next choice. The Host
does not create environments or install packages, and App manifests cannot
change these trusted Host settings.

Bindings live with Host preferences and survive App disable, uninstall and
reinstall. Environment directories are externally prepared and retained. This
separates dependencies for Apps with overrides and keeps one process per App;
filesystem/network access still uses the current user's permissions.

Paper Agent is available with `npm run dev:paper`; its
[workflow and Python backend](paper-agent/README.md) use the Host's existing ACP
sessions through the declared `agent` permission. Other Host grants are refused.

Version 1 provides no domain Agent tools, Task/Run dispatch, remote installation,
marketplace, update service or scientific acceptance. See [ADR 0007](../docs/adr/0007-local-app-platform.md)
and [verification](../docs/fitness/apps.md).
