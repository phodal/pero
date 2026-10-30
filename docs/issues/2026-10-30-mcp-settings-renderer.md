---
kind: incident
status: in_progress
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
