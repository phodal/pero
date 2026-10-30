---
kind: verification_report
date: 2026-10-30
level: local-runtime
---

# Computer Use implementation and acceptance

The implementation is in `use/computer/`, based on Point
`a1b9150059a8858bac68497e6789e2b7cac8b08c` for macOS/Windows. Cua
`cbe3991f268c7e155bd028fbc9b449b40146cfe9` supplies the platform-separation
reference. The [platform matrix](../../use/README.md) records supported delivery
and observation kinds, including the X11/Wayland and keyboard-layout limits.
Paper Agent and appearance work in this shared checkout are separate concerns.

## Clean source build repair, 2026-10-30

The original build fetched private `phodal/point` into ignored `target/`.
Local acceptance reused that extracted source and missed the clean-runner
authentication prerequisite. The native dependency closure is now tracked in
`use/computer/vendor/point/`; the build uses local Cargo paths and never fetches
Point. `SOURCE.json` and the vendor README retain the revision, crate selection
and module adaptations. Each copied code file stays below 1000 lines.

`node tests/build/computer-source.mjs` copies only build sources/manifests and
contract locale inputs into an empty temporary directory, denies Point access
through Git configuration, sets the old source override to a nonexistent path,
then runs the actual locked native test/build entry point. It also checks that
no legacy Point checkout or extraction cache was created.

The isolated build passes on macOS, including an archive of committed source
at `04db03c` with concurrent working-tree changes excluded. In a new Linux aarch64 container, starting
with an empty Cargo registry cache, this also passes:

```sh
xvfb-run -a node tests/build/computer-source.mjs --x11
```

That command runs the existing Tk/XTest acceptance against the executable
built in the temporary source directory: screenshot, click, text, key, scroll,
drag, unmapped text refusal and stale observation refusal all pass. The Linux
CI step now uses this command; the three native CI lanes retain tests, Clippy
and a normal build. The isolated container was removed and its VM stopped.

Native macOS Clippy and cross-target Clippy for Windows GNU and Linux musl pass
with `--locked --all-targets -- -D warnings`. The copied five-crate workspace's
tests pass on macOS; platform-only live tests remain ignored as upstream defines.
Source comparison confirms only the documented manifest/module organization
changes relative to the pinned upstream source. The native lockfile is unchanged.

An additional macOS GUI rerun stopped before input at guard-window activation;
the foreground process was `loginwindow`, and both owned fixtures recorded zero
input effects. Both fixtures were closed. This does not renew the earlier GUI
acceptance below. Hosted CI for the repair remains pending until these commits
are pushed; local checks are not a hosted CI result. The
[build incident](../issues/2026-10-30-computer-use-private-build-dependency.md)
records the cause and resolution.

## Implemented boundary

TypeSpec owns observation/action values and private runtime transport. Generated
Schema/TypeScript and Rust share the vocabulary. Pure Rust admission binds the
capability, target, observation, element and image point. One shared native
runtime consumes observations and checks live window identity and geometry;
platform modules own only platform I/O.

The authenticated Desktop MCP exposes `computer_use` through the existing
selected/running conversation authority and Agent approval policy. A model
cannot enable the feature or request OS permissions. Desktop owns default-off
Host-persisted settings, drained process stop, private durable input intents and
receipts, images and SHA-256 metadata. Reused request IDs do not replay input;
interrupted acknowledgements remain unknown. Human Stop disables admission
until re-enabled. Model stop only expires native handles.

macOS uses AX, an in-process ScreenCaptureKit capture bridge and window-bound
PID input. One event is posted once: the real Agent caught duplicate callbacks
from Point's dual-channel SkyLight recipe, which Pero no longer uses. Synthetic
focus is scoped to the input sequence; it does not make the target frontmost.
Foreground pointer input uses Apple's [system-wide AX hit test](https://developer.apple.com/documentation/applicationservices/1462077-axuielementcopyelementatposition?language=objc)
to validate the actual topmost application rather than treating the noninteractive
full-display Dock surface as a pointer recipient.

Windows uses UIA, WGC/PrintWindow and explicit foreground input. X11 uses native
window capture and XTest, with no accessibility tree or background delivery.
Windows/X11 wheel input is quantized; X11 text must be mapped in the current
keyboard layout. Pure Wayland returns unavailable rather than impersonating an
X11 desktop. No Cua daemon or second authorization system is shipped.

## Current observed evidence

