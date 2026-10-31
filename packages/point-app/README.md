# Point App runtime in Pero

Install a built Point App directory through Pero's existing **Install from
folder** action. No source edits or manual conversion are needed. Rust Host
recognizes Point's manifest, prepares its private installed representation,
and continues to own installation, enable state, backend lifetime and data.

The shared browser runtime uses Point's actual `@point/app-sdk`, UI/chart
modules and one React/ReactDOM per frame. App bundles and backend sources are
copied byte-for-byte. A readiness launcher supplies Point's `PORT`,
`POINT_APP_ROOT`, `POINT_APP_DATA` and HMAC secret to the unchanged backend;
it does not create another App supervisor or Agent runtime.

## Build input

The SDK and Project domain libraries are build-time dependencies, not a running Point service. Build once:

```sh
POINT_ROOT=/absolute/path/to/point node scripts/build/desktop.mjs
```

The Point checkout needs its SDK dependencies installed; building the private
Project operation also needs Go 1.26. This produces the
self-contained `packages/point-app/dist` runtime and includes it in workbench
payloads. Installed Apps do not need the Point checkout or Point Desktop.
`runtime.json` records the Point revision, bundled source/dependency digest and Project binary hash.

For an explicit reusable package (optional):

```sh
node scripts/build/point-app.mjs --point-root /absolute/path/to/point \
  --source /absolute/path/to/point/apps/map --out /absolute/new/output
```

## Implemented contract

- Original `panelTabs` IDs and `.mjs` entries; one to eight panels. Each panel
  receives its own HTML entry and SDK provider. Open panels remain mounted.
- Point's own `/apps/<name>/api/...` namespace, HTTP methods, queries, binary
  bodies, declared body limits, response status and domain headers. The private
  Desktop/native proxy signs the exact method, target and body using Point's
  HMAC protocol; caller credentials and signatures are not forwarded.
- Node and standard-library Python HTTP backends under the existing Host
  process group. App resources are retained; source `data/`, installation
  records, dependencies and caches are excluded. Live data stays in Pero's
  `app-data/<name>` and survives uninstall/reinstall.
- `permissions.storage` and `/api/apps/<name>/config` GET/PUT, rechecked and
  persisted by Rust Host under the App's existing data directory.
- Local Project list/types/create/read/revision/context APIs and honest local Hub
  ownership, under one Pero-owned Project journal. Creation and mutations retain
  Point idempotency/revision headers. Repositories, delivery/Agent operations and
  shared Hub connections are not yet implemented; these return explicit failures.
- Parent activity, zh/en, Point light/dark tokens, local notifications,
  integrity-checked declared examples and user-selected example loading.
- Point semantic objects through the existing App Use carrier, including
  `data-point-object` geometry and stale-action revision checks.
- App-scoped chat drafts/references through the existing Pero composer. No
  automatic submission. Scope-changing chat options remain unavailable.
- Declared Point Agent write tools retain their names, schema and HTTP method
  in Desktop's existing write/approval path. This does not establish real-model
  or native Agent-tool acceptance.

The install gate currently rejects Session/Workspace APIs,
Host grants (Agent, Calendar, Mobile, agent-plugin), events, `exec` backends and
`agentPlugin` and unavailable shared modules such as `@point/pages-ui`. These are remaining compatibility work, not silently granted or
replaced with empty successful responses. The intended authority is **Pero
itself**, without a running Point service. Do not weaken an App's declarations
or acceptance rules to make it install.

This is trusted local executable code under the existing App trust boundary.
It is not a sandbox. Point token themes follow light/dark; Pero accent/style
packs and Point's scoped conversation/desktop slots are not yet fully mapped.

## Verification

```sh
node --test packages/point-app/*.test.mjs desktop/src/main/point-apps.test.ts
POINT_ROOT=/absolute/path/to/point node tests/e2e/point-apps.mjs
```

The opt-in suite requires `target/point-apps/debug/pero-host`, built with
`CARGO_TARGET_DIR=target/point-apps node scripts/cargo.mjs build -p pero-host`,
and the existing web assets. It installs nine original Apps into a temporary
profile, tests real Node/Python APIs and interactions, and cleans up owned
processes/profile data. Receipts, generated install inputs and screenshots stay
under ignored `test-results/point-apps/`. See the
[verification record](../../docs/fitness/point-apps.md) for the exact limits.
