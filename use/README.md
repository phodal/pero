# Use runtimes

`computer/` owns the native Computer Use executable. The TypeSpec contract in
`protocol/` and its pure Rust admission types in `pero-contracts` remain the
public boundary. Desktop owns the selected conversation, enabled preference,
approval connection, durable receipts and image evidence.

`computer/src/runtime.rs` owns target handles, observation consumption, geometry
checks and response conversion once. Compile-time platform selection in
`main.rs` chooses a real implementation under `platform/`; no OS-specific
transport or second state machine is added.

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

The structure follows Cua's separate `platform-macos`, `platform-windows` and
`platform-linux` implementations. The pinned source and design reference are in
[computer/SOURCE.json](computer/SOURCE.json); the Point native dependency closure is checked in under
`computer/vendor/point/` and built into the executable, while Cua's daemon, tools and authorization system are not
shipped. See [computer/NOTICE.md](computer/NOTICE.md).

Build with `npm run build:computer`; a package contains only the resulting native
executable, source metadata and notice, and needs no Point checkout or credentials at build time or runtime.
Cargo registry dependencies remain pinned by `computer/Cargo.lock`.
See [acceptance and platform limits](../docs/fitness/computer-use.md) for the
commands and evidence actually run.
