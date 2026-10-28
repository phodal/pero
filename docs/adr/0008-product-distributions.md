# Product distributions

Status: implemented first slice, 2026-10-28.

## Model

An **App** owns domain UI, backend entry and its existing versioned `app.json`.
A **Product** owns delivery identity, version, included Apps, icon, shell and runtime
policy. A **Distribution** is the assembled output for the build machine's
platform and architecture; it is not a new runtime service or state machine.

`packages/product/product.ts` is the immutable Product type and the single owner
of Product definition validation. Its pure parser performs no I/O. The build
and Electron composition roots read configuration and pass it through that type.
The builder checks that the selected entry exists in the selected App manifest.

- `workbench` has no fixed App entry. `products/pero.json` supplies the existing
  Pero packaging defaults; the established workbench command remains available.
- `app` must select a panel from its included Apps. Virtual Cell is the first
  product and has a separate macOS bundle ID, profile and launch entry.
- `python: bundled` requires a supplied relocatable Python directory containing
  its standard library, shared libraries and licenses. The builder copies it and
  verifies the copied interpreter. It does not download or resolve a runtime.
- `python: system` explicitly selects the machine interpreter for development
  distributions. A bundled product never falls back to system Python.

## Composition

The App shell is a full-window instance of the existing Web App surface.
When `apps` includes multiple Apps it shows a compact selector using their
catalog display names; a single App has no selector. Switching retains panel
state. `Product.selectApp` owns the rule that only included Apps can be opened. It
loads no GPUI Wasm navigation. Electron reuses `DesktopApps` for Host requests,
private credentials and `pero-app://` serving. App frames have no Electron
preload. Rust Host remains the one owner of installation and backend children.

Product preferences use the existing Host runtime-settings file. Language is
persisted there; theme follows the OS with session menu overrides. Domain data
lives in the existing Host `app-data` directory beneath the product profile.
The single-App shell exposes no installation/removal interface.

An optional `icon` is an SVG path relative to the product configuration. The
builder stages it with the Product; the macOS packager renders the iconset with
`rsvg-convert`, converts it with `iconutil`, and writes `CFBundleIconFile` before
signing. Generated PNG/ICNS assets stay in the build output. Install librsvg on
the build machine to package SVG icons.

The macOS packager accepts the staged Distribution, retains the established
workbench packaging path and generates a product-named App/DMG. The App's fixed
internal executable name remains `Pero`; display name, bundle identity and
version come from Product. Standalone products do not register Pero OAuth links
or include Agent adapters. Output sizes are reported without applying the
existing Pero workbench's 100 MB budget to a Python-bearing product.

## Build and trial

```sh
npm run build:product -- --product virtual-cell --python /path/to/relocatable/python --package
npm run test:product
npm run test:product:e2e
```

The first command emits `target/products/virtual-cell` and
`target/products/package-com.openpero.virtualcell/Virtual Cell.app` plus a DMG.
This first builder targets the current machine; it does not implement cross
compilation. `--python` is explicit so local absolute paths never enter the
committed product definition.

## Limits

This slice does not implement App upgrades, data migrations, runtime downloads,
auto-updates, App sandboxing, a marketplace or a generic recipe system. The
existing one-time builtin seed means an existing profile retains its installed
App version; use a new trial profile for this first build. A release upgrade
policy needs a separate design before distributing updates to existing users.
Signing is ad-hoc, with no notarization or production release claim. Scientific
acceptance is independent from packaging and UI verification.

See [product verification](../fitness/products.md) for observed trial results.

## Native release distributions

The release workflow builds Pero on macOS arm64, Windows x64 and Linux x64 in
parallel. Virtual Cell is a separate macOS arm64 matrix entry, using the existing
Product builder with a pinned, checksum-verified standalone Python tree. It does
not build the GPUI workbench or include Agent adapters. Runtime acquisition lives
in the release shell; Product validation and staging remain unchanged.

All native jobs must pass package verification and actual Electron launch before
one publication job collects the archives, build metadata and checksums and makes
the prerelease visible. Windows uses a portable ZIP, Linux a portable tar.gz and
macOS the existing ad-hoc-signed DMG. This configuration is not evidence of native
Windows/Linux acceptance; see [release verification](../fitness/release-products.md).

## External App artifacts

An App owner may build an `AppBundle` outside this repository. Its explicit file
list is the delivery boundary: Pero stages those files, does not run owner build
commands, and does not vendor the owner's source packages. COBOL source, rules,
engines and workbench implementations remain owned by Point. An external product
configuration and output directory are accepted by the same builder.

The Host backend declaration now supports Python and Node entries under the same
data/token/readiness/lifecycle contract. A Node-bearing Product must explicitly
choose `node: system` or `node: bundled`; the latter takes a supplied relocatable
runtime. The Host remains the process owner. This does not translate Point
manifests, expose Point Host APIs, register domain Agent tools, or replace Point
execution proofs with the generic App backend token.

See [external App bundles](../fitness/external-app-bundles.md) for the contract,
build invocation and the bounded Point integration observation.

## Configurable composition

A product can be one domain App or a combination of domain Apps. For example:

```json
{
  "schemaVersion": 1,
  "id": "com.example.researchlab",
  "name": "Research Lab",
  "version": "1.0.0",
  "shell": "app",
  "icon": "brand/icon.svg",
  "apps": ["cell-atlas", "reaction-lab"],
  "entry": { "app": "cell-atlas", "panel": "main" },
  "python": "bundled"
}
```

Each App keeps its own manifest and data directory. A product's stable ID owns
its shared settings/profile. Changing name or icon does not require changing
App source. The entry selects the startup App; the selector exposes the included
Apps, each with its own panel. Configuration does not imply automatic data or
workflow integration between Apps.

`node tests/e2e/product-composition.mjs` assembles a temporary two-App product
from existing build outputs and HTML fixtures and checks real Electron switching, catalog names,
retained input and exclusion of Apps outside the product.
