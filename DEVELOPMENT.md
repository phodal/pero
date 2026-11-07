# Pero Development

Source setup, local development, standalone App packaging and verification. For the product overview and downloadable builds, see [README](README.md) or [简体中文](README.zh-CN.md).

## Choose a development path

- **Desktop workbench:** Electron, the GPUI/Wasm interface, Rust Host and the bundled Go Agent Harness. Local use does not require running the Go control-plane service or PostgreSQL.
- **Standalone App:** a separate Electron product with its own profile and selected Apps. The Virtual Cell product bundles Python and has no Agent chat. Its source build includes the shared Wasm reader, but not the full workbench.
- **Control plane:** an optional Go service with PostgreSQL for shared tasks, remote Workers and GitHub intake. It is separate from the local Go Harness built into Desktop.

## Desktop from source

Use Node.js **22.18+**, Go **1.27.3** (the Desktop/release CI version), Rust stable, Rust **`nightly-2026-10-28`** with the Wasm target, and Git. Node 22.18+ also supports the TypeScript entry points used by the product tooling. Install the native compiler/linker and platform libraries required by Rust and Electron; the [Desktop CI setup](.github/workflows/desktop-check.yml) records the platform-specific build dependencies.

The GPUI Kit checkout must be **0.9.0**, pinned to `7591a35eced761e3613c01e71ff04c10129dae1a`, matching the [release workflow](.github/workflows/release.yml). The build applies tracked patches to a cached copy, leaving that checkout unchanged. Keep it outside Pero and use LF source files, including on Windows.

The following commands use a POSIX shell:

```bash
git clone https://github.com/phodal/pero.git
cd pero
npm ci
node node_modules/electron/install.js
rustup toolchain install stable --profile minimal
rustup toolchain install nightly-2026-10-28 --profile minimal --target wasm32-unknown-unknown

git -c core.autocrlf=false clone https://github.com/longbridge/gpui-kit.git ../gpui-kit
git -C ../gpui-kit checkout --detach 7591a35eced761e3613c01e71ff04c10129dae1a
export PERO_GPUI_KIT_PATH="$(cd ../gpui-kit && pwd)"

npm run dev
```

`npm run dev` builds Apps, Wasm, Host, the Go Harness, native helpers and Worker before launching Electron. Builds may download additional App dependencies, crates, fonts and Wasm tools; installing the root npm packages alone is not an offline setup. After a successful build, `npm start` launches the existing outputs without rebuilding.

