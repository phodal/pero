# Computer Use v1 contract

Status: accepted; macOS, Windows and Linux X11 runtimes connected, 2026-10-30.

## Problem and decision

Pero needs to observe and operate external desktop applications while keeping
its Agent sessions and authorization in the existing Host. The public values
must remain stable when the implementation changes between Point source,
Cua Driver, or a platform-specific runtime.

`protocol/computer-use.tsp` owns the wire vocabulary. Generation produces
separate observation and action bundles with their reachable definitions;
both derive from that one source. `pero-contracts::computer_use` owns the Rust
values and pure observation-admission rules. Neither imports a driver, starts a
process, reads settings, asks for permissions, or registers a model tool.
`protocol/computer-runtime.tsp` owns the separate model requests, private worker
messages, Desktop controls and Host settings extension. Generated bundles stay
small and independent of the existing Host/remote bundles. Existing App Use
continues to own managed App semantics.

## Domain values

- `ComputerCapabilities` identifies `pero.computer-use.v1`, one runtime instance,
  available observation channels, display environment and explicit
  action/delivery/addressing triples. This is
  supported vocabulary, not authorization or a promise that every app accepts
  every input.
- `ComputerTarget` describes a window or desktop. Its reference binds an opaque
  target ID to the runtime instance. Native PID, HWND, AX handles, credentials
  and transport addresses remain adapter details. Restart or target replacement
  requires fresh references, even when an OS recycles a native handle.
- `ComputerObservation` binds indexed elements and an optional screenshot to
  one target. Each element declares its available actions. Truncation does not
  invalidate observed elements, but absence in a partial tree proves nothing.
- `ComputerScreenshot` identifies immutable image bytes in the Host's evidence
  path, with MIME type and positive pixel dimensions. The adapter resolves the
  reference; the wire value exposes no local file path. Missing and null optional
  screenshots/application labels both represent absence.
- `ComputerAction` fixes a request ID, target, observation, delivery mode and
  typed input. An element anchor is observation-local; a pixel anchor also
  names that observation's screenshot. Click, text, logical key chord, scroll
  and drag remain available. The additive macOS vocabulary also includes value
  replacement/clear, finite semantic actions, pointer move, bounded hold, hover with dwell,
  and explicit foreground window focus. A semantic value write does not submit
  a form or promise that an application binding has committed.
- `ComputerActionReceipt` echoes the request, target and observation with an
  `executed`, `rejected` or `unknown` outcome. Rejection and unknown effects
  require a structured error. Execution acknowledgement never asserts task
  verification or scientific acceptance.

References are nonempty bounded ASCII identifiers. Text limits count Unicode
scalar values, preserving whitespace, newlines and emoji. Screenshot points are
zero-based image pixels with exclusive upper bounds. Scroll deltas are logical
content pixels, positive right/down; an adapter that only supports page-based
scrolling must implement a faithful conversion or report `unsupported`.
Logical key chords are ordered key names, not OS keycodes or scripts.

## One admission function, existing authority

`ComputerAction::prepare(observation, capabilities)` consumes a typed action
and returns `PreparedComputerAction` or `ComputerError`. It checks the current
runtime, exact target and observation identity, advertised delivery/addressing combination,
element identity/action, screenshot identity and point bounds. An empty scroll
is refused. The core reads no time or external state.

The caller supplies the current Host-owned observation; a model cannot nominate
an arbitrary observation as current. A prepared value proves only these value
preconditions. Host session authorization, cancellation and current target
liveness still precede native I/O. Drivers must not silently turn background
delivery into foreground input. A mutation invalidates the old observation in
the execution owner; a subsequent action needs a new observation.

Before dispatch, denial/cancellation can be reported as `rejected`. After a
native input may have run, lost acknowledgement or cancellation is `unknown`.
Observe before continuing and retain the original request ID for reconciliation;
do not replay input automatically. Desktop persists an intent before sending input
and an outcome after acknowledgement; an interrupted intent remains unknown. Snapshot timing and process-local
freshness remain runtime concerns and are not serialized as portable clocks.

