# Pero Apps

`npm run dev:apps` builds and opens the first App, Virtual Cell, in an isolated
developer profile. `npm run dev` uses the ordinary Desktop profile. Both seed
builtins once; a removed App stays removed on restart.

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

Version 1 provides no App-to-Agent tools, Task/Run dispatch, remote installation,
marketplace, update service or scientific acceptance. See [ADR 0007](../docs/adr/0007-local-app-platform.md)
and [verification](../docs/fitness/apps.md).