In the app, choose **New task**, an Agent and a workspace. A fresh profile defaults to the built-in Pero Agent; configure its provider in **Settings → Built-in Agent**. Codex, Claude and Grok/OpenCode have separate installation and authentication requirements. See [Agent setup](desktop/README.md#agents-and-conversations), [font preparation](web/public/fonts/README.md) and the [GPUI upgrade record](docs/fitness/gpui-kit-0.9.md).

To preview a local App inside Desktop, run `npm run dev:apps`. It uses the same Desktop build prerequisites and opens Virtual Cell in a separate profile. Python selection for an isolated preview differs from a fresh normal workbench profile; see the environment setup below. See [apps/README.md](apps/README.md).

`npm run dev:native` opens the native GPUI development preview and watches its sources. It builds the Go Harness, connector helpers and Rust runtime too; it is a separate path from Electron/Wasm. See [Native GPUI preview](desktop/README.md#native-gpui-preview) for platform dependencies, isolation and current limits.

## Python environments and advanced overrides

A normal fresh **Electron** workbench binds its default App environment to `~/.pero/environment/pero-python312`. Opening Data with that environment missing reports **Prepare environment**; choose it explicitly and wait for readiness before importing data. Opening the App only checks readiness and does not silently install Python. An existing saved environment choice is preserved.

Preparation reuses available uv/CPython 3.12 or acquires missing tools. If uv is absent, the Host downloads the official pinned uv 0.12.20 installer. It creates an isolated CPython 3.12 venv and, for Apps that declare dependencies, installs their pinned binary wheels. First preparation can therefore require internet access even when the subsequent Data workflow is local. Managed tools, Python installations and cache live under the environment directory; shell profiles and global PATH are not changed. Failed preparation is shown with a retry action. This describes the November 4 Electron first-use path, not a promise of an offline package or Native parity.

For a pre-provisioned or offline setup:

- For a pre-provisioned venv, Host settings `app_python.apps.<app-name>` select the App-specific environment before `app_python.default`. Configure an absolute **venv directory**, not a Python executable; it must contain a working interpreter and `pyvenv.cfg` with `include-system-site-packages = false`. The required Python version and pinned packages must already be present for offline startup. Invalid saved bindings fail rather than silently falling back.
- `PERO_APP_PYTHON` is a fallback executable for Apps without a selected venv and without declared dependencies, such as Data in an appropriately isolated development profile. Set it before launching. It suppresses automatic default binding on a new workbench launch, but **does not override an existing `app_python` binding** or bypass an App's dependency/version checks. Data's fallback interpreter needs Python 3.10+.
- `PERO_DESKTOP_DATA_DIR` isolates an Electron preview and skips normal-home initialization; the preview's own saved settings still apply. Do not assume behavior observed with that override is normal installed-workbench first use.

See [App environment rules](apps/README.md#python-environments) for current source behavior. The standalone Product's `python` setting controls its packaged fallback runtime; it does not replace workbench settings or establish that a fresh workbench environment is ready.

### Native fresh-profile limitation

In the November 4 Native package, initialization selects `~/.pero/environment/pero-python312`, but the Host derives its App root from `~/.pero/native/settings.json` when `PERO_APPS_ROOT` is unset. Its managed preparation target is therefore `~/.pero/native/environment/pero-python312`. If the selected shared environment does not exist, these different paths cause validation to reject the missing `pyvenv.cfg` before preparing a new environment. **Prepare environment is not a guaranteed clean-profile recovery for this Native package.** An existing working environment can hide this first-use problem.

Use Electron for the README's first experience. Native needs a separate correction and clean-profile acceptance; this documentation change does not repair its runtime. The source path is [Native initialization](https://github.com/phodal/pero/blob/v0.1.0-dev.20261104/crates/pero-ui/src/native.rs), [Host App-root selection](https://github.com/phodal/pero/blob/v0.1.0-dev.20261104/crates/pero-host/src/apps.rs), and [Python preparation admission](https://github.com/phodal/pero/blob/v0.1.0-dev.20261104/crates/pero-runtime/src/apps/python.rs). The path mismatch was inspected in source, not reproduced in a fresh installed Native GUI during this documentation task.

## Standalone App: Virtual Cell

Use the npm, Electron, Rust and pinned GPUI setup above. The current builder always builds the shared Wasm reader, so it still needs the pinned nightly and `PERO_GPUI_KIT_PATH`. The default `virtual-cell` product has no chat and does not build the Go Agent Harness or require the control-plane service/PostgreSQL. Products with `chat: true` additionally build chat-only Wasm and Agent adapters, including the Go Harness.

For a macOS package, supply a relocatable Python tree for the target architecture, including its standard library, shared libraries and licenses:

```bash
npm run build:product -- --product virtual-cell \
  --python /absolute/path/to/relocatable/python --package
```

The build emits a staged distribution in `target/products/virtual-cell/` and `Virtual Cell.app` plus a DMG in `target/products/package-com.openpero.virtualcell/`. The app opens directly into Virtual Cell, uses its own profile and carries Python with it. The builder copies the supplied runtime; it does not download Python or resolve scientific dependencies.

The recorded trial covers a relocated macOS arm64 package with ad-hoc signing. Notarization, updates, existing-profile migrations and Windows/Linux Virtual Cell packages remain open. See [ADR 0008](docs/adr/0008-product-distributions.md) and the [verification record](docs/fitness/products.md). A successful source build is not evidence that an installed package or a scientific method has been validated.

## Control plane (optional)

Shared tasks, remote Workers and GitHub intake use the separate Go service. The server module declares Go 1.24; its CI uses Go 1.26.4. PostgreSQL is required to run the service. If you are also building Desktop, use its Go toolchain requirement above.

From the repository root, with PostgreSQL running and a `pero` database available:

```bash
cd server
PERO_DATABASE_URL=postgres://localhost/pero \
  PERO_OPERATOR_TOKEN=change-me \
  go run ./cmd/server
```

Replace the example operator token before use. The service listens on `127.0.0.1:8787`. Follow [server setup](server/README.md) to provision project-scoped client access, then [connect Desktop](desktop/README.md#remote-tasks) and optionally [bind GitHub repositories](server/README.md#github-issue-intake). Remote execution also requires a separately provisioned [Worker](crates/pero-worker/README.md).

## Verification

Run commands from the repository root. Build first for checks that consume generated Wasm bindings and Host binaries:

```bash
npm run build
npm run check                    # TypeScript, generated theme/design, locales, contracts, icons
npm test                         # Rust suites through the pinned GPUI wrapper
npm run test:contracts           # Host stdio output against the JSON Schema
npm run test:product             # Product model and shell/payload tests
# npm run test:product:e2e        # real packaged Electron; requires a disposable built package
go -C server test -race ./...    # control plane; PostgreSQL cases need PERO_TEST_DATABASE_URL
```

`npm run test:product` can run after npm dependency installation without a Desktop build. On a clean checkout, `npm run check` needs the generated reader Wasm bindings; a missing `web/src/reader-wasm/pero_reader_web` is not resolved by `npm ci` alone. Contract tests need the built Host. Linux Electron tests also need X11/Xvfb and the platform runtime libraries.

CI has separate source, platform and opt-in acceptance jobs; passing one is not a full cross-platform pass. PostgreSQL, live GitHub and real-model checks have their own prerequisites. Every suite and what it proves is listed in [docs/fitness](docs/fitness/README.md). Record checks as passed, failed, blocked or not run, and keep source checks separate from actual Desktop, provider and installed-package acceptance.

New to the code? Read [ARCHITECTURE](docs/ARCHITECTURE.md), then the [ADR index](docs/adr/README.md), then [fitness](docs/fitness/README.md). Colors follow [DESIGN.md](DESIGN.md). Regenerate the README diagrams with `npm run gen:architecture` and `npm run gen:overview`.
