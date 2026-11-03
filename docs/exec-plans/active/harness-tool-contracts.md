# Harness tool contract implementation

Source analysis: `docs/design-docs/harness-tool-prompt-adaptation.md`.

- [x] Caller-visible MCP guidance (7d6b700a).
- [x] Bash directory observation preserves output and workspace identity.
- [x] Bazel subagents direct shell dependency.
- [x] Normalize image Read and keep provider history recoverable.
- [x] One per-step tool selection for prompts and schemas.
- [x] Generic regex/glob tools using the existing search implementation.
- [x] Multi-file patch preflight, approval and accurate partial receipts.
- [x] Root plan transitions with actual restrictions and recovery.
- [x] Hierarchical workspace instructions with explicit scopes.
- [x] Caller-filtered tool discovery with accurate activation semantics: current catalog search, no hidden-tool activation.
- [x] Skill disallowed-tools enforced until the next direct user turn.
- [x] Notebook read preserving source and output provenance.
- [x] Assess PTY, root worktree and catalog/output budgets against existing owners; remaining product work is recorded below.

Monitor/cron/team remain demand-driven product work, as described in the source
analysis. Do not expose placeholder tools. Update each item only after its
behavioral verification, and record remaining limitations explicitly.

## Verified implementation, 2026-11-03

Go `go test -race ./...`, `go vet ./...` and all 34 Harness Bazel tests
passed. The real CLI/ACP MessageDisplay regression is included in both full
suites. The Bash disk-recovery regression passed ten consecutive race runs after
its shutdown assertion accepted the existing pending receipt and awaited Drain.
No paid provider requests were made; HTTP fixtures use loopback and real local
file/process effects. Reference code, full third-party prompts and tests were not
imported.

Hierarchical loading is opt-in with `--enable-hierarchical-instructions`; the
existing explicit root-only mode remains available. First target mutations wait
for a delivered instruction baseline. ToolSearch/tool_search searches the current
caller-filtered registry, returns input schemas/hashes and paginates within a
32 KiB item budget. It does not register or activate hidden tools and does not
reduce wire-schema size. NotebookRead/notebook_read returns saved v4 cell data
with a 48 KiB cell budget and continuation; it executes no code or image/HTML
renderer. Explore/Plan admit these read-only tools when mounted, plus generic
regex/glob tools.

## Remaining product work and evaluation

- PTY/stdin: LocalExecutor owns one noninteractive command; its stdin pipe is a
  sandbox startup control channel, not a user input session. Background tasks
  own output/stop/recovery but do not retain a terminal input handle. A PTY API
  needs shell-owned terminal resize/input/EOF and cancellation, with platform
  verification; adding an alias over Bash would not implement this contract.
- Root worktree switching: subagents/worktree.go owns temporary detached child
  worktrees and force-removes them at child cleanup. Reusing that cleanup for a
  root switch would discard work. A root lease needs a durable return point,
  retained dirty files and explicit exit behavior. No root switch tool is exposed.
- PDF and visual notebook outputs: no PDF renderer was added. NotebookRead
  preserves saved JSON provenance and explicitly discloses that pixels/HTML
  were not rendered. These are distinct capabilities.
- Catalog/output budgets: instruction rendering, discovery, notebook data,
  native read/search and Bash artifacts have local bounds. Skill and Agent
  descriptions still concatenate their selected catalogs; MCP instructions
  are separately assembled. SpillRegistry already owns scoped storage and
  recoverable locators, but no single shared catalog/retained-output quota is
  configured here. Bound/list these catalogs through their current owners;
  do not introduce another registry or silently drop entries.
- Prompt outcome evaluation: deterministic contracts prove capability alignment,
  not optimal model behavior. Compare the same model/tasks with and without the
  guidance, recording tool errors, retries, task completion and cost before
  claiming a best prompt.
