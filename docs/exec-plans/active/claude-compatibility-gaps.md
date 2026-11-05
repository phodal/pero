# Claude plugin compatibility follow-up, 2026-11-05

Continue from c4251a64 and the existing Claude plugin compatibility analysis.
The source checkout is shared with an active benchmark repair; use this isolated
worktree and integrate verified changes without overwriting that work.

- [x] Integrate f5646077 (immutable context decoding and report ownership repair).
  PR #116 Linux checks pass; integrated local full Go race, vet and 36/36 Bazel pass.
- [x] Local marketplace entry/manifest composition and nested commands.
  Plugin, runtime and actual CLI Go race suites pass.
- [x] Explicit Git marketplace acquisition/update with revision receipts.
- [x] InstructionsLoaded tied to admitted CLAUDE.md baselines, asynchronous and
  observational. ConfigChange remains unsupported.
- [x] LSP dynamic query registration and observed external file changes.
- [x] Remote MCP headersHelper refreshes per connection through the existing
  shell/process owner. OAuth browser login/store/refresh remains unsupported.
- [x] Refresh coder/new_code/sad acceptance and platform evidence, preserving unknowns.

External account/device workflows require their actual services and credentials;
local fixtures cannot certify those workflows. A lost JavaScript execution stack
is not serializable: retain journal-based continuation and report lost owners
rather than replaying uncertain effects. Prompt quality requires measured runs,
not a claim of optimality. Unsupported team/Windows runtime features must remain
explicit until their owning runtime exists and is verified.

Sources: Claude marketplace reference retrieved 2026-11-05, and the pinned
contracts in docs/design-docs/claude-code-plugin-compatibility.md. The current
reference says default strict=true appends entry components to a present
manifest; strict=false plus entry components is a conflict. Entry hooks replace
manifest matchers per event. A manifestless entry supplies the manifest.

## Selected acceptance

Prioritize coder, new_code and sad, as explicitly requested. The source packages
are operator-selected snapshots with existing hash-pinned migrations; do not copy
their source or tests into Harness. coder/new_code real CLI opt-in tests passed in
the integrated full race run. SAD original validator accepts the valid sample and
rejects the invalid sample (19 errors). No draw.io executable is installed, so
regenerating diagram exports is not validated. Real-model new_code completed in 43 HTTP requests: both repositories implement
clamp, record fresh tests, run an independent reviewer and publish to local bare
remotes. Independent rechecks pass six tests per repo plus boundary assertions;
main is unchanged, worktrees clean and published heads match verification.
The state deliberately remains published_testing. SAD completes its selected
standards/validator/reviewer/report subflow in 21 HTTP requests with zero cleanup
errors; all 14 sample files remain unchanged. Its traceability findings show
that structural success does not certify content. Both runs use deepseek-flash,
not Claude model equivalence; no retries or fabricated usage/cost.

Machine-readable evidence: [local-plugin-acceptance.json](../../../harness/tools/trial/local-plugin-acceptance.json).
Coder's earlier complete real-model recovery evidence remains separate; its
1011 cumulative requests are not part of these new runs.

## Remaining product boundaries

Native OAuth login/token storage, general settings merging, ConfigChange/team
runtime events, user/ancestor/rules/import instruction discovery, whole-workspace
LSP watching and dynamic synchronization, archive/npm marketplace sources, and
Windows/sandbox PTY remain unsupported. These are not certified by the selected
local plugin runs. Lost execution stacks still use durable journal continuation;
uncertain effects are never silently replayed. Broader prompt comparisons remain
measurement work, not a compatibility or optimality claim.


## Linux verification correction

The first current-branch Linux run exposed /bin/sh resolving to dash while the
existing executor supplies Bash startup flags. The MCP headers helper now selects
/bin/bash; no shared shell behavior or credential redaction changed. Gazelle also
normalized BUILD ordering/platform dependencies. See the [incident](../../issues/2026-11-05-mcp-header-helper-shell.md).
