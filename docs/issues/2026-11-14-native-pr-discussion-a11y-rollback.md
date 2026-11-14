---
kind: incident
status: resolved
date: 2026-11-14
---

# Native PR discussion focus crashes during accessibility autoscroll

Actual macOS Native inspection of the isolated PR #164 GitHub fixture loaded
current and outdated discussion cards and exposed the line annotation controls.
Clicking **Add annotation on line 3** then terminated the development app with
`Duplicate a11y node id` in `gpui-fast-0.1.13/src/window/a11y.rs:422`.
The node number changes between launches. This is a fixture receipt, not a
GitHub publication or signed-package acceptance.

The reproduced backtrace passes through `A11yNodeBuilder::push`, Button
prepaint, `StateInner::prepaint_items`, `Window::transact` and List prepaint.
Focusing the newly inserted multiline input requests ancestor autoscroll. List
prepaints once to locate it, rolls back and repeats at the new offset.
`Window::transact` reverted hitboxes and other prepaint effects, but left the
accessibility tree, seen IDs, focus/bounds and retained accessibility replay log
from the rejected pass. The retry therefore encountered its own old nodes.

The pinned Native backend patch adds accessibility checkpoint/rollback to that
existing transaction, including the parent node's children and replay log.
The duplicate-ID assertion and ordinary input focus remain enabled. The build
wrapper extracts the checksum-verified crate into `target/patched-dependencies`
and applies the patch without editing the registry cache or Kit checkout.
The patch includes a focused tree/focus/replay rollback regression test.

Patch construction and the Native build pass. In the rebuilt actual macOS
Native window, adding the same line-3 annotation now opens its editor without
terminating the process. Typing, failed publication with retained draft, retry,
reply, resolve/reopen and Agent submission all completed. Normal focus and the
duplicate-ID assertion remain enabled.

The Node patch-builder test passes. The focused upstream Rust test is included
in the patch but could not execute from the published crate: its test target
references omitted example images/fonts and undeclared test-only dependencies.
This is not counted as a passing Rust test. Evidence and development-build
acceptance limits are recorded in [PR verification](../fitness/pull-request-view.md).
