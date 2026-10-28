# Pero Development

Setup, local development, standalone App packaging and verification. For the product overview, see [README](README.md) or [简体中文](README.zh-CN.md).

## Quick start

### Desktop

Requirements: Node.js 22.12+, Rust stable and `nightly-2026-10-28`, and a [gpui-kit](https://github.com/longbridge/gpui-kit) checkout at `ec89cfc`.

```bash
git clone https://github.com/phodal/pero.git && cd pero
npm ci
node node_modules/electron/install.js
rustup toolchain install nightly-2026-10-28 --profile minimal --target wasm32-unknown-unknown
export PERO_GPUI_KIT_PATH=/absolute/path/to/gpui-kit
npm run dev
```

In the app, choose **New task**, pick an agent (Codex, Claude, or Grok through OpenCode) and a workspace. Each agent uses its own local login. Agent setup, fonts, and offline builds are in [desktop/README.md](desktop/README.md).

To try a local App instead, run `npm run dev:apps`. It opens Virtual Cell in a separate profile; see [apps/README.md](apps/README.md).

### Standalone App: Virtual Cell

After cloning and installing the npm dependencies and Electron above, build a product on macOS with Node.js 22.18+ and Rust stable. This path skips GPUI/Wasm and does not need the Go service or PostgreSQL. Supply a relocatable Python tree for the target architecture, including its standard library, shared libraries and licenses:

```bash
npm run build:product -- --product virtual-cell \
  --python /absolute/path/to/relocatable/python --package
```

The build emits a staged distribution in `target/products/virtual-cell/` and `Virtual Cell.app` plus a DMG in `target/products/package-com.openpero.virtualcell/`. The app opens directly into Virtual Cell, uses its own profile and carries Python with it. The builder copies the supplied runtime; it does not download Python or resolve scientific dependencies.

The recorded trial covers a relocated macOS arm64 package with ad-hoc signing. Notarization, updates, existing-profile migrations and Windows/Linux packages remain open. The standalone shell currently has no Agent chat. See [ADR 0008](docs/adr/0008-product-distributions.md) and the [verification record](docs/fitness/products.md).

### Control plane (optional)

Shared tasks, remote workers, and GitHub intake need the Go service. Requirements: Go 1.24+ and PostgreSQL.

```bash
cd server && PERO_DATABASE_URL=postgres://localhost/pero PERO_OPERATOR_TOKEN=change-me go run ./cmd/server
```

It listens on `127.0.0.1:8787`. Then [connect Desktop to it](desktop/README.md#remote-tasks) and, if you want, [bind GitHub repositories](server/README.md#github-issue-intake).

## Verification

```bash
npm run check                    # TypeScript, generated theme, locales, contracts
npm test                         # Rust tests
npm run test:contracts           # Host stdio output against the JSON Schema
npm run test:product             # Product model invariants
# npm run test:product:e2e        # real packaged Electron; requires a disposable built package
go -C server test -race ./...    # control plane; PostgreSQL cases need PERO_TEST_DATABASE_URL
```

CI runs these on Linux, Windows, and macOS, plus Bazel `//:checks`. Electron, PostgreSQL, live GitHub, and real-model suites are opt-in. Every suite and what it proves is listed in [docs/fitness](docs/fitness/README.md).

New to the code? Read [ARCHITECTURE](docs/ARCHITECTURE.md), then the [ADR index](docs/adr/README.md), then [fitness](docs/fitness/README.md). Colors follow [DESIGN.md](DESIGN.md). Regenerate the README diagrams with `npm run gen:architecture` and `npm run gen:overview`.

