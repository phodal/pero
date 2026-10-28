---
kind: verification_report
date: 2026-10-28
---

# Virtual Cell product trial

Model and boundaries: [ADR 0008](../adr/0008-product-distributions.md).
Checks use the concurrent uncommitted working tree, not a released revision.

## Build

```sh
npm run build:product -- --product virtual-cell \
  --python /Users/phodal/.local/share/uv/python/cpython-3.12.11-macos-aarch64-none --package
```

The runtime source was an existing local uv-managed standalone CPython 3.12.11
(build 20250918). No runtime download or dependency resolver was added. The
builder successfully executes the copied Python with only `/usr/bin:/bin` in
PATH. The distribution carries its Python tree including the Python license;
release-wide dependency/license review is not certified by this trial.

Outputs under `target/products/package-com.openpero.virtualcell/`:

| Output | Bytes |
| --- | ---: |
| Virtual Cell.app regular files | 316,875,268 |
| Virtual Cell-macos-arm64.dmg | 127,710,839 |

`plutil -lint` and deep strict ad-hoc signature verification passed. An early
trial exposed malformed URL metadata; the packager was corrected and the final
package rebuilt, with plist validation now required before signing.

## Observed checks

- `npm run check`: passed (TypeScript, theme, 358 bilingual messages, contracts).
- `npm run test:product`: passed the table of Product delivery invariants.
- Real release Host compilation and App frontend compilation passed.
- Real packaged Electron launched with a new profile and restricted PATH.
  The window immediately displayed Virtual Cell, with its 660-cell atlas.
- The App frame had neither the workbench nor the product preload bridge.
- The bundled Python backend imported a synthetic example and computed the
  three existing baseline models. Reactions ran with edited duration.
- Light/dark themes, live Chinese/English switching and an 800-pixel window
  were checked. Screenshots were inspected for content and overflow.
- A restart retained the selected language and imported input.
- Moving the bundled Python executable aside produced a visible startup error;
  restoring it and pressing Retry successfully opened the App. No system Python
  fallback occurred.
- The final DMG was mounted read-only and its App copied outside the repository.
  Deep strict signature verification and all six check groups passed on that copy. The test supports
  `PERO_PRODUCT_EXECUTABLE` to target a relocated packaged executable.

Evidence is in `test-results/product/result.json`, `atlas.png`, `simulation.png`
and `dark-narrow.png`. `npm run test:product:e2e` runs the real Electron check;
it requires a built package and takes native window focus. The missing-runtime
case temporarily renames the selected trial package's Python executable and
restores it in a finally block; use a disposable package copy for this check.

## Limits

This is a macOS arm64 development distribution with ad-hoc signing. No
notarization, updater, existing-profile App upgrade/migration, Windows/Linux
package or scientific acceptance is claimed. Product theme overrides are
session-only; language uses Host-owned persistent settings. The workbench
packager's existing branch was preserved, but its full DMG suite was not rerun.

## Configurable branding and composition follow-up

The rebuilt Virtual Cell package now uses the product-relative `icon.svg`.
`CFBundleIconFile` is `product.icns`; the Electron default icon is removed.
The SVG was rendered and visually inspected, and deep strict signing verified.
Generated platform icon files are build artifacts rather than committed binaries.

The multi-App composition Electron check passed with two HTML fixture
Apps in one temporary product. It verified catalog display names, switching,
retained input and refusal to open an excluded App. This proves product shell
composition; the fixtures are not integrated scientific Apps or shared workflows.
Screenshots and result are in `test-results/product-composition/`.