| Lane | Result |
| --- | --- |
| `npm run check` and shared Schema/Rust corpus | Pass |
| Rust contracts/runtime/Host/UI tests | 79 tests plus doc tests pass |
| Host JSONL conformance | Pass, including persisted Computer settings and invalid input |
| Native CoreGraphics unit test | Pixel units and direction pass without posting input |
| macOS native Clippy, all targets, `-D warnings` | Pass |
| Windows `x86_64-pc-windows-gnu` check/Clippy | Pass; no Windows execution claimed |
| Linux `x86_64-unknown-linux-gnu` check/Clippy | Pass |
| macOS owned AppKit fixture | Actual AX button effect, Chinese/emoji text, selection chord, exactly one pixel-click callback, pixel scroll, background drag, guard isolation, duplicate/stale receipts and stop pass |
| Foreground macOS drag | Passed a separate owned-window run; overlapped target attempts refuse input |
| Real Codex `gpt-6.1-sol` | 21 native MCP calls through ACP/Host/Desktop; independently verified Count=1, Text=`Agent 验收 🌱`, Clicks=2 including drag pointer-down, Scroll=-120, Drags=5 |
| Linux Xvfb/Tk/XTest | Unmapped Unicode is refused without partial text input; real Linux process: JPEG inspected, button Count=1, text/key effect `Linux verifie`, Scroll=1, Drags=9 and stale observation refusal pass |
| Transport/MCP failure suite | Validation, missing binary, default-off, duplicate/conflicting IDs, restart journal, uncertain effects, exit drain, caller authority and evidence deletion pass |
| Standalone Chat Product | Shared Computer menu, persisted enable/stop and complete fixture Chat flow pass with an isolated fresh Host |
| Electron Settings | Host persistence, keyboard Space, light/dark/narrow states, save failure/recovery, human Stop and enabled restoration pass using isolated current-source Host |
| Staged optimized helper | Runs from copied `bin/` in `/tmp` with only `/usr/bin:/bin` in its environment; no source checkout needed at runtime |

Commands:

```sh
npm run test:computer:contracts
node tests/contracts/host.mjs
node tests/e2e/computer-transport.mjs
node tests/e2e/computer-settings.mjs
node tests/e2e/product-chat.mjs
npm run test:computer:native
PERO_COMPUTER_NATIVE=1 PERO_COMPUTER_FOREGROUND=1 node tests/e2e/computer-native.mjs
PERO_COMPUTER_AGENT=1 PERO_COMPUTER_AGENT_NATIVE=1 node tests/e2e/computer-agent.mjs
npm run test:computer:linux
CARGO_TARGET_DIR=target/computer cargo clippy --manifest-path use/computer/Cargo.toml --locked --all-targets -- -D warnings
```

The shared `target/debug/pero-host` initially disagreed with current source
(no Computer settings events). A fresh `CARGO_TARGET_DIR=target/computer-host-verification`
build proved the protocol and isolated the UI suite from that artifact mismatch.
For this lane, `PERO_COMPUTER_TEST_ROOT` selects a staged Workbench with those
private binaries; `PERO_TEST_HOST_BINARY` gives the Product suite the same fresh
Host. A stale shared Cargo cache also reproduced missing modules in the normal
Host build. Cleaning only `pero-contracts`/`pero-runtime` build artifacts and
rebuilding restored the normal binary; its settings JSONL probe and the
ordinary Settings suite then passed.

The Linux run used an isolated Colima/Docker environment with a real X server,
Tk process and XTest extension. It is native Linux process evidence under a
virtual display, not a physical Linux workstation or real Linux model run.
Windows has source/type-check evidence only. The new OS-matrix workflow has not
run on GitHub from these local commits.

Evidence lives under ignored `target/computer-verification/` so ordinary
Playwright cleanup of `test-results/` cannot erase this acceptance run.

Local ignored outputs are `target/computer-verification/native-result.json`,
`agent-native-result.json`, `agent-native.png`, `linux-result.json`,
`linux-window.jpg`, `package-result.json`, Settings screenshots/results and
`target/computer-verification/product-chat/`. The initial OS-access and duplicate-event problems
are tracked in the [resolved incident](../issues/2026-10-30-computer-use-native-access.md).

No signed/notarized app launch, pure Wayland, Windows desktop input, or third-party
application compatibility matrix is implied. Standard AppKit control glyphs in
this fixture are absent from both its system screenshot and ScreenCaptureKit
image; the fixture's custom canvas status is visible and its native AX values
and independent callback effects are used for verification.
