# GitHub Desktop login verification

Verified on macOS, 2026-10-28. Decision: [ADR 0006](../adr/0006-github-desktop-login.md).

| Check | Result |
| --- | --- |
| `go -C server test -count=1 -race ./...` with strict isolated PostgreSQL | Passed |
| `bazel test //:checks //server:postgres_integration` | All 11 targets passed |
| `npm run check` | Passed |
| `npm run build:wasm`, `build:web`, `build:desktop` | Passed |
| `npm run test:remote-settings` | Passed |
| `npm run test:desktop-login` with PostgreSQL and Chromium | Passed |
| Local macOS `.app` and protocol declaration | Built and ad-hoc signed |
| Public HTTPS health and GitHub authorization redirect | 200 and 302 respectively |
| Real GitHub login and native callback | phodal identity displayed in Desktop |
| Real app quit and reopen | Restored phodal identity and authorized tasks |

## Evidence and boundaries

The server is deployed at `/opt/openpero/releases/20261028T121052Z-a9b9e92a` on
app.openpero.com. The GitHub App is configured with callback
`https://app.openpero.com/auth/github/callback`. Its secret is held in the
server's 0600 environment file and excluded from source and evidence.

The real browser completed OAuth and displayed the phodal account. The macOS
protocol opened the local Pero development bundle. The operator explicitly added
project `pero` to GitHub ID `472311`'s existing Client. Desktop then displayed
cloud tasks; quitting and reopening restored the saved connection. Login alone
does not assign project scope. No real Worker or model acceptance is claimed.

The automated suite uses an isolated Go/PostgreSQL schema, a local OAuth provider
fixture, Chromium and Electron. It covers browser continuation, explicit consent,
fixed return link, S256 proof exchange, wrong state, duplicate callback, encrypted
settings, restart, cancellation and replay without connection replacement.
Server tests additionally pin code single-use consumption and existing project
scope. The suite delivers Electron's native event directly; actual OS delivery
was checked separately with the live macOS development bundle.

Browser captures and result: `test-results/desktop-login/consent-light.png`,
`return-light.png`, `return-dark-narrow.png`, `desktop-connected.png`, `result.json`.
Credential persistence regression: `test-results/remote-settings/result.json`.
Captures use a fixture identity and do not prove real OAuth by themselves.

`target/local/Pero.app` references this checkout and is ad-hoc signed. It is not a
portable or notarized release. Windows and Linux packaging and native URL delivery
remain unverified. Completed connections persist; restarting a pending login
requires starting it again.
