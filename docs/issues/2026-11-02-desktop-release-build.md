---
kind: issue
status: active
date: 2026-11-02
---

# Desktop release Reader build prerequisites

## 2026-11-14 standalone preparation recurrence

Virtual Cell release smoke in PR #231 run 43558147069 reached the packaged App
gate but did not expose Cells & perturbations: the retained UI reported Could
not open app / Prepare the App environment before opening it. The same failure
is present in prior unrelated branch run 43545052870 (job 132294398899), before
the Project Agent PR. Product packaging and that smoke test are unchanged by
this PR. This is a separate unresolved release preparation failure; Project
Agent merge validation does not establish successful packaged publication.

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

## First tagged run and follow-up

[Run 41404974937](https://github.com/phodal/pero/actions/runs/41404974937)
passed the Native package build, verification and actual installed launch check.
Publication was correctly withheld because other products failed:

- Virtual Cell's standalone shell imported `app-examples.ts`, which directly
  imported the full workbench Wasm even though standalone Products do not build
  it. The shell must receive the example-state callback from its composition root.
- Linux Electron reached Host readiness before asynchronous remote preferences
  arrived. The smoke check read `connection.url` too early; it must wait for the
  expected URL rather than only Host readiness.
- macOS Electron hit `hdiutil create: Resource busy`; no package was accepted.
  Both packagers now create HFS+ images without Spotlight indexing and retry
  only that exact transient failure, at most three attempts. Other failures
  remain immediate errors; a passing CI rerun is still required.
- Windows was cancelled; this is not a successful platform verification.

The Native unit suite also exposed `view_bounds` importing GPUI's `test` macro
through `super::*`. Explicit imports restore the ordinary Rust test attribute;
all 50 Native library tests pass after that change.

The follow-up candidate will use a new version tag, preserving the original tag.

Follow-up local checks passed: all 50 Native library tests, TypeScript/generated
checks, standalone browser-shell bundling with Workbench Wasm explicitly denied,
and the actual Electron release smoke (Host ready, exact default Task Center URL,
unconfigured credentials, no page errors). The shared HFS+/no-index disk-image
builder also created the complete Electron image successfully on this Mac.
These checks do not turn the failed first CI run into a successful publication.
