# Use runtimes

`computer/` owns the native Computer Use executable. The TypeSpec contract in
`protocol/` and its pure Rust admission types in `pero-contracts` remain the
public boundary. Desktop owns the selected conversation, enabled preference,
approval connection, durable receipts and image evidence.

The independent Cargo workspace is composed as follows:

```text
computer/
  src/main.rs                  executable composition root (pero-computer)
  crates/computer-core/        Pero window identity, geometry and control projection
  crates/computer-runtime/     driver port, sessions, opaque snapshots and NDJSON
  crates/computer-macos/       AX, window input and ScreenCaptureKit
  crates/computer-windows/     UIA, window capture and foreground input
  crates/computer-linux/       X11 capture and XTest input
  crates/computer-testkit/     shared value-based platform admission catalogue
  vendor/point/               native dependency snapshot for macOS/Windows only
```

The runtime consumer declares `DesktopDriver`; each platform supplies its own
associated snapshot type. The runtime retains that snapshot without naming or
inspecting Point types. `computer-core` owns window identity, geometry and the
shared accessibility-control projection. It reads no environment, process or
native API. Point conversion happens once in each native library's `bridge.rs`.
Only `src/main.rs` and the root manifest select a platform; the runtime library
has no dependency on any implementation.

Capabilities describe `action + delivery + addressing` and the connected
display environment. Unsupported combinations are rejected by the pure public
admission function before native dispatch. A dispatch acknowledgement still
does not assert a verified application effect.

| Platform | Observation | Input |
| --- | --- | --- |
| macOS | AX and in-process window JPEG | Background AX/window input; explicit foreground click/drag |
| Windows | UIA and WGC/PrintWindow JPEG | Background UIA invocation; explicit foreground click, Unicode/key input, wheel scroll and drag |
| Linux X11 | Window JPEG; no AX tree | Explicit foreground XTest click, mapped text/keys, wheel scroll and drag |
| Pure Wayland / other OS | Unavailable with a diagnostic | Unsupported; no silent fallback |

Windows keyboard input requires a focused observed UIA element. Linux text
must exist in the current X11 keyboard map; unmapped text is rejected before
input. Windows and X11 scrolling quantize logical pixels to wheel notches
(120 pixels per notch). macOS background menu shortcuts may be ignored by an
inactive application's responder chain; observe the result and use supported
text selection chords. Background delivery never silently activates an app or
switches to global input. An executed receipt acknowledges dispatch only.

macOS/Windows suppress captured images when their accessibility traversal finds
secure fields or an incomplete tree. X11 has no accessibility inspection in
this implementation: it offers pixel observation only and cannot identify or
redact secure controls from an AX tree.

| Platform / delivery | Element addressing | Pixel addressing |
| --- | --- | --- |
| macOS background | Click, text, key, scroll | Click, text, key, scroll, drag |
| macOS foreground | Click | Click, drag |
| Windows background | Single UIA invocation | Unsupported |
| Windows foreground | Click, focused text/key, scroll | Click, scroll, drag |
| Linux X11 foreground | Unsupported | Click, mapped text/key, scroll, drag |

Linux reports X11 when connected in an X11 session, and Xwayland when an X11
connection succeeds in a declared Wayland session. The latter covers X11
surfaces, not native Wayland applications. Without an X11 connection it reports
Wayland/unavailable, advertises no actions and refuses target access. Desktop
context comes from `XDG_CURRENT_DESKTOP`; it is not compositor certification.
AT-SPI and native Wayland portal/compositor input are not implemented here.

Cua supplies the package-boundary reference. The pinned source and design
reference are in [computer/SOURCE.json](computer/SOURCE.json); see
[computer/NOTICE.md](computer/NOTICE.md). Cua's daemon, tools, authorization,
Spaces and VM lifecycle are not shipped by this runtime.

Build with `npm run build:computer`; a package contains only the resulting native
executable, source metadata and notice, and needs no Point checkout or credentials at build time or runtime.
Cargo registry dependencies remain pinned by `computer/Cargo.lock`.
See [acceptance and platform limits](../docs/fitness/computer-use.md) for the
commands and evidence actually run.

For a source-only build, run `node tests/build/computer-source.mjs`. On Linux:

```sh
xvfb-run -a node tests/build/computer-source.mjs --linux-only --x11
```

The independent Linux lane deletes Point and both Point-consuming platform
packages from a temporary copy, adjusts only the executable composition
manifest, and lets Cargo prune that copy's lockfile. It checks that every
registry dependency keeps its original pinned version, then runs locked tests
and builds. Core/runtime/Linux sources and manifests stay unchanged. The Tk
suite checks application effects and dragged-object position, keyboard focus, pointer position, unsupported
background input, stale observations and no-X11 refusal. The regular three-OS
CI lanes retain the full workspace and its original locked graph.
