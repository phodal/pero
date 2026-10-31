# Point App compatibility

Package an existing Point App for Pero without editing its business source or
rewriting its compiled panel. The build supplies one React/ReactDOM and Point's
actual SDK in an isolated Pero HTML frame. It uses the existing Rust App store,
backend process lifetime and authenticated Desktop proxy.

```sh
node scripts/build/point-app.mjs \
  --point-root /absolute/path/to/point \
  --source /absolute/path/to/point/apps/ontology-explorer \
  --out /absolute/path/to/output/ontology-explorer
```

The output directory must not exist. Point SDK dependencies must already be
installed and the App's `ui/` bundle built by Point's AppBuilder. This command
never runs an App build script, downloads dependencies, installs into a user's
profile or changes the source checkout. Select the output directory in Pero's
existing Apps install action, then enable/open it. Do not overwrite a different
App with the same name: Point and Pero Virtual Cell intentionally share an identity.

## Supported contract

- One `contributes.panelTabs` component exported as default from a prebuilt
  `.mjs` module. Its `ui/` assets and bundle are copied unchanged.
- Real Point SDK and UI/chart modules, with a single shared React per frame.
- Parent-controlled activity, zh/en locale and Point light/dark tokens. App
  state remains mounted when switching Pero content tabs. Point-specific
  palette/style selection is not mapped to Pero accent/style settings.
- Panel-local computation and file import/export. Notifications render in the
  frame. Navigation, chat launch and badges report unavailable.
- Own-App API permissions only. The SDK rewrites `/apps/<name>/api/...` onto
  the existing Pero `/api/...` proxy; no Host or cross-App APIs are lent.
- Python backends using standard-library `ThreadingHTTPServer`, port `auto`,
  `/health`, and Point's proxy HMAC protocol. The adapter binds loopback port 0,
  reports readiness and maps the Host data directory. It authenticates the
  private Pero token, checks declared API prefixes/body size, then signs the
  exact method, target and body for the original Point handler. The backend
  stays inside the existing Host-owned process, with no second supervisor.
  Required runtime package directories are `backend`, `examples`, `evidence`
  and `assets`; Apps needing other resources need an explicit extension.

Host grants, events, global APIs, multiple panels, Node/exec backends, extra
backend declarations and Agent tools are rejected during packaging. App Use
requests return `APP_USE_UNAVAILABLE`; Point's semantic objects are not yet
connected to Pero's registry. Neither Agent execution nor scientific acceptance
is implied by rendering or running deterministic calculations.

`point-build.json` records source revisions, bundled source/dependency input
digest and copied file hashes. SDK attribution travels in `licenses/point-sdk`.
Generated packages are trusted local executable code under the existing App
trust boundary; this adapter adds no execution sandbox.

## Verification

```sh
node --test packages/point-app/manifest.test.mjs
POINT_ROOT=/absolute/path/to/point node tests/e2e/point-apps.mjs
```

The opt-in suite uses an isolated profile and the existing built Pero Host,
Desktop and web assets. It tests Welcome, Ontology Explorer and Virtual Cell,
real install/enable, proxy authentication, a Python calculation, locale, theme,
keyboard action and retained state. It closes its processes and removes its
temporary profile; packages, receipts and screenshots remain under ignored
`test-results/point-apps/`. See the [verification record](../../docs/fitness/point-apps.md).
