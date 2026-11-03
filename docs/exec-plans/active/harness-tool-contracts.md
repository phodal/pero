# Harness tool contract implementation

Source analysis: `docs/design-docs/harness-tool-prompt-adaptation.md`.

- [x] Caller-visible MCP guidance (7d6b700a).
- [ ] Bash directory observation preserves output and workspace identity.
- [ ] Bazel subagents direct shell dependency.
- [ ] Normalize image Read and keep provider history recoverable.
- [ ] One per-step tool selection for prompts and schemas.
- [ ] Generic regex/glob tools using the existing search implementation.
- [ ] Multi-file patch preflight, approval and accurate partial receipts.
- [ ] Root plan transitions with actual restrictions and recovery.
- [ ] Hierarchical workspace instructions with explicit scopes.
- [ ] Caller-filtered tool discovery with accurate activation semantics.
- [ ] Skill disallowed-tools enforced until the next direct user turn.
- [ ] Notebook read preserving source and output provenance.
- [ ] Assess PTY, root worktree and catalog/output budgets against existing owners.

Monitor/cron/team remain demand-driven product work, as described in the source
analysis. Do not expose placeholder tools. Update each item only after its
behavioral verification, and record remaining limitations explicitly.
