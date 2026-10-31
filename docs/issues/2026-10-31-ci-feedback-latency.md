---
kind: incident
status: open
date: 2026-10-31
---

# CI delays integration failures behind serial acceptance

A passing CI run took about 30 minutes although repository caches hit. Linux
combined compilation with 22 minutes of serial Desktop scenarios. An unbounded
scenario could hide subsequent failures until the job timeout. Meanwhile master
changed beneath a long-running PR, requiring another full run and exposing
unrelated generated-file and fixture integration failures late.

The fix separates independent Desktop scenarios, reuses an exact-revision runtime
artifact, caches previously uncached pinned tools/independent Cargo targets,
and retains complete mode-specific gates. The user subsequently requested normal
Linux-only CI, with all platforms retained in daily/manual full runs. Each scenario has its own timing/failure
receipt and bounded test-owned cleanup. The Linux acceptance matrix retains all tests; daily full keeps every OS contract.

Baseline fixes included here do not reduce coverage: Windows npm is launched via
Node rather than executing a `.cmd` file directly; the ACP presentation fixture
explicitly accepts the existing built-in HTTP connector configuration; MCP user
server assertions still independently validate that built-in connector. The
source TypeSpec generator also removes orphan Terminal types found only in the
committed generated output, not any Host/UI implementation.

The incident remains open until real Actions measurements demonstrate the target
and full coverage on the new exact head. See `docs/fitness/ci-feedback.md` for the
baseline, coverage mapping, cold/warm distinction and measurement procedure.
