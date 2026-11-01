# Harness behavioral comparison (#73)

## Scope and fixed references

This is a **bounded source audit and deterministic Pero contract suite**, not
proof of complete DSH compatibility or a two-runtime A/B evaluation.
[Issue #73](https://github.com/phodal/pero/issues/73) remains open for its broader
acceptance. The explicit Skill increment below changes direct-user loading only;
approval policy and provider retry policy are unchanged. No new Point source was read or copied.

- Pero audit baseline: [`9dc378f96ce605d62126864e57225c5b577cd88c`](https://github.com/phodal/pero/commit/9dc378f96ce605d62126864e57225c5b577cd88c).
- Official DSH baseline: [`f3803c96974ad4a94195fb97e5c637e9c2a3afe3`](https://github.com/deepseek-ai/deepseek-harness/tree/f3803c96974ad4a94195fb97e5c637e9c2a3afe3),
  already selected in [Harness provenance](../../harness/go/SOURCE.json).
- Directly inspected for this audit: official [Skill loader/catalog](https://github.com/deepseek-ai/deepseek-harness/blob/f3803c96974ad4a94195fb97e5c637e9c2a3afe3/packages/skill/tool-skill/src/index.ts)
  (Git blob `f08fb8206433bb40ec415c65e9a50382386a3bd0`) and
  [approval pipeline `serviceAsk`](https://github.com/deepseek-ai/deepseek-harness/blob/f3803c96974ad4a94195fb97e5c637e9c2a3afe3/packages/core/tools/src/pipeline.ts#L422-L470)
  (Git blob `56c68c6c59bb280ac0c96d1198cec6c1e8e7db49`).
- Earlier official-source comparisons are linked below rather than represented
  as fresh upstream execution: [response/read/cancel review](../issues/2026-10-28-harness-upstream-parity.md)
  and [module review](../issues/2026-10-28-harness-module-contracts.md).

## Capability matrix

**Aligned subset** means the listed observable rule only. **Intentional difference** preserves current Pero authority. **Gap** is not implemented here.
**Unverified** is not converted into a pass by source extraction or AST mappings.
All local paths below are relative to this checkout; test names are searchable
entry points, not an assertion that every line in a linked package is verified.

| Capability / status | Pero owner and observable contract | Reproducible evidence / remaining boundary |
| --- | --- | --- |
| Skill relevance discovery — **intentional difference + gap** | [skills/tool.go](../../harness/go/skills/tool.go): name/description summaries in the tool description, not user-role durable catalog messages. Names/digests are listed by `skill({})` before reading. | [catalog_test.go](../../harness/go/skills/catalog_test.go), `TestToolUsesExistingRegistry`: advertised summary, no body/path/digest/disabled entry, rejected name-only call with recovery guidance. Official `apply` publishes visibility-matched `skill-catalog` messages before a step. |
| Skill content identity — **intentional difference** | [catalog.go](../../harness/go/skills/catalog.go): approved explicit roots, launch-time digest and descriptor-bound reread. Changed content fails; list does not accept a new digest. | `TestCatalogReadAndChange`, `TestToolUsesExistingRegistry`, `TestRootReplacementAfterOpen`. Official name-only loading dynamically resolves the current scoped provider. No implicit roots or precedence are added. |
| Explicit slash invocation — **aligned subset, frozen authority** | [invocation.go](../../harness/go/skills/invocation.go) selects known whitespace-bounded `/name` tokens from the current claimed direct-user text blocks, once per name per step. Existing PreStep admission appends attributed `skill-invocation` instructions before the first provider request, using the existing frozen digest read and exact visible tool registration. | `TestExplicitSkillProviderRequest`, `TestExplicitSkillCancellationResume`: direct/repeated/unknown/path/fraction and non-user sources, disabled/unmounted/masked/shadowed skills, changed content refusal, cancellation and JSONL restoration without reloading old gestures. DSH user-invocable model-disabled skills remain deliberately unsupported here. |
| Directory updates/source precedence — **gap / deliberately excluded authority** | Only direct child SKILL.md files; duplicate names fail. No dynamic discovery, resource execution or implicit home/project roots. | `TestNoImplicitRootsAndDepth`, `TestDiscoveryFailures`, `TestFrontmatterAndScriptsAreInertData`. Official `snapshot` and `catalogHistory` are not ported. Any future discovery change needs an explicit authority design. |
| Skill context after compaction — **intentional difference + gap** | [loop.go](../../harness/go/harness/loop.go) resolves schemas for each step; [compaction_range.go](../../harness/go/harness/compaction_range.go) replaces selected history, not the registered tool catalog. A previously loaded body is ordinary tool-result context, not pinned instructions. | [compaction_test.go](../../harness/go/skills/compaction_test.go), `TestSkillAdvertisementAcrossCompaction`: actual tool read reaches the provider; real summary/replacement removes its body; the next request still has the summary-only schema, no automatic body reload or durable available-skills message. Official catalog is republished when its durable event is no longer visible. |
| Context overflow recovery — **aligned subset; wider parity unverified** | [compaction_basic.go](../../harness/go/harness/compaction_basic.go): recovery only after durable surface progress, bounded overflow retry. Explicit provider overflow classified separately from a generic oversized HTTP request. | [compaction_test.go](../../harness/go/cmd/pero-agent-acp/compaction_test.go), `TestCompactionLaunchEngineLongContextOverflowCancelResume`; [adapter_test.go](../../harness/go/providers/openai/adapter_test.go), `TestContextOverflowClassificationPreservesRecovery`. Prior official review linked above; no fresh upstream runtime execution. |
| Truncated responses — **aligned subset** | [loop.go](../../harness/go/harness/loop.go) and [stream.go](../../harness/go/providers/openai/stream.go) discard tool calls at the max-token stop; safe text is retained. | `TestMaxTokensDropsToolCallsAndKeepsSafeContent`; [compaction_wire_test.go](../../harness/go/cmd/pero-agent-acp/compaction_wire_test.go), `TestCompactionCLIActualLoopAndWire`. This is not tool exactly-once execution across process crashes. |
| Approval service — **aligned subset, product policy differs** | [approval.go](../../harness/go/harness/approval.go) owns gated approval, session policy and answerer outcomes. Official `serviceAsk` also denies when no approval service/agent channel exists. Skill instructions grant no tool authority. | [approval_test.go](../../harness/go/harness/approval_test.go), `TestApprovalIsScopedDurableAndFailClosed`, `TestApprovalCancellationWinsAndLateAnswerIsDiscarded`; `TestExtractedToolValidationAndApprovalFailClosed` in [extraction_test.go](../../harness/go/harness/extraction_test.go). No claim that every tool is gated. |
| Native tools / auto-review — **intentional product policy** | [permission_mode.go](../../harness/go/harness/permission_mode.go) and native registration own permissions; auto-review may allow native operations without a human prompt. `ApprovalNever` rejects gated requests. | [permission_mode_test.go](../../harness/go/harness/permission_mode_test.go), `TestPermissionModeDecidesApproval`; [native_approval_test.go](../../harness/go/acp/native_approval_test.go). Not a blanket statement about all writes, MCP or OS confinement. Pending #87's clone-specific behavior is outside this baseline. |
| Direct MCP vs Host/App — **separate authority; parity unverified** | [harness/mcp.go](../../harness/go/harness/mcp.go) mounts configured server tools through existing registry; [mcp/tools.go](../../harness/go/mcp/tools.go) executes calls. Direct MCP registration does not set native `RequiresApproval`. Host/App separately validates session, installation, route and business permissions. | [MCP verification](mcp-tools-resources.md), [App Use verification](app-use.md), [MCP settings contracts](../../tests/contracts/mcp-settings.mjs). Server configuration/grant is not per-tool allow/ask/deny. `readOnlyHint` is not authority; `approval=never` alone does not make MCP read-only. #50 stage two and #11 policy changes are excluded. |
| Cancellation/admission — **aligned subset** | [acp/stream.go](../../harness/go/acp/stream.go) carries cancellation from prompt admission; approval cancellation discards late grants. | [stream_test.go](../../harness/go/acp/stream_test.go), `TestPromptAdmissionCancellation`; `TestExtractedLoopCancellationSettles`. Cancellation settles the local operation; it is not rollback of an external effect. |
| Provider retry vs business replay/resume — **bounded contracts, not general exactly-once** | Provider retries are owned by Harness retry policy; SDK retries are disabled. Resume consumes committed session history rather than executing old tool calls again. MCP reconnect is connection recovery, not permission to replay a failed write. | [retry_test.go](../../harness/go/harness/retry_test.go), `TestRetryWaitIsCancellableBeforeAttemptStarts`; `TestFailedHTTPConsumesBudgetWithoutSDKRetry`; `TestExtractedLoopDurableToolRoundTripAndResume`. Unknown external outcomes require reconciliation, not automatic write retry. No crash-atomic external transaction guarantee. |
| Other modules and real provider behavior — **unverified beyond linked subsets** | The existing 17 AST mapping pairs and source manifests describe extraction provenance, not all runtime behavior. | Prior module review covers selected stop/stream/read/ACP/log/Todo/MCP contracts. Official/Go same-input runtime A/B, paid-model skill selection, usage, recovery quality and complete protocol parity remain unverified. |

## Reminder and replay implications

Do not “fix” the Skill gap by duplicating the tool description as an ordinary
user message. Official behavior has durable source identity, visibility matching,
catalog completeness, updates and compaction-aware publication. Implementing it
would change model message roles/order, token pressure, persisted histories and
resume semantics. It must be designed and tested as a separate runtime change.

Current descriptions are carried by provider tool schemas, not by a history
message. The new test observes that boundary through the actual Harness adapter,
not by inspecting implementation text. Summarization may omit loaded instructions;
a subsequent task must explicitly list/read the authorized Skill again, or the
user can issue a new `/name` gesture, when needed. The test's summary intentionally omits them: it demonstrates a possible
loss, not a claim that every real summary loses them. No provider selection,
request budget, retry, summary prompt or historical-tool replay is changed here.

## Reproduction and CI

From `harness/go`, with the repository's supported Go toolchain:

```sh
GOWORK=off go test -race -count=1 ./skills ./harness ./acp ./providers/openai ./cmd/pero-agent-acp
GOWORK=off go vet ./skills ./harness ./acp ./providers/openai ./cmd/pero-agent-acp
```

The new test runs in the existing `go test -race -count=1 ./...` Harness job;
its BUILD entry also participates in standalone Bazel tests. No new workflow,
public network dependency or wall-clock sleeps are introduced. Ordinary CI stays
Linux; full/daily OS expansion is unchanged. Explicit-root positive Skill tests
remain supported on Linux/Darwin and explicitly skipped on unsupported platforms.

This increment records L0 only. No Desktop/Mac acceptance, real provider calls,
scientific result, upstream runtime execution or permission to execute Skill
resources is claimed. Existing cancellation/digest/permission/retry tests are
reused rather than copied into a second suite. Do not close #73 solely because
this bounded contract suite passes; remaining gaps and unverified rows stay open.

### Local evidence — 2026-11-01, Linux, Go 1.27.3

- Related five-package race command above passed; focused Skill test passed 20
  repetitions with race detection. Independent review repeated it three times.
- Related five-package `go vet` passed. After review, the catalog-marker assertion
  reads actual content text (JSON encoding escapes `<`); an injected marker makes
  that assertion fail, and restoring the fixture passes. Cleanup also covers
  catalog-mount failure. `git diff --check` and local document links passed.
- Standalone Bazel `//skills:skills_test` was **blocked before analysis**: local
  Bazel 9.2.0 could not load the BCR `rules_go/0.64.0/MODULE.bazel` registry file
  because Java TLS trust reported `PKIX path building failed`. No TLS verification
  was disabled, no dependency version/lockfile changed, and no Bazel pass is
  claimed. Exact-head hosted Bazel/Gazelle checks remain required.
- The initial Go build hit full `/tmp`; rerunning with a workspace-local
  `GOTMPDIR`/`TMPDIR` and the existing toolchain/module cache passed. This was an
  environment capacity failure, not a test or product failure.

### Explicit user Skill loading — bounded follow-on

The pinned official source was inspected again for this increment. Its actual
`invokedSkillNames` matcher accepts whitespace-bounded tokens anywhere in direct
user text (the earlier first-line comment is stale). Pero matches that subset
without adopting DSH's dynamic registry, durable catalog publication,
user-invocable skills hidden from model invocation, or resource execution. A loaded body is ordinary
admitted user-role context with a distinct source and launch-time digest, not a
permission grant or a pinned context that automatically reloads after compaction.
Only the claimed batch is scanned: persisted historical gestures are not loads.

The existing model-driven `{}` list followed by `{name,digest}` read remains
unchanged. Changing a selected file still requires a new approved launch-time
catalog; the explicit gesture does not refresh it or guess a replacement digest.

Local follow-on evidence (Linux, Go 1.27.3): the five-package race command above
passed, as did the complete `GOWORK=off go test -race -count=1 ./...` Harness
module suite and five-package `go vet`. `go test -race -count=10 ./skills` passed
with the new provider cases.
These are deterministic scripted-provider L0 checks, not live-model, Desktop,
upstream-runtime or scientific acceptance.
