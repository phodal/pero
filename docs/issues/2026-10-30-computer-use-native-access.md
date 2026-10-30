---
kind: incident
status: resolved
---

# Native Computer Use input and window access acceptance

The initial macOS 27 permission preflights reported granted while AXWindows
returned self-referencing application handles. An independent Swift probe
reproduced that OS access state. Effective window access now succeeds; the
adapter retains its explicit permission_required diagnosis for that shape.

Real callback-based acceptance then exposed pointer input with window number
zero and missing window-local coordinates. Binding the native event to the
observed window fixed delivery. Inactive AppKit windows also need temporary
synthetic focus, without changing the workspace's frontmost application.

The real Agent workflow caught a second problem: Point's SkyLight click recipe
posts through both private and public PID channels. A single click reached the
owned canvas twice. Pero now uses one PID channel per event, with the correct
window routing and a scoped synthetic-focus lifetime. The native suite asserts
exactly one click callback before testing the separate drag pointer-down.

An owned guard application and independent button/text/canvas callbacks verify
background AX click, Chinese/emoji input, a text-selection chord, a single pixel
click, scrolling and drag. The guard remains untouched and the target is never
made frontmost by background input. Reused request IDs and consumed observations
are checked independently of native callbacks.

The Linux X11 fixture separately passes screenshot/click/text/key/scroll/drag
through XTest. It does not prove Windows, Wayland or a physical Linux desktop.
Current commands and scoped evidence are in the [verification report](../fitness/computer-use.md).