## Point and Cua mapping

Source inspection used Point `a1b915005` and Cua `cbe3991f`:

- Point's `computer/` is a Rust port of KiroCrew: core values, backend trait,
  platform implementations and service/CLI. Its separate Swift/XPC desktop
  path owns signed peers and native sessions. The two paths are not evidence
  of a single interchangeable runtime.
- Point Rust's core also contains environment/file/clock access, Point policy
  and a small JSON parser. Those do not belong in Pero's contract. The native
  adapter uses its platform backend and native compatibility predicates. Point's
  service, CLI and policy-gate wiring are not used as Pero's authority.
- Point CLI element indices live in one process; independent CLI invocations
  cannot preserve them. Cua also retains runtime/session state. The adapter must
  keep the corresponding native instance alive and map references there.
- Cua's target handles, screenshot tokens, MCP tools and input result fields
  convert at its adapter boundary. Its model loop, Spaces application and
  perception extensions are not dependencies of this contract.

References: Point ADR 0065, `computer/README.md`,
`browser/contracts/computer-use-xpc-v1.json`; Cua Driver README and embedding
guide. The five-crate native dependency closure is copied into tracked
`use/computer/vendor/point/`; `SOURCE.json`, its notice and the vendor README
record provenance and module-only adaptations. Cargo uses local paths. Builds
require no Point credentials, checkout or extraction cache; public registry
dependencies remain locked in `use/computer/Cargo.lock`.

## Package isolation

The executable root composes `computer-runtime` with one of `computer-macos`,
`computer-windows` or `computer-linux`. The runtime consumer declares the
`DesktopDriver` port and keeps its associated snapshot opaque. `computer-core`
owns Pero window identity, geometry, image values and control projection; it
has no native SDK or transport dependency. `pero-contracts` remains the single
public vocabulary and pure action-admission owner.

Only macOS/Windows adapter manifests depend on Point. Their `bridge.rs` files
convert Point values at that boundary. Linux, core and runtime contain no Point
types or dependencies. The Linux source-only build proves this by deleting
Point and its consuming implementations; only the executable composition
manifest changes. The temporary lock graph is pruned with registry versions
checked against the original pin set before the normal locked test/build.

`computer-testkit` drives the actual platform profiles through public action
admission using one shared expected-success/refusal catalogue. These value
checks are separate from the native callback/focus/pointer acceptance suites.
A Windows background UIA click advertises element addressing only; foreground
text/key also requires element addressing. X11 advertises foreground pixel
addressing. Unsupported routes are rejected before entering a native backend.

The display environment distinguishes native, X11, Xwayland, Wayland and
unavailable. Linux combines actual X11 connection success with declared session
metadata; desktop context is not a tested compositor claim. Pure Wayland has
no action capability here. A future Cua backend implements the same consumer
port; see [integration assessment](../design-docs/computer-use-cua-adapter.md).

## Runtime and ownership

```mermaid
flowchart LR
  Agent[ACP Agent] -->|Host-injected conversation identity| MCP[Existing Desktop MCP]
  MCP --> Authority[Running conversation and delivery scope]
  Authority --> Desktop[DesktopComputer: receipts and evidence]
  Desktop -->|Private NDJSON| Native[Native helper: runtime and platform libraries]
  Native --> Core[Pure action admission]
  Native --> OS[AX / UIA / X11 native APIs]
  Settings[Settings or Product menu] --> Host[Host runtime settings]
  Host --> Desktop
```

The model sees `computer_use` with status, targets, open, observe, screenshot,
read_ocr, act, receipt and stop. It cannot provide a caller identity, OS handle, permission grant,
executable path, transport URL or settings mutation. Host attaches the MCP
credentials and conversation header during ACP session creation. Ordinary
local macOS conversations can run background Computer Use while another
conversation is selected. Opening an app, foreground input, and the other
Computer Use routes still require the selected running conversation. Agent
tool approval remains the approval owner.

