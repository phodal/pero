# Harness behavioral comparison (#73)

## Scope and fixed references — 2026-11-11

This is a bounded source audit, deterministic Pero suite and same-input execution
of the official catalog hook at mocked seams. It is **not** full DSH compatibility,
a two-runtime end-to-end A/B, or real-model selection/quality evidence. [#73](https://github.com/phodal/pero/issues/73)
remains open. Earlier evidence below describes its historical revisions.

- Current Pero implementation baseline: [`b1b952939f8986c150eb9d1b7d63166411657a63`](https://github.com/phodal/pero/commit/b1b952939f8986c150eb9d1b7d63166411657a63).
  PRs #91 and #96 are already merged; later plugin/compaction changes also exist.
- Official reference: [`f3803c96974ad4a94195fb97e5c637e9c2a3afe3`](https://github.com/deepseek-ai/deepseek-harness/tree/f3803c96974ad4a94195fb97e5c637e9c2a3afe3),
  [tool-skill source](https://github.com/deepseek-ai/deepseek-harness/blob/f3803c96974ad4a94195fb97e5c637e9c2a3afe3/packages/skill/tool-skill/src/index.ts),
  Git blob `f08fb8206433bb40ec415c65e9a50382386a3bd0`.
  This is a fixed comparison reference, not a claim about latest upstream HEAD.
- [Package provenance](../../harness/go/skills/SOURCE.json) distinguishes local
  implementation from the behavioral reference. No additional Point code copied.
- Canonical active tracker: [#73 catalog behavior](../issues/2026-11-11-harness-skill-catalog-parity.md).

## Current capability matrix

Aligned means only the observable subset listed. Intentional differences retain
Pero ownership. Passing local tests does not turn unverified rows into parity.

| Capability / status | Owner and current behavior | Evidence / remaining boundary |
| --- | --- | --- |
| Skill discovery — **aligned publication subset; bounded presentation differs** | [catalog_reminder.go](../../harness/go/skills/catalog_reminder.go) emits durable user-role `skill-catalog` messages through existing PreStep. Exact visible registration and pending Skill denials control publication. Schema summaries remain available. | `TestCatalogPublicationTransitions`, `TestCatalogReminderVisibilityAndResume`, `TestSkillDenialsApplyBeforeFirstRequestAndExpire`; actual official hook consumes the same 10 fixture steps. Pero limits message bytes and provides paging instead of publishing every description. |
| Catalog visibility/recovery — **aligned subset** | Unchanged visible catalogs are not repeated. Existing Session events and surface seqs identify loss; PreStep/PostCompact restore it. Masking or same-name shadow publishes an empty replacement, lifting it republishes the selected catalog. | `TestSkillAdvertisementAcrossCompaction`, visibility/resume test and explicit cancellation/resume test. Real Pero compaction, registry and JSONL persistence; official hook's surface is mocked. Deferred undiscovered tools publish no call guidance until visible. |
| Content identity — **intentional difference** | Legacy `skill` lists names/digests then reads both; selected plugin `Skill` accepts its approved qualified name. Descriptor-bound reads retain content validation. | `catalog_test.go`, `selected_test.go`. Official resolves current scoped providers; Pero does not grant implicit roots or refresh a changed selected definition. |
| Explicit invocation — **aligned legacy subset; plugin-specific behavior** | Legacy roots recognize whitespace-bounded direct-user tokens. Claude-profile selections accept the first command, support user-only skills and existing expansion/resource contracts. Both use current claimed messages, not historical gesture replay. | `invocation_test.go`, `invocation_claude_test.go`, `selected_test.go`. These existing plugin capabilities supersede the older matrix's blanket “unsupported” claim; they are not newly introduced here. |
| Discovery roots/updates/precedence — **intentional differences + gap** | Legacy roots are explicit/direct-child and reject duplicate names. Selected plugins are assembled by existing owners. This reminder uses mount-time model-invocable summaries; it performs no filesystem discovery or rescans. | `catalog_test.go`, `selected_test.go`. Official dynamic snapshot completeness and source precedence are not implemented by this increment. Market admission/UI (#200) remains separate. |
| Loaded context after compaction — **different by profile** | Legacy bodies remain ordinary context and are not automatically reloaded. Existing Claude-profile [reattach.go](../../harness/go/skills/reattach.go) restores bounded previously activated content only when absent, without rerunning preprocessing or renewing grants. Catalog reminders are independent of body restoration. | `compaction_test.go`, `reattach_test.go`, `permissions_test.go`. The 2026-11-01 blanket “no body restoration” description was stale for plugin selections. |
| Overflow and truncated responses — **aligned subsets; wider parity unverified** | Existing compaction owner retries only after durable progress; max-token stops discard incomplete tool calls. PostCompact publishes catalog before overflow retry without requiring a new PreStep. | Existing CLI compaction suites, `TestMaxTokensDropsToolCallsAndKeepsSafeContent`, provider classification tests. No crash-atomic external exactly-once guarantee. |
| Approval/native auto-review — **product policy differs** | Existing approval and permission-mode owners decide gated requests. `ApprovalNever` rejects gated requests; Skill catalog messages grant nothing and do not renew Skill turn grants. | `harness/approval_test.go`, `permission_mode_test.go`, `acp/native_approval_test.go`, `skills/permissions_test.go`. No new default permissions. |
| MCP versus Host/App — **separate authority; parity unverified** | Direct configured MCP, native tools and Host/App route/business checks remain separate owners. | [MCP](mcp-tools-resources.md), [App Use](app-use.md). `approval=never` does not imply all MCP is read-only. No policy changes in this increment. |
| Cancellation, retries and resume — **bounded contracts** | Existing loop/admission/persistence owns cancellation and retry. Catalog restoration derives from durable surface; it does not replay tools or old explicit gestures. | `TestExplicitSkillCancellationResume`, `TestCatalogReminderVisibilityAndResume`, existing approval/retry/extraction tests. Unknown external effects still require reconciliation. |
| Remaining modules/live behavior — **unverified beyond linked contracts** | AST/source mappings are provenance evidence, not complete behavioral acceptance. | Full official-runtime/provider A/B, live Skill selection, task quality, token savings, platform packaging and scientific acceptance remain unverified. |

## Catalog contract and migration

The new named value is `catalogReminder`: tool identity, published name/description
entries, total selected count and update attribution. The functional reconciliation
uses Session events, active surface seqs and pending messages. The mount shell uses
existing exact registration visibility and the existing Skill denial rule. No new
registry, permission owner, scheduler, persistent state file or settings toggle.

New or resumed sessions with visible approved skills receive one bounded message
before their provider request. Existing visible reminders deduplicate on restore;
old sessions without one gain a first publication. Catalog background appears
before fresh skill instructions. Pending synthetic reminders surviving cancellation
are reconciled, not interpreted as fresh user input. PostCompact uses the same
rule, including retries that bypass PreStep. Historical catalog messages stay in
the audit history; an empty replacement withdraws their current call guidance.

Message content defaults to 8192 UTF-8 bytes (or the existing explicit advertisement
ceiling), with descriptions normalized and limited to 500 UTF-8 bytes. Source entries
match exactly the displayed rows; omitted rows are explicitly counted and recoverable
through the existing catalog pager. Descriptions are JSON-escaped. Bodies, digests,
resource paths and user-only entries are not disclosed. Empty initial catalogs emit
nothing. Large catalogs may display no full row at the smallest budget; their pager
remains reachable. This differs from official description-length/completeness rules.

This adds context tokens alongside existing schemas. It does not promise token savings
or model compliance. It does not pin loaded bodies, invoke resources, renew permission
grants, change provider budgets, or migrate old message formats. Existing JSON source
metadata accepts the new attributed message; no storage schema migration is needed.

## Same-input reproduction

The ordinary Go/Bazel Skill suite consumes
[testdata/catalog-publication.json](../../harness/go/skills/testdata/catalog-publication.json).
To execute the actual official hook separately, obtain the pinned source above and run:

```sh
node scripts/harness/compare-skill-catalog.mjs /path/to/official-tool-skill.ts
```

The runner requires Node with `node:module.stripTypeScriptTypes`, verifies the exact
Git blob before evaluation, then invokes the upstream catalog PreStep listener with
mocked registration, selected snapshot and Session surface seams. No upstream code is
vendored or installed as production code. Both implementations check the same inputs
and expected publication/role/entries/update results: first publication, no duplicate,
compaction loss, withdrawal, repeated withdrawal, restoration, hidden startup and
empty catalogs. It does **not** execute official compaction, loading, persistence,
incomplete discovery or provider behavior. The Go integration tests separately
exercise those local registry/persistence/compaction boundaries. The runner performs
no network calls; fetching upstream and running this comparison are explicit checks.

## Local evidence — 2026-11-11, macOS arm64, Go 1.26.4

Implementation commit: `8bedf1b6235cb96a5f5a47c538882120b5ba9fe4`. The following checks cover this increment;
no hosted CI, Native/Desktop or package acceptance is claimed.

- Full `GOWORK=off go -C harness/go test -race -count=1 ./...`: 38 packages
  passed with Python 3.12.11 selected through a task-local PATH shim. The first
  run with system Python 3.9 failed only the installed literature-review sidecar's
  `type | None` annotation; the module/source was not changed to hide it.
- Related five-package race suite and `go vet` passed; latest Skill race suite passed.
- Standalone `bazel test --lockfile_mode=error //skills:skills_test` and
  `bazel run --lockfile_mode=error //:gazelle -- -mode=diff` passed in `harness/go`.
- Exact upstream hook runner passed all 10 same-input steps. Its verified source
  blob and observed outputs are in `official-catalog.json`.
- A Go overlay replacing only tool mounting with the pinned Pero baseline makes
  the new provider catalog/resume and compaction assertions fail, as expected.
  This confirms they detect the missing behavior rather than just existing passes.
- Source/provenance JSON, document links, formatting and diff checks passed; new
  source/test files remain below 1000 lines. Test fixtures run in ordinary Go/Bazel
  suites; the optional upstream runner adds no public-network dependency to CI.

Local logs (not committed): `test-results/issue-73/` in the issue checkout,
including `harness-race-python312.log`, original `harness-race.log`,
`related-race.log`, `skills-race.log`, `vet.log`, `bazel-skills.log`, `gazelle.log`,
`official-catalog.json` and `baseline-regression.log`. Reproduction metadata is
in that directory's `README.md`. A scripted provider and mocked official seams
remain distinct from full official-runtime or real-model acceptance.

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

### Historical explicit user Skill loading — 2026-11-01 follow-on

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
