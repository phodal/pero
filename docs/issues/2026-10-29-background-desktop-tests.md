---
kind: verification_report
date: 2026-10-29
---

# Background Electron verification

On macOS arm64, based on `393bea7` plus the current working tree, nine background
UI suites passed: workbench, tool calls, Composer, locale restart/preview windows,
Workspace, standalone Product Chat, sidebar, local ROADMAP and encrypted connection
settings. These retain Electron, preload/IPC and the real Host. `npm run check`,
E2E module syntax, both edited workflow YAML files and `git diff --check` passed.

The additional local ROADMAP run stopped at its Cloud source switch: the saved
failure screenshot shows the new Project tabs above the source row, while the
script still clicks the old header coordinates. Later detail navigation also
assumes the former split panel. This is stale UI automation; the assertion has
not established a background input failure. The source switch, search/list,
back button and execution controls were aligned with the current Project page;
the full suite then passed, including an ACP fixture file effect, source
preservation, held Cloud requests and recovery. No application behavior changed.
The feature's existing record is [local ROADMAP](2026-10-29-local-roadmap.md).

App Use visual suites require an actual visible native window by product rule.
They now reject background execution before launching Electron and require an
isolated desktop/Xvfb with `PERO_TEST_HEADED=1`; the capture rule is preserved.

A separate real-Host startup and deep-link check observed the same macOS front
application before and after; Electron remained invisible and unfocused while
the requested task selection reached the renderer. Its result and screenshot
are under `test-results/background/`. The native-suite launch guard was also
checked to reject before starting Electron. No foreground tests were run locally.

Linux Xvfb CI wiring has been added but has not been executed in this session.