`DesktopComputer` gives each running local macOS conversation its own serial
helper connection. An app claim starts at the first observation, screenshot
or open request and lasts until the worker has stopped. Another conversation
receives `busy` when it tries to claim that app. Different apps can run
background input concurrently; foreground input requires exclusive input.
Other platform routes continue to use their existing connection.
The native process owns opaque runtime/target handles and one current observation per conversation.
A new observation replaces the old one; every attempted action consumes it.
Window liveness, identity and geometry are rechecked before native dispatch.
Background input never silently escalates to global input. Foreground click and
drag are separate advertised delivery pairs; pixel text/key input focuses the
observed point in the target application before posting input there.

The helper captures eligible window pixels in memory. macOS 14+ uses an
in-process ScreenCaptureKit bridge because the legacy CoreGraphics window
capture API is obsolete in newer SDKs; older systems use the Point capture
function. Secure or incomplete AX trees suppress capture. A screenshot-only
request creates a fresh pixel anchor and leaves the whole-window AX delta
baseline in place. Capture status reports why pixels are absent. Optional
macOS Vision OCR can finish after the initial response and is readable with
the screenshot ID in the same conversation. Desktop stores image bytes and
SHA-256 metadata under its own profile. It stores per-conversation action intents/receipts privately;
reusing an ID returns its receipt, and conflicting input with the same ID is
rejected. Duplicate pending calls share one result. No automatic retry exists.

A turn finishing, a cancellation or a model stop closes that conversation's
local macOS helper. A selection change leaves other background Computer Use
calls active. Stop waits for confirmed process exit before releasing app and
input ownership. Desktop persists uncertain results before acknowledging
shutdown. Turning the switch off, the emergency shortcut
Command/Ctrl+Shift+Escape, or shutting down stops all workers. A person's Stop
also disables new Computer Use input until re-enabled. Process restart
invalidates handles; receipts remain queryable from the Desktop journal.

Settings are disabled by default and persisted by Host without replacing other
preferences. Local macOS profiles also store allowed bundle IDs. The global
switch alone grants no applications. Settings can list running app names and
bundle IDs for the user. The Desktop sends the grants outside the model's
request. The native helper checks them before returning targets, launching,
resolving a window for observation or input, or returning OCR. Revoking a grant
interrupts only the affected conversations and invalidates their previous
window references.
Existing execution receipts remain readable. The local macOS list does not
grant access to attached remote desktops. Only a trusted Settings/menu gesture
can request OS permissions.
Preflight is advisory: recent macOS can report grants while returning the app
itself as every AX window. The adapter reports `permission_required` immediately
for that shape, rather than walking a cycle or claiming a valid observation.

`npm run build:computer` builds the pinned source plus Pero's adapter. Normal
Workbench builds and native packaging include it; Chat Products include the
same helper, MCP tool, menu controls and provenance. The native runtime now selects macOS, Windows or Linux X11 at compile time.
A shared owner handles opaque references, observation consumption and geometry
admission. Platform modules declare their supported observation/action pairs;
Windows background input is UIA invocation only, and Linux X11 supports pixel
observation and explicit foreground input. Pure Wayland returns unsupported.
Pero Native starts the same Computer Use owner in its existing MCP sidecar.
The Native workbench forwards conversation selection and cancellation to that
sidecar, and the Host persists its enable/stop setting in the Native profile.
On macOS Native launches the independently signed `Pero Computer Use.app`
(`com.openpero.computer-use`) through Launch Services. The helper connects
back to a Unix socket in an owner-only temporary directory and runs the same
NDJSON worker. The Desktop sends EOF for cancellation and waits for the
launched app to exit. Library, driver and model request contracts are unchanged.
Electron and the development CLI continue to use private stdio.

