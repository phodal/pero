# Automations App

The App compiles Point's original Workbench `AutomationPage`, its editor, rows,
source history, template gallery, controls, icons, CSS and design tokens. The
Point checkout is a build input; no Point service or source checkout is needed
when the resulting App runs. Point's source files are not modified.

Build from the installed source dependency tree:

```sh
node scripts/build/automation-app.mjs --point-root /Users/phodal/ai/point
```

`PERO_POINT_ROOT` selects another source checkout. Build output is in `dist/`.
`source-receipt.json` records the Point revision and SHA-256 of every consumed
Point source. The built package carries the SDK's existing license notices.

The only new frontend code is the App frame and transport boundary. Original
Point REST requests are forwarded as `{method,path,body}` to `/host/automation`.
The Host returns `{status,body}`; the original page continues handling HTTP
success, conflict, unavailable and error responses. Connector management uses
the separately declared `/host/connectors` permission. Run links emit the
bounded `pero:app:open-session` message for the parent shell to select an existing
Host session. Opening the App does not start an Automation or Agent.

The Host remains the authority for definitions, scheduling, execution, history
and access checks. Building the original UI is not evidence that all Point
backend capabilities are available; parent-shell and real Host verification
must cover the supported operations before release.

Frontend checks: `node --test apps/automations/test/transport.test.mjs` verifies
the capability boundary and HTTP error/204 behavior. `node
apps/automations/test/preview.mjs` starts a loopback-only fixture for inspecting
the compiled App without running an Agent. Browser checks covered the list,
original creation editor and submission, template gallery, dark theme, and a
640px narrow window. The fixture does not prove real scheduling, connectors,
execution, persistence or parent session navigation.
