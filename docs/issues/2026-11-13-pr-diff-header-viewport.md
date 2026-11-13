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


## PR #229 review follow-up

A retained diff could omit a previously viewed file after a new head SHA arrived
with identical API patches. The domain correctly made its mark stale, but the
presentation cache returned before applying visibility again. The cache now
records the head along with its source and reapplies the existing domain filter
when only the head changes. Identical source/head refreshes preserve the viewport.

The new viewport patch also exposed a stale Kit builder test fixture: its
isolated repository created four patches while the production manifest read
five, causing ENOENT before the test assertions. The fixture now creates the
fifth applicable patch; the reproduced failure becomes a passing test.

Both corrections are included in [PR #229](https://github.com/phodal/pero/pull/229).
The existing viewed-mark domain table and the Native library tests cover the
underlying state rule; a real rebased-PR refresh was not replayed in the window.

A follow-up review found that the Checks module declaration lost its wasm/native
condition during integration. Default-feature `pero-ui` compilation reproduced
unresolved imports. The declaration now uses the same condition as the other PR
views; both default-feature and Native library suites are checked.

Linux CI also exposed a stale Host stdio test expectation: both layout objects
omitted the newly persisted `diff_soft_wrap` field. Exact object comparisons
then reported nine cascading preference failures. The compatibility expectation
now includes the default true value, and the saved preference explicitly uses
false so acknowledgement, rejection retention and restart prove both cases.