The macOS DMG contains two sibling applications. Native launches the helper
installed beside it. This location preserves the helper's TCC identity for
both Accessibility and Screen Recording. In a nested bundle, macOS 27.2.1
attributed Screen Capture to the outer app while Accessibility used the
helper. Settings opens each privacy pane and offers the sibling bundle as a
native file drag. The user grants both permissions in System Settings. Both the
outer app and the helper support a Developer ID identity in the build. Local
ad-hoc signatures support testing an unchanged installed copy across restarts;
they do not prove update continuity. Development previews use a separate bundle
identifier.

## Verification boundary

The shared corpus, pure admission table, native pixel-unit event test, real
Host conformance, process/MCP failure tests and Electron settings tests pass.
An actual Codex ACP session called the native status tool through the Host's
injected MCP endpoint. This proves provider transport, not desktop input effects.

The effective macOS access block was resolved. Actual AppKit callbacks now prove
AX invocation, Unicode input, key selection, exactly one callback for one pixel
click, scrolling and background drag without making the application frontmost.
Foreground drag also passed a separate owned-window run; overlapping windows
are refused by the system-wide AX hit test. A real Linux Xvfb/Tk run proves
pixel capture and all five foreground input kinds. Windows cross-compilation
and Clippy pass; Windows desktop execution, pure Wayland and signed/notarized
package launch have not passed acceptance here. Provider and package evidence
is recorded separately in [Computer Use verification](../fitness/computer-use.md).

## macOS capability completion, 2026-10-30

`ComputerElement.state` reports native enabled/secure/focused/settable facts and
optional selected/expanded state. `semantic_actions` contains a finite, generated
vocabulary: press, open, confirm, cancel, show-menu, scroll-to-visible, increment
and decrement. A request cannot forward an arbitrary AX method. Admission checks
both element advertisements and runtime action/delivery/addressing support.
`set_value` accepts an empty replacement; `type_text` remains insertion. Successful
macOS receipts report semantic, window-event or foreground-event execution and,
when applicable, the actual semantic action. Other drivers may omit execution
details and continue to refuse unimplemented inputs.

An `open` application accepts the existing name string or a typed bundle-ID
selector. macOS discovers all layer-zero windows, including several from the same
process, and resolves running bundle IDs through NSRunningApplication. New app
launches still use the verified installed catalog, never a caller-supplied path.

`observe.options` supports AX-only reads and bounded node/depth budgets. A subtree
root names a control from this conversation's current observation and selected
target. Expansion replaces that observation with a new ID and local numbering.
Every action attempt still consumes the current observation. macOS retains native
AX handles and validates live window ownership before using them; it never resolves
a subtree number by rescanning the whole window. Subtree, secure and incomplete
trees do not produce whole-window images. Text is bounded separately from nodes.

macOS uses AX logical geometry for observation and background input, and the
ScreenCaptureKit filter's content rectangle for image resolution. WindowManager
thumbnail rectangles are not application coordinates. Foreground hit tests require
the exact selected window ID as well as its PID; same-process overlays refuse.
Middle clicks and multi-clicks retain physical button/count semantics. Explicit
semantic actions do not silently become foreground input.

`hold` holds one button for 1–10000 ms and always releases it; `move` positions
the pointer and `hover` adds a 0–5000 ms `dwell_ms`; each advertises background
and foreground delivery independently. `focus_window` requires explicit
foreground delivery and target addressing. The worker reads connection closure
independently of input execution. Desktop stop closes stdin first; cancellation
wakes a hold, hover or drag and scoped button cleanup releases it before exit.
Interrupted input retains an unknown receipt, with no automatic replay. Forced
process termination remains a bounded fallback when graceful exit cannot finish.

The owned AppKit, SwiftUI and Electron acceptance and release limitations are in
[the macOS verification record](../fitness/computer-use-macos.md).
