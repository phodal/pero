---
kind: verification_report
status: resolved
date: 2026-11-04
pull_request: https://github.com/phodal/pero/pull/116
---

# Claude plugin review fixes and local verification

The repair starts at PR #116 head `6c9b97cd60d7ea55633c23b50f3d0cf71ce4c09e`.
The remote head was unchanged when rechecked after implementation. The initial
verification below was local. After explicit publication approval, the equivalent
repair tree was pushed as `878b6beac5553e2abb2e0a3134201385febd27f5`.
The PR was not merged and no model request was made by this work.

## Fixed behavior

- Added directories belong to an agent and its explicit parent/child chain.
  Other root sessions cannot read them through native file, PDF or notebook
  tools. Revocation closes the owning descriptor without removing another
  agent's independent grant. Deactivation releases grants before app drain.
- Hook environment scripts use fresh, private host temporary directories,
  never a pre-existing workspace/session-ID path. File-tool authority cannot
  reach those private paths through a broad ancestor grant. Teardown removes
  owned state and leaves pre-existing workspace files untouched.
- Frontmatter hook inspection exposes metadata, not executable command/args.
  Frontmatter async settings survive compilation, and detached hook completion
  settles its process group, including children after the leader exits.
- Prompt hooks resolve declared plugin model/provider routes without changing
  the conversation's model selection.
- Resumed subagents preserve persisted restrictions, apply the current
  definition's denied tools, and restore the definition's turn budget.
- Notebook type conversion adds required code outputs/execution_count and
  removes fields that do not belong to the target cell type.
- LSP diagnostics are scoped to the owning agent and selected server/workspace
  instance. File receipts use the actual native workspace root, including
  detached worktrees and authorized added directories. Delivery cursors include
  document version and instance identity, so reopening or changing roots cannot
  suppress new publications. Deactivation releases server processes and slots.
- Product event forwarding preserves user-question support and current
  master's safe window messaging and host-close shutdown sequence.

An existing cold-memory resume test incorrectly rejected the documented
pending-disposal sentinel before calling Drain. The failure reproduced twice
in 30 runs with the original managed-resume implementation. The test now
accepts only that sentinel and still requires successful Drain; production
shutdown behavior is unchanged.

## Verification

Environment: Linux amd64, official Go 1.25.14 archive verified against the
published SHA-256, Node 24.22.1. Dependencies passed `go mod verify`. Test
processes used a temporary home, a minimal environment, and offline module
resolution. No live-provider credentials or opt-in model flags were supplied.

- `go test -race -count=1 ./...` in `harness/go`: **35 packages passed**,
  **1,022 top-level tests and 1,841 subtests passed**, **15 top-level skips**,
  **zero failures**. This is 2,863 passing test events, not 2,863 independent
  top-level tests.
- The original PR's package set, plus fstools, claudehooks, lsp and harness,
  separately passed the full race run: 11 packages, 1,625 passing test events,
  10 skips and zero failures.
- Focused resume/notebook regressions passed 20 consecutive race-enabled runs.
  Baseline overlays reproduced the old deny-list, turn-budget and notebook
  conversion failures before the fixes.
- `go vet ./...`, Go formatting and `git diff --check` passed.
- The ACP CLI built successfully. Real `plugins inspect` and `plugins validate`
  runs on a local synthetic plugin produced valid JSON with command/argument
  sentinels redacted and async metadata retained. Neither command ran its hook.
- Product TypeScript passed Node's strip-types syntax check. The local merge
  commit `7256733cc121be9abe3ae42d7a264c55d5f7f9af` includes master
  `a8dfb9e450fad95b6cb7c56196b9746f0150e08d`; `git merge-tree` then exited 0.
  The merged Go harness tree is identical to the tree tested above.
- Independent static review covered the repairs and drove additional fixes
  for LSP workspace selection, owner cleanup and instance-specific cursors.

## Initial local verification limits

The 15 skips include unsupported-platform contracts; real clangd/model and
original external plugin-source opt-ins; an existing shell-selection fixture
that hides Bash from PATH; strict sandbox unavailability; and a host-denied
Unix socket fixture. Passing the sandbox package does **not** mean this host
can isolate generated code. No DeepSeek benchmark, paid model call, original
openstar external-service acceptance, Windows/macOS runtime test, Bazel run,
or Electron UI test is claimed. Product verification is syntax plus merge
review, not live desktop acceptance.

Existing added-directory launch-root alias compatibility is not expanded by
this repair.

## Post-publication CI findings

The first published repair head was `878b6beac5553e2abb2e0a3134201385febd27f5`.
[CI run 41756076586](https://github.com/phodal/pero/actions/runs/41756076586)
tested GitHub's synthetic merge `b6aa9bc253740f9c5fb95d649fe2ba08d5a4508c`
against master `ddd3650454de1fea7a35a46200756bec4fe71754`.

- The standalone harness Bazel job stopped at Gazelle's generated-file diff.
  The correction includes the previously unlisted permission-request test,
  canonical source/dependency ordering, and Unix-specific test dependencies.
  The corrected files match the exact Gazelle diff emitted by CI. Both changed
  packages pass `go test -race -count=1 ./claudehooks ./pluginruntime` locally;
  that command is not a replacement for the full Bazel CI job.
- The official DSH reference job stopped because ten right-side source hashes
  were stale after the PR's Go changes, including two prompt mappings whose
  function moved to another source file. The refreshed mapping retains all
  17 pairs and their semantic landmarks. The original mapping reproduces the
  CI result (7 extracted, 10 unavailable, exit 2). With the pinned official DSH
  source and documented TypeScript grammar extension, the repaired mapping
  reports 17 `cross_language_review_required`, zero unavailable, exit 0 on
  both the PR head and the synthetic merge. All 18 AST unit tests pass without
  skips. This is successful extraction for review, not semantic equivalence.
- Generated-contracts and Linux core-contracts jobs also failed in Paper
  tests. The failing tests, their helpers and relevant Paper UI sources have
  identical Git blobs in master and the synthetic merge. These are upstream
  test/UI drift, not changes introduced by the plugin branch: revision/parse
  tests seek removed controls, while Library tests expect a text Save button
  or old locator flow instead of the current Download PDF icon action.
  No Paper assertions, skip conditions or production behavior were changed.

This follow-up corrects the branch-owned Bazel and DSH metadata. The upstream
Paper failures remain explicit CI blockers; it does not claim all CI is green.

The next CI run, [41757503467](https://github.com/phodal/pero/actions/runs/41757503467),
passed DSH extraction and the Bazel generation/build steps, but exposed an
intermittent subagent rejection test failure. The unmodified test failed twice
in 500 local race runs; diagnostic-only reruns failed three times in 1,000,
each with `pendingPrompts` decreasing from 2 to 1 as startup work was consumed.
That counter never tracked steer inbox insertion. The test now waits for the
child's model-entry signal and observes the exact rejected message IDs at the
synchronous `InboxInserted` boundary. Both existing rejection-code assertions
remain, with no production behavior change.

All protocol-prompt tests pass 1,000 consecutive race-enabled repetitions, and
the complete Go module passes another race run (35 packages). A temporary Go
overlay that admits the image before returning the same rejection code makes
the new assertion fail with `rejected-image` / `next-step`, confirming it
detects the rejected message reaching the inbox. The overlay was not committed.
