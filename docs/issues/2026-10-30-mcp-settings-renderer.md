---
kind: incident
status: resolved
github_issue: 50
github_state: open
github_url: https://github.com/phodal/pero/issues/50
---

# MCP Settings renderer failure during search

PR #53's first Linux acceptance reached the new MCP Host/ACP fixture, which
passed, but its UI script produced no first screenshot. The script had unbounded
renderer evaluations and attempted another frame wait before reporting a failure.
That obscured the original outcome. The run was superseded by a source update,
not reported as a passing rerun.

The next run, [41006868302](https://github.com/phodal/pero/actions/runs/41006868302),
tested head `9c70ea385b66d4f3d071512919ab8b57b966be8b`. Bounded diagnostic waits
revealed an actual renderer crash while typing `MCP` into Settings search. The
last snapshot shows Settings open on Theme, an empty search, and a successfully
loaded empty MCP configuration. No MCP page screenshot or CRUD UI acceptance was
obtained. The other 15 CI jobs, including Windows and macOS, passed.

The Windows fixture initially used a Unix-only absolute path; replacing that
synthetic path with the running test executable fixed the Windows test without
changing production path validation.

## Investigation

The new MCP button diagnostics inserted full-size canvases into Button's inner
label container. They are a concrete layout-affecting difference that first
appears when search reveals the MCP section. They are being replaced with
layout-neutral bounds observation. This is a hypothesis, not yet a proven cause
of the native renderer crash. Native crash reason/stderr and per-stage evidence
are being added to the acceptance fixture.

The original search path and all CRUD, grant, persistence and error assertions
must continue to run. A successful compile or a direct-menu-only workaround is
not sufficient to resolve this incident. No real credentials or model calls are
needed for reproduction.

## Reproduction and correction

The measurement-wrapper candidate still failed in CI run `41008363226`: typing
just `M` caused a Wasm `memory access out of bounds`, then renderer exit 139.
`on_prepaint` itself uses a canvas, so relocating measurement was not the root
fix. No OOM cause was established.

A supported sandboxed headless Electron run reproduced the same trap locally
without a display server or disabled Chromium sandbox. Its named Wasm stack
located failure during construction of the first MCP control. The emitted debug
Wasm allocated **767,856 bytes** for the monolithic `mcp_settings` frame.
Splitting rendering into agent selection, server row, confirmation, import and
editor functions reduced that frame to **123,168 bytes**; the largest helper
frame is 211,184 bytes. Global stack settings and control measurements were not
relaxed.

The full real Electron/GPUI headless acceptance then passed, with `errors: []`:
original search, CRUD, explicit grants, real ACP config injection, failed-write
recovery, light/dark/Chinese/narrow views, restart and direct-menu entry, stale
revision recovery, disabled import and confirmed removal. A separate fixture
assumption was corrected: persisted Agent preference reorders the Agent menu,
so acceptance selects its fixture from the actual current Agent list instead of
assuming it is always last.

This resolves the reproduced renderer defect. Headed Linux CI and the complete
three-platform checks for the final source remain required before merge; local
headless success is not claimed as their result. No native-window visibility,
real MCP tools/call, paid provider or production acceptance is implied.
