---
kind: incident
status: resolved
---

# Agent Plugin fixture commands were Unix-only

Three Windows runtime tests failed before reaching the behavior they intended
to exercise. The shared valid manifest used `/usr/bin/env`, which is rooted but
not absolute under Windows `Path` semantics (it has no drive/UNC prefix).
Production correctly requires an absolute command or a `{pluginRoot}` command.

The shared manifest now uses `std::env::current_exe()` as a portable absolute
path. These tests only parse, install and freeze declarations; they never launch
the command. Negative shell/type/reserved-name declarations use the already
accepted `{pluginRoot}/server` syntax so command portability cannot mask the
intended rejection. Relative-command and traversal rejection cases remain.
Production path rules and test coverage are unchanged.

Linux verification on `dd346f10` plus this fixture change, using the pinned
cached GPUI build recipe in offline mode: all three `agent_plugins` tests and
all 83 `pero-runtime` tests passed (zero ignored). Actual Windows execution
remains the next CI gate, not a local verification claim.
