---
kind: issue
status: active
date: 2026-11-02
---

# Desktop release Reader build prerequisites

The latest release run, 41216142898, failed its Virtual Cell job because the
standalone product now builds Reader Wasm, but only the Pero job installed
nightly-2026-10-28 with the wasm32-unknown-unknown target. Every release product
needs that toolchain before packaging.

The workbench package entry also builds builtin Apps before enabling release
Wasm. Each App receives a copy of Reader, so its packaged Reader must use the
same optimized release mode as the workbench. Local packaging on 2026-11-02
showed a 141 MB development Reader Wasm being copied into builtin Apps.

Install the existing pinned toolchain for both products and pass release mode
to App construction at the package boundary. Keep package size, signing,
generated-source and actual packaged-launch gates unchanged.

Local validation on macOS arm64 passed `npm run check`, four existing payload
tests, deep strict ad-hoc signature verification and launch outside the checkout
with an isolated profile (renderer and Host ready, no page errors). After
refreshing builtin Apps with optimized Reader, the DMG is 166,294,661 bytes and
correctly fails the existing 110,000,000-byte download budget. Do not raise the
budget or call this a passing release without an explicit decision.

The user requested Native after the Electron build. The existing
`build:macos-native` entry produced an arm64 `Pero Native.app` with AppIcon.icns;
signature verification and actual native window/conversation rendering passed.
It still references the local checkout and is not a portable native release.

The user subsequently requested both Native and Electron in the same prerelease,
and explicitly approved a 160,000,000-byte Electron download budget. Product
owns that limit; packaging and release verification use the same value.
Hard-linking equal staged assets keeps their original URLs and reduces the
Electron DMG to about 146 MB. Both workbench shells use the Pero app icon.

Native now resolves the installed runtime from its App bundle and ships the
shared Host/Worker/Apps/connector/ACP payload plus pinned official Node 22.23.4
(the upstream SHA-256 is embedded in `scripts/release/node.mjs`). Its approximately
80 MB DMG no longer needs a checkout or system Node. A copied App passed actual
GPUI/Host startup, builtin harness availability and complete App discovery from
a clean home outside the checkout with PATH restricted to system directories.
Provider requests and domain App computations were not exercised by this check.

Release CI adds an independent macOS Native job and retains publication only
after every product succeeds. The release tag for this change is
`v0.1.0-dev.20261102`. This record does not claim cross-platform acceptance.
