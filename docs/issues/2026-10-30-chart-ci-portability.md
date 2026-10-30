---
kind: incident
status: open
date: 2026-10-30
---

# Chart integration broke Windows and standalone build gates

CI [41097883577](https://github.com/phodal/pero/actions/runs/41097883577)
exposed three integration failures inherited from master by Control Lab:

- Windows chart rendering decoded UTF-8 JSON through the locale-dependent
  Python stdin stream. The exact-source Chinese fixture then contained a
  surrogate and could not be re-encoded for its receipt hash.
- Windows CLI contracts still expected the pre-chart tool catalog. The new
  `chart_render` tool was present, while the bounded file and partial shell
  behavior remained unchanged.
- Standalone Harness Gazelle reported a missing charts BUILD target, embedded
  Python sources and the CLI dependency on that target.

The chart subprocess must explicitly use Python UTF-8 mode while retaining
isolated mode. The regression keeps the exact Unicode source and integer
assertions. Catalog assertions must include the named chart capability while
continuing to reject extra tools and preserve write/shell boundary checks.
Bazel declarations must match the actual Gazelle-generated diff.

Verification is pending new exact-head CI. The current cloud command executor
is unavailable, so no new local test pass is claimed. Existing native Windows,
Go race and standalone Bazel jobs will supply the execution evidence.
