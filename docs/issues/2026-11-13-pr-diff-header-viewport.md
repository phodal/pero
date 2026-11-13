---
kind: incident
status: resolved
date: 2026-11-13
---

# PR diff file actions leave the visible reading area

During actual macOS Native inspection of public PR #228, Kit's continuous Diff
kept its file headers as wide as its longest source line. The trailing change
counts and explicit viewed checkbox were outside the viewport, although the
accessibility tree still contained the controls. Horizontal code scrolling also
moved the file header. The former per-line renderer did not exercise this path.

The retained component patch sizes file headers to the observed viewport and
compensates for horizontal scroll. Code continues to own its full scroll extent;
file collapse and viewed controls retain their existing owners. The application's
embedded Diff drops its outer border because its toolbar and parent pane already
own those boundaries; otherwise the top and right edges look doubled.

Resolved in the isolated `codex/pr-view-layout` development worktree. Actual
Native PR #228 inspection confirmed visible trailing file controls with wrapping
off, including after horizontal keyboard scrolling. With wrapping on, long code
lines stay inside the reading area. Top and right boundaries are single hairlines.

Verification and final observed scope are recorded in
[PR view verification](../fitness/pull-request-view.md).
