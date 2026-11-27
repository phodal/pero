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
acceptance below. The repair at `22cffa3` was subsequently pushed and passed macOS, Windows and
Linux jobs in [Computer Use run 40986292506](https://github.com/phodal/pero/actions/runs/40986292506). The
[build incident](../issues/2026-10-30-computer-use-private-build-dependency.md)
records the cause and resolution.

## Package isolation and precise profiles, 2026-10-30

The executable root now composes independent `computer-core`, `computer-runtime`
and macOS/Windows/Linux libraries, with a dev-only `computer-testkit`. The
runtime consumer declares the driver port; each backend retains its own opaque
snapshot. Core/runtime/Linux contain no Point imports or Cargo dependencies.
Point-to-Pero conversion is confined to the macOS/Windows bridge files. Public
TypeSpec and `pero-contracts` remain the vocabulary and action-admission owner.

Capabilities include the display environment and addressing for every supported
action/delivery pair. The shared 18-case catalogue runs through the actual
platform profiles and pure admission. In particular, Windows background pixel
clicks and foreground pixel text/key input are rejected before native dispatch.
The injected Agent workflow now asks it to read these exact combinations.

A fresh Linux aarch64 container passes:

```sh
xvfb-run -a node tests/build/computer-source.mjs --linux-only --x11
```

That lane physically removes Point and the two consuming packages from a source
copy. It adjusts only executable composition dependencies, prunes the temporary
lock graph with registry-version retention checks, and runs locked workspace
and public contract tests plus a build. Core/runtime/Linux files are unchanged.
The resulting isolated binary passes Tk/XTest effects, entry focus, independent
pointer endpoint, actual dragged-rectangle position, stale observation, unmapped
text and background refusal checks.
A no-DISPLAY child with simulated Wayland session metadata reports unavailable
and refuses targets; this is refusal evidence, not a real compositor trial.

Native workspace tests and Clippy, Windows GNU and Linux musl cross-target
Clippy, TypeScript/theme/locale/schema checks and the Desktop/MCP transport
suite pass. A macOS source-only build passes with Point access denied. Library
extraction initially changed the executable's minimum OS because dependent
library link arguments do not propagate; the executable composition build
restores macOS 13, confirmed by `LC_BUILD_VERSION minos 13.0`.

The refactored macOS helper passes the owned-window suite: AX click, Unicode
text, selection chord, pixel click/scroll/drag, preserved background focus,
receipts and stop/restart handle invalidation. The foreground extension also passes an actual element click and foreground
drag. The captured app reports counter 2, text `Verified` and pixel scroll -120;
background-phase assertions independently preserve the guard application and
foreground owner. The initial package split at `abbc401` passed all three native
jobs in [Computer Use run 40990868154](https://github.com/phodal/pero/actions/runs/40990868154).
The final control-identity follow-up at `168f6bc` also passes macOS, Windows and
Linux in [run 40991729096](https://github.com/phodal/pero/actions/runs/40991729096). No fresh real-model or signed-package
run is claimed. AT-SPI/native Wayland and Windows live GUI remain separate
coverage work; see [Cua adapter assessment](../design-docs/computer-use-cua-adapter.md).

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
| Linux Xvfb/Tk/XTest move/hover/hold (C1) | Foreground pixel move leaves click count unchanged and lands on the independent pointer position; hover reaches the target and keeps the pointer resting for `dwell_ms`; left and right hold report press-to-release durations from the app; background hold is refused without a press. Windows refuses all three as unsupported |
| Linux Xvfb/session D-Bus/AT-SPI/GTK 3 | Two same-titled windows of one process bind to separate frames by PID and geometry; push button and check box expose click, disabled and password controls expose no action and no value; background element click changes only the bound window's counter and leaves the real pointer in place; check box toggles; disabled, double and right element clicks are rejected before input; a consumed observation is rejected as stale. No window manager, Qt, Chromium/Electron or physical desktop |
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
The initial Windows source-build repair passed the three-OS workflow.
On Windows 11 ARM64 build `26300.9457`, the current source builds for
`aarch64-pc-windows-msvc` and passes the Computer Use workspace and contract tests.
The native NDJSON status in SSH Session 0 changed from `available: true` to
`available: false` with `WINDOWS_NONINTERACTIVE_SESSION`.

Evidence lives under ignored `target/computer-verification/` so ordinary
Playwright cleanup of `test-results/` cannot erase this acceptance run.

Local ignored outputs are `target/computer-verification/native-result.json`,
`agent-native-result.json`, `agent-native.png`, `linux-result.json`,
`linux-window.jpg`, `package-result.json`, Settings screenshots/results and
`target/computer-verification/product-chat/`. The initial OS-access and duplicate-event problems
are tracked in the [resolved incident](../issues/2026-10-30-computer-use-native-access.md).

This run covered owned fixtures in development builds. Standard AppKit control glyphs in
this fixture are absent from both its system screenshot and ScreenCaptureKit
image; the fixture's custom canvas status is visible and its native AX values
and independent callback effects are used for verification.

The macOS capability expansion, new native action matrix and framework-specific
effects are recorded in [computer-use-macos.md](computer-use-macos.md).

## Windows 11 ARM64 WinForms, 2026-11-23

The native `pero-computer.exe` NDJSON driver passed four scenarios with nine
receipts in an unlocked VMware Fusion session on Windows build `26300.9457`.
A WinForms fixture independently recorded the effects:

- One background UI Automation invocation, with the guard window still
  foreground and the pointer in the same position. The old observation was refused.
- A 404 × 360 window JPEG matching the DWM visible frame. Background pixel input
  was refused. The foreground pixel click landed within two pixels of the intended
  button center on both axes.
- A foreground edit control click, Unicode text with Chinese characters and an
  emoji, and Backspace removing the trailing character.
- The list moved from row 0 to row 9. The square moved approximately 60 × 40
  pixels and logged one button press, a move and one release. The guard
  window's counter stayed at zero.

The checked JPEG and receipts are in
`target/computer-verification/windows-arm64-winforms/`. Windows ARM64 and macOS
also passed `node scripts/build/computer.mjs --test`. This run used a single
virtual display and the native driver with an owned WinForms app. Signed Windows
Workbench, other UI frameworks and multi-display behavior remain unverified.

The Windows driver also accepts screenshot-relative foreground move, hover and
hold. The hit test requires the selected top-level window to own the point,
including when two windows in the same process overlap. Closing the driver
connection wakes a pending hold and releases the tracked button. The pure
admission suite, x64 GNU and ARM64 MSVC Clippy checks, and compilation of the
extended WinForms fixture against .NET Framework 4 reference assemblies passed.
The new WinForms scenarios for overlap, pointer placement, button events and
mid-hold cancellation still require an unlocked Windows desktop run.

On 2026-11-24 the [hosted Windows 11 ARM64 run](https://github.com/phodal/pero/actions/runs/45320600769/job/138197927552)
verified one background UIA click with the foreground window and pointer
unchanged, stale-observation rejection, and a 402 × 332 JPEG matching the
owned window. It also rejected a background pixel click. The run stopped at
the foreground precondition because the guard window never took focus.
The Windows, macOS and Linux build and Clippy jobs in the same run passed.

The unsigned Windows ARM64 portable build of Pero 0.1.1 uses source
`5e3da1141a16d8ad5d4ba49c871b55d20da7b697`. The platform-neutral Wasm and
Electron bundles were built on macOS from that checkout. The native binaries,
App assets and ZIP were built on Windows ARM64. The full Computer Use workspace
and shared action contract tests passed on ARM64. The ZIP's CRCs, SHA-256 and
all six executable architectures were verified after transfer.

From a fresh ZIP extraction on Windows, the Host emitted `ready`, the Go ACP
binary printed its help, and the Electron executable ran Node in ARM64 mode.
The packaged Computer Use binary returned `WINDOWS_NONINTERACTIVE_SESSION`
in the SSH session. The archive, checksum and process receipt are in
`target/package/` under the `Pero-windows-arm64` name.

The release smoke test now waits for the Workbench loading overlay to clear.
The earlier test could write a passing receipt while its screenshot still
showed “Opening the workbench…”. With the corrected test, a fresh extraction of
the same ZIP rendered the Workbench navigation, connected the Host and exited
successfully in Windows SSH Session 0. The default Task Center was
`https://app.openpero.com` and no page errors were reported. The receipt and
screenshot are `Pero-windows-arm64.workbench-smoke.json` and `.png` in
`target/package/`. The operator's interactive desktop and the new WinForms
input scenarios remain unverified.

## Pero Native and real Pero (DeepSeek), 2026-11-22

The GPUI workbench uses the shared runtime through its existing App Use MCP
sidecar. The Native settings page exposes enable, refresh, stop and separate
macOS links for Accessibility and Screen Recording. The Host owns the
persisted Native switch, which starts off. This development run used the
checkout's native driver.

Verified on macOS 27.2.1 in the development Native GPUI workbench at
`3dca970b4` plus the Computer Use changes. The running Native Preview settings
were inspected in light and dark appearance. The Accessibility and Screen
Recording links opened Device Control and Data Access and Screen & System
Audio Recording respectively. The direct-launch acceptance profile used
existing macOS grants. The separately launched preview showed both permission
preflights as not detected during the UI inspection.

An opt-in run used the actual built-in Pero (DeepSeek), Native Chat and Host
rather than a scripted agent. The first run passed after a tool-schema
correction by the agent. A repeat stopped at argument validation because the
agent sent a worker-style wrapper. Publishing the generated operation and
request fields at the top level of the MCP schema resolved that ambiguity.
The final run completed all five calls in order: status, targets, observe,
act, observe. It identified the owned AppKit fixture, produced two 1200 × 944
JPEGs with matching byte counts and SHA-256 digests, and performed one
background AX press with an executed receipt. The fixture independently
recorded Count=1. The live AX values and inspected JPEG show that result.
The model used AX and screenshot metadata. The configured text model did
not receive screenshot pixels as vision input. Settings enabled and stopped
the runtime through the Native panel, and Stop persisted the disabled state
to the isolated profile.

```sh
node scripts/build/computer.mjs
node scripts/build/connectors.mjs
node scripts/cargo.mjs +nightly-2026-10-28 build --locked -p pero-ui --features native-probe --bin pero-native
PERO_NATIVE_COMPUTER_DEEPSEEK=1 node tests/e2e/native-computer.mjs
```

The test preserves evidence in `target/computer-verification/pero-native-deepseek/`
by default. Set `PERO_COMPUTER_RESULTS` to retain separate runs. The final
local evidence is under `target/computer-verification/final/pero-native-deepseek/`.
This run did not exercise granting new macOS permissions, the global emergency
shortcut, or signed release installation.

## Signed macOS helper and installed-package authorization, 2026-11-22

Native launches `Pero Computer Use.app` through Launch Services and sends the
existing NDJSON requests over a private Unix socket. It waits for helper exit
on Stop. The DMG installs Native and the helper beside each other. The helper
has its own bundle identifier, `com.openpero.computer-use`, and signature.
The Native settings offers the actual installed bundle as a macOS file drag,
separate privacy links, and a Finder fallback.

On macOS 27.2.1, the initial DMG test recorded both permissions as not detected.
After user-authorized setup, the initially nested helper could read AX but
could not capture the test window. System TCC logs attributed Accessibility to
the helper and Screen Capture to the outer Native bundle. Installing the same
signed helper beside Native corrected the attribution. Two new helper
processes each reported both grants, and each exited before the next launch.
No macOS permission database was modified outside System Settings.

The local package uses separate ad-hoc signatures because the machine has no
Developer ID signing identity. The test establishes same-bundle process
restart behavior. Developer ID signing, notarization and grant continuity
across signed updates are separate checks.


The corrected arm64 DMG contained both signed top-level apps. The mounted
apps passed strict signature checks, and the installed helper's designated
requirement matched the helper in the image. After the Native app and worker
exited, the same installed app relaunched with Accessibility and Screen
Recording granted. The macOS Add picker was used to grant Screen Recording
to the helper. The installed Settings drag source was inspected in the
running app; dropping it directly into System Settings was not separately
exercised.

The installed Native workbench ran the built-in Pero (DeepSeek) against the
owned AppKit fixture. The tool sequence was status, targets, observe, act,
observe. The standalone helper returned two 1200 × 944 JPEGs with verified
hashes and an executed background semantic press. The fixture independently
recorded one callback and Count=1, also visible in the final image. The
configured model verified AX values and capture metadata. Local evidence is
under `target/computer-verification/installed/`.

The final image rerun also checks that the sidecar shuts down without a broken
pipe and then starts Native with both grants still in effect. It uses an
isolated Native profile and ordinary installed binaries for the permission
read. The provider run uses the installer's opt-in Native probe to submit
the fixture prompt and checks the actual receipts and fixture callback.

```sh
node scripts/release/native-smoke.mjs
PERO_NATIVE_COMPUTER_INSTALLED_APP="$HOME/Applications/Pero Native.app" \
  PERO_NATIVE_COMPUTER_DEEPSEEK=1 node tests/e2e/native-computer.mjs
```

## Managed Linux desktop via Colima, 2026-11-22

The [Linux desktop image](../../environments/linux-desktop/README.md) was built
in the dedicated `pero-remote-desktop` Colima Docker engine on arm64 macOS. The
standalone runner reached X11 and both private RFB listeners, and returned an
available Linux/X11 status from the Pero Computer Use stdio stream.

`node tests/e2e/linux-desktop.mjs` drives the development Electron menu and
viewer with the real Rust Host, a scripted ACP agent, the real Linux driver
and noVNC. It verifies that viewing cannot change the editor, the agent can
type, and taking control denies the agent while human keyboard input works.
Returning control rejects the old observation and the agent resumes with a
fresh runtime. An independent read inside the guest returns
`Agent-Human-Resumed` from the saved file. Closing the viewer releases human
control. Disconnecting the chat denies further GUI access for that chat.
The test supplies both responses to the native stop confirmation, verifies
removal only on confirmation, restarts the desktop, and observes a deliberate
container exit without redirecting the chat to the host display.

The running viewer was checked in light mode and in a 460 px dark window.
Screenshots and the result are in `test-results/linux-desktop/`. The test
uses a scripted ACP agent and a development Electron build. Provider-driven
Linux GUI actions, signed packages, and a Native workbench viewer are outside
this evidence.

### Conversation Desktop tab on Linux, 2026-11-26

Source: `975c93b14` with the conversation resources integration applied.
The development Electron 45.1.0 arm64 build ran inside an Ubuntu 24.04.4
Linux VM on an Xvfb display with software WebGL. Docker Engine 29.2.1 ran
the existing `pero/linux-desktop:dev` X11 guest from the same VM. The
Rust Host was built from the matching source and used a scripted ACP agent.

The suite opened **Desktop** from Composer, dragged the shared resource
splitter, and switched between Desktop, Files, and Artifacts while retaining
the viewer. A real Mousepad window proved that the watching connection
ignored input. In manual mode the agent was denied and the user saved
`Agent-Human` through noVNC. Explicit return rejected the stale observation.
The agent then observed again and saved `Agent-Human-Resumed`, verified
independently inside the container. Switching to Artifacts during manual
control returned the desktop to watching and retained the guest. The native
stop confirmation, guest exit, restart, and cleanup also passed.

The Linux Workbench capture shows the resource navigation above the noVNC
surface during manual control. A repeat with X11 pointer and keyboard
input verified tab switching, keyboard focus in view-only mode, and the same
file contents after manual input and return. The standard test writes to
`test-results/linux-desktop/`. This lane exercised an isolated X11 guest,
a development build, and a scripted agent.

```sh
PERO_TEST_HEADED=1 PERO_TEST_SOFTWARE_GL=1 \
  PERO_REMOTE_DESKTOP_DOCKER_SOCKET=/var/run/docker.sock \
  xvfb-run -a -s "-screen 0 1600x1000x24" node tests/e2e/linux-desktop.mjs
```

### SSH Host and paired-viewer follow-up

The SSH lanes use the Colima Linux machine's real OpenSSH server and a Host
binary built for Linux arm64. The Electron workbench opens a remote PTY,
independently verifies the file it writes, then opens that file through the
Host. The existing VNC endpoint displays pixels through an SSH tunnel.
The managed display works through a separate SSH launcher and a scripted
Python ACP process on Linux calls Computer Use through the dynamically
forwarded, authenticated MCP endpoint.

The paired-viewer lane runs real Electron, Chromium, the loopback relay,
and the Colima guest. It checks one-use pairing, read-only RFB over WebRTC,
an intentionally forced WebSocket fallback with keyboard input, a guest
file saved with that input, and release on disconnect. It also passed
with relay-only ICE and a real coturn instance. Public TLS deployment,
separate physical devices, signed Desktop, and a live model provider
were not part of this acceptance.

### Blender desktop, 2026-11-23

The optional Blender image ran on the dedicated arm64 Colima Linux desktop.
`node tests/e2e/linux-desktop-blender.mjs` used the managed desktop's real
Computer Use stream and a Blender 3.4.1 window. A foreground drag changed
the default cube's X location. The GUI saved the scene, and a separate
Blender process read the saved value back as approximately 0.01 m.

Another edit exercised the Save Changes dialog. Discard closed the original
window and preserved the source SHA-256. The fixture relaunched the saved
scene, waited for its rendered viewport, and used the File menu to export OBJ.
The eight exported vertices had the same X centroid as the saved cube.
Reusing the first drag's observation was rejected as stale. The test tore down
its container before recording a pass.

This lane used deterministic Computer Use requests in an X11 guest and
fixture-owned files. Receipts, screenshots, hashes, the BLEND and the OBJ with
its MTL are in `test-results/linux-desktop-blender/`.

### Native Blender Run on a named Worker, 2026-11-27

The macOS arm64 Native development build selected **Blender Linux Run** in
Cloud Tasks and dispatched the Blender desktop profile. A real Go control
plane, PostgreSQL, Linux arm64 Colima Worker and Blender 3.4.1 guest served
Run `run_f29b109dbca24162b851e9afbcb427d3`, generation 5.

WKWebView displayed the shared noVNC viewer over the loopback Relay. The
initial connection was view-only. Take Control enabled human keyboard input
for Blender's first-run setup, during which the actual Codex ACP Agent
reported that the human held control. After Return Control the Agent observed
the guest again. Switching to evidence closed the viewer, and Reconnect
display restored the same Run's view-only desktop.

Codex `gpt-6.1-sol` used Computer Use for the scene edit and save. The final
file-save receipt `save-result-final` was executed. The Run's `actions.json`
contains 17 executed GUI receipts and the handoff sequence. After verifying
the original container was gone, the client downloaded the receipt, final
JPEG and `.blend` from the original Run and checked all three SHA-256 hashes.
Native's **Save evidence file** exported the same screenshot. An independent
Blender process opened the downloaded model and read Cube at `(1, 0, 0)`.
A freshly started control plane read the same three objects from PostgreSQL.
Evidence is in `test-results/native-run-desktop/`.

Earlier attempts exposed an unavailable account model and the Worker event
cap when ACP echoed full screenshots. The verified run used a supported
model and kept screenshot bytes in the Artifact path while projecting
bounded text into Run events. The Go regression also covers foreign Worker,
wrong instance, stale generation, immutable upload and historical download.
Public Relay deployment and release packages remain separate acceptance.

```sh
npm run build:desktop
node tests/e2e/linux-desktop.mjs
node tests/e2e/linux-desktop-shared.mjs
# Point these fixture variables at an already running disposable SSH host and its VNC port.
PERO_SSH_CONFIG=/path/to/verified/ssh.config \
  PERO_TEST_SSH_PROFILE=/path/to/fixture/profile.json \
  PERO_TEST_SSH_VNC_PORT=5901 node tests/e2e/linux-desktop-ssh.mjs
```
