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

An App may declare `permissions.frameOrigins`, a bounded list of exact HTTPS
origins such as `["https://arxiv.org"]`. The Host validates the declaration and
passes it privately to both shells for `frame-src`; undeclared Apps retain
same-origin frames only. The declaration does not grant backend or Host API
access to the embedded page. Native accepts SDK IPC only from the App origin.

`useAppApi` supports JSON `get`/`post` under `/api/…` on the App's own origin.
Desktop privately proxies those requests to the enabled backend. Python binds
`127.0.0.1:0`, prints and flushes `{"port":<actual-port>}` after binding, and
authenticates API requests against `X-Pero-App-Token` using `PERO_APP_TOKEN`.
The Host supplies `PERO_APP_DATA` for durable domain data and owns the process.
Do not print the token or put it in responses. Domain data is outside the package
and survives uninstall. The Python backend remains trusted machine-local code.

## Agent Plugins

An App can declare instructions and a subset of its existing `contributes.writes`
for its Host conversation:

```json
{
  "permissions": { "host": ["agent", "agent-plugin"] },
  "requiresAgentPlugins": ["literature"],
  "contributes": {
    "panels": [{ "id": "main", "title": "Research", "entry": "dist/index.html" }],
    "writes": [{ "name": "save", "description": "Save findings", "path": "/api/findings", "schema": { "type": "object" } }],
    "agentPlugin": {
      "schema": "pero.app-agent-plugin.v1",
      "instructions": "Read the selected sources, cite exact evidence, and save findings with the save tool.",
      "tools": ["save"],
      "maxCalls": 12
    }
  },
  "backend": { "type": "python", "entry": "backend/server.py" }
}
```

These fields extend the ordinary App identity/version manifest. Tool names refer
to this App's declared writes; the Host owns routing and credentials. The budget
counts dispatched App data writes for this ACP connection, including failed
calls, across turns and cancellation. Existing writes remain available through
normal App Use in ordinary conversations. App UI automation and separate MCP
servers retain their existing policies.

An independent plugin package contains a versioned `plugin.json`:

```json
{
  "schemaVersion": 1,
  "name": "literature",
  "version": "1.0.0",
  "instructions": "Preserve source identifiers when reporting evidence.",
  "skills": ["skills/citations/SKILL.md"],
  "mcpServers": [{
    "name": "literature-search",
    "command": "/absolute/path/to/node",
    "args": ["{pluginRoot}/search.mjs"],
    "env": []
  }]
}
```

`mcpServers` uses ACP's stdio, HTTP or SSE declarations. Stdio has no `type` field;
HTTP/SSE declare `type`, `name`, `url` and `headers`. `{pluginRoot}` in stdio
commands/arguments resolves to the durable installed package directory. Commands
are absolute paths or `{pluginRoot}/…`. No package setup command runs. Only
declared Skill files enter the prompt with their installed source paths so
relative resources can be resolved. Adjacent resources stay in the installed
package. Plugins are trusted local executable packages, like App backends.

Bundle missing dependencies under your App's `agent-plugins/literature/`, or
install independently through the trusted Host stdio API:

```json
{"method":"apps","id":"install-plugin","action":"plugininstall","path":"/absolute/path/to/literature"}
{"method":"apps","id":"list-plugins","action":"pluginlist"}
{"method":"apps","id":"disable-plugin","action":"pluginenable","name":"literature","enabled":false}
```

Enable/preparation installs only missing dependencies into the profile's
`agent-plugins` directory. Existing packages and disabled choices are preserved;
missing/disabled dependencies block enable or session creation with an explicit
error. Re-enable with `pluginenable` and `enabled:true`, then start a new App
conversation. Disabling an App or dependency closes dependent live connections.

App conversations created through shared Chat or `useAppAgent` receive frozen
instructions, Skill contents and MCP configuration. Ordinary conversations do
not inherit them. A declared App plugin with tools requires Desktop's App Use
endpoint and an Agent supporting MCP HTTP. Replay does not remount tools. Local
package installation, dependency resolution and ACP assembly are Pero-owned;
there is no Point runtime dependency or remote plugin marketplace.

See [the decision](../docs/adr/0027-app-agent-plugins.md) and
[verification](../docs/fitness/app-agent-plugins.md).

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
