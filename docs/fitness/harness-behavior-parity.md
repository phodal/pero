# Harness behavioral comparison (#73)

## Scope and fixed references — 2026-11-11

This is a bounded source audit, deterministic Pero suite and same-input execution
of the official catalog hook at mocked seams. It is **not** full DSH compatibility,
a two-runtime end-to-end A/B, or real-model selection/quality evidence. The seven
audit deliverables in [#73](https://github.com/phodal/pero/issues/73) are complete
and published with coordinated GitHub closure. Earlier evidence below describes its historical revisions.

- Acceptance Pero baseline: `7ff7c637732606286940b50bafee4d0d3b47a2f5`.
  It includes the catalog implementation `8bedf1b6235cb96a5f5a47c538882120b5ba9fe4`
  and its documentation. This acceptance increment changes CI, an App alias
  regression and documentation; it changes no production policy or runtime.
- Official reference: [`f3803c96974ad4a94195fb97e5c637e9c2a3afe3`](https://github.com/deepseek-ai/deepseek-harness/tree/f3803c96974ad4a94195fb97e5c637e9c2a3afe3),
  [tool-skill source](https://github.com/deepseek-ai/deepseek-harness/blob/f3803c96974ad4a94195fb97e5c637e9c2a3afe3/packages/skill/tool-skill/src/index.ts),
  Git blob `f08fb8206433bb40ec415c65e9a50382386a3bd0`.
  This is a fixed comparison reference, not a claim about latest upstream HEAD.
- [Package provenance](../../harness/go/skills/SOURCE.json) distinguishes local
  implementation from the behavioral reference. No additional Point code copied.
- Canonical active tracker: [#73 catalog behavior](../issues/2026-11-11-harness-skill-catalog-parity.md).

## Original seven acceptance items

The issue asks for an auditable matrix that separates aligned, intentional,
missing and unverified behavior. It does not require implementation of every
upstream feature. An explicitly unverified full-runtime/model/platform result is
not silently converted into either a pass or an extra closure requirement.

| Original item | Acceptance and evidence |
| --- | --- |
| 1. Fixed source refs and capability matrix | Complete. Exact Pero and official refs above, package provenance, current matrix below and linked implementation/test owners. The older module/AST audit is historical source evidence, not current full equivalence. |
| 2. Skill catalog/read/digest/change/compaction/precedence contract | Complete. Contract below and [Skills README](../../harness/go/skills/README.md) distinguish frozen explicit roots, selected plugins, bounded publication, digest rejection, restart for changed directories, exact visibility and body restoration. Dynamic official precedence is intentionally not adopted. |
| 3. Repeatable behavior at equal input and mocked boundaries | Complete. One shared fixture drives native reconciliation and the actual hash-pinned official hook. Native integration checks real registry, provider request order, JSONL resume and compaction; official seams are mocked. Approval/MCP effect counters and App transport checks below test observable authorization and effects. No whole-runtime equivalence claim. |
| 4. Native/MCP/Host-App/auto-review authority plus recovery | Complete. The separate authority table below names each owner and tests. Cancellation, unknown effects, reconnect without replay and gated permission outcomes are retained. No permission widened. |
| 5. Separate task, Skill use, redundant calls, recovery and usage in traces | Complete as an evidence classification, not a new live A/B. The trace table below records historical observations, unknown denominators/usage and artifact-review limits separately. Legal direct aliases are not failures. The new transport assertion verifies direct alias behavior before any describe call. No new paid run or hidden-reasoning publication. |
| 6. SOURCE/README/fitness without overclaims | Complete. Skills SOURCE distinguishes legacy/plugin scope and links this acceptance baseline. Harness README corrects obsolete blanket MCP/human-approval claims and the already-fixed missing-reminder description. This record retains all unverified boundaries. |
| 7. Ordinary lightweight CI, full/daily official comparison | Complete in workflow configuration. Existing ordinary Linux Harness race/Bazel suites contain the shared fixture. Full/daily/manual `ast` job steps run the exact official hook against the already pinned checkout and retain JSON receipts; failure fails the existing required job. Existing multi-platform expansion is unchanged. Local checks pass; this increment's hosted CI has not yet run. |

Closure recommendation: close the **audit issue** after the coordinator publishes
and integrates this acceptance record. There is no known missing mandatory
deliverable in these seven items. Full DSH runtime A/B, dynamic discovery and
real-model quality may be separately scoped if requested; they are not silently
added to this issue's implementation scope.

## Current capability matrix

Aligned means only the observable subset listed. Intentional differences retain
Pero ownership. Passing local tests does not turn unverified rows into parity.

| Capability / status | Owner and current behavior | Evidence / remaining boundary |
| --- | --- | --- |
| Skill discovery — **aligned publication subset; bounded presentation differs** | [catalog_reminder.go](../../harness/go/skills/catalog_reminder.go) emits durable user-role `skill-catalog` messages through existing PreStep. Exact visible registration and pending Skill denials control publication. Schema summaries remain available. | `TestCatalogPublicationTransitions`, `TestCatalogReminderVisibilityAndResume`, `TestSkillDenialsApplyBeforeFirstRequestAndExpire`; actual official hook consumes the same 10 fixture steps. Pero limits message bytes and provides paging instead of publishing every description. |
| Catalog visibility/recovery — **aligned subset** | Unchanged visible catalogs are not repeated. Existing Session events and surface seqs identify loss; PreStep/PostCompact restore it. Masking or same-name shadow publishes an empty replacement, lifting it republishes the selected catalog. | `TestSkillAdvertisementAcrossCompaction`, visibility/resume test and explicit cancellation/resume test. Real Pero compaction, registry and JSONL persistence; official hook's surface is mocked. Deferred undiscovered tools publish no call guidance until visible. |
| Content identity — **intentional difference** | Legacy `skill` lists names/digests then reads both; selected plugin `Skill` accepts its approved qualified name. Descriptor-bound reads retain content validation. | `catalog_test.go`, `selected_test.go`. Official resolves current scoped providers; Pero does not grant implicit roots or refresh a changed selected definition. |
| Explicit invocation — **aligned legacy subset; plugin-specific behavior** | Legacy roots recognize whitespace-bounded direct-user tokens. Claude-profile selections accept the first command, support user-only skills and existing expansion/resource contracts. Both use current claimed messages, not historical gesture replay. | `invocation_test.go`, `invocation_claude_test.go`, `selected_test.go`. These existing plugin capabilities supersede the older matrix's blanket “unsupported” claim; they are not newly introduced here. |
| Discovery roots/updates/precedence — **intentional differences** | Legacy roots are explicit/direct-child and reject duplicate names. Selected plugins are assembled by existing owners. This reminder uses mount-time model-invocable summaries; it performs no filesystem discovery or rescans. | [catalog_test.go](../../harness/go/skills/catalog_test.go) tests a new authorized catalog after directory changes; [selected_test.go](../../harness/go/skills/selected_test.go) checks frozen selection and qualified/bare names. Official dynamic snapshots and cross-source precedence are not the target contract. |
| Loaded context after compaction — **different by profile** | Legacy bodies remain ordinary context and are not automatically reloaded. Existing Claude-profile [reattach.go](../../harness/go/skills/reattach.go) restores bounded previously activated content only when absent, without rerunning preprocessing or renewing grants. Catalog reminders are independent of body restoration. | `compaction_test.go`, `reattach_test.go`, `permissions_test.go`. The 2026-11-01 blanket “no body restoration” description was stale for plugin selections. |
| Overflow and truncated responses — **aligned subsets; wider parity unverified** | Existing compaction owner retries only after durable progress; max-token stops discard incomplete tool calls. PostCompact publishes catalog before overflow retry without requiring a new PreStep. | Existing CLI compaction suites, `TestMaxTokensDropsToolCallsAndKeepsSafeContent`, provider classification tests. No crash-atomic external exactly-once guarantee. |
| Approval/native auto-review — **product policy differs** | Existing approval and permission-mode owners decide gated requests. `ApprovalNever` rejects gated requests; Skill catalog messages grant nothing and do not renew Skill turn grants. | `harness/approval_test.go`, `permission_mode_test.go`, `acp/native_approval_test.go`, `skills/permissions_test.go`. No new default permissions. |
| MCP versus Host/App — **intentional separate authority; local behavior verified** | Direct configured MCP, annotations, trusted tool policy and Host/App route/business checks remain separate owners. | Authority table below; [MCP](mcp-tools-resources.md), [App Use](app-use.md). `approval=never` does not imply all MCP is read-only. Official end-to-end product policy parity is unverified. |
| Cancellation, retries and resume — **bounded contracts** | Existing loop/admission/persistence owns cancellation and retry. Catalog restoration derives from durable surface; it does not replay tools or old explicit gestures. | `TestExplicitSkillCancellationResume`, `TestCatalogReminderVisibilityAndResume`, existing approval/retry/extraction tests. Unknown external effects still require reconciliation. |
| Stop, stream and usage — **aligned selected contracts; provider formats differ** | [loop.go](../../harness/go/harness/loop.go) and [provider adapter](../../harness/go/providers/openai/adapter.go) reject incomplete tool dispatch, retain output-limit outcomes and validate provider usage. | [provider tests](../../harness/go/providers/openai/adapter_test.go): max tokens, malformed/truncated streams, usage bounds, cancellation. [Pinned AST mapping](../../scripts/ast-compare/mappings/official-dsh.json) links official symbols; extraction is not oracle execution. |
| File reads/results — **intentional presentation limits; tested local behavior** | [fstools](../../harness/go/fstools/workspace.go) owns bounded physical-line reads and continuation. | [workspace tests](../../harness/go/fstools/workspace_test.go). Official default 50 KiB versus local 16 KiB and JSON envelope differ. Actual OS/sandbox acceptance is separately scoped. |
| ACP admission/settlement — **aligned selected contracts; descendant scope differs** | [prompt.go](../../harness/go/acp/prompt.go) owns admitted prompt context and waits for active work to settle before releasing its slot. | [ACP extraction tests](../../harness/go/acp/extraction_test.go) and existing MCP lifecycle tests; no all-descendant official-runtime parity claim. |
| JSONL/storage recovery — **intentional policy differences** | [persistence.go](../../harness/go/session/persistence.go) defaults to rejection; explicit complete-tail recovery preserves original bytes under a writer lease. | [identity/recovery tests](../../harness/go/session/persistence_identity_test.go), [inbox recovery](../../harness/go/session/inbox_recovery_test.go). Unlike upstream fragment recovery, malformed tail bytes are not discarded. Generic legacy store migration is not the active CLI persistence path. |
| Todo/MCP capability/structured results — **aligned selected contracts; broader rendering differs** | Existing [Todo](../../harness/go/todos/normalization.go), [CLI coding composition](../../harness/go/cmd/pero-agent-acp/coding.go) and [MCP tools](../../harness/go/mcp/tools.go) own behavior. | Current Todo/CLI/MCP suites pass; the 17-pair [mapping](../../scripts/ast-compare/mappings/official-dsh.json) names source landmarks. Full attachment/PTC rendering remains unverified. |
| Remaining modules/live behavior — **unverified beyond linked contracts** | AST/source mappings are provenance evidence, not complete behavioral acceptance. | Full official-runtime/provider A/B, live Skill selection, task quality, token savings, platform packaging and scientific acceptance remain unverified. |

## Authority is checked at distinct owners

The pinned official [tool pipeline](https://github.com/deepseek-ai/deepseek-harness/blob/f3803c96974ad4a94195fb97e5c637e9c2a3afe3/packages/core/tools/src/pipeline.ts)
was read for this audit. Its `serviceAsk` delegates to the composed approval
service; missing service/agent denies, and allowed/rejected/cancelled/unavailable
remain distinct. This source observation is not execution of official native,
MCP or Pero-specific Host policy.

| Boundary | Current Pero contract and executable evidence |
| --- | --- |
| Native tool registration | Explicit workspace/shell composition owns access; mutation enters `RequiresApproval`. Caller-supplied or remote metadata cannot forge a native descriptor. [native_approval_test.go](../../harness/go/acp/native_approval_test.go) exercises actual ACP metadata and owner drain; [approval_test.go](../../harness/go/harness/approval_test.go) covers never, scoped audit, unavailable answerers and late cancellation. |
| MCP server grant and annotations | [tools.go](../../harness/go/mcp/tools.go) maps explicit non-read-only annotations to approval. Legacy no-annotation and read-only-hint tools add no gate; server claims do not prove harmlessness. [visibility_test.go](../../harness/go/mcp/visibility_test.go) pins this distinction. `cwd` is not a sandbox, and `approval=never` only rejects gated calls. |
| Trusted MCP tool policy | [policy.go](../../harness/go/mcp/policy.go) freezes exact remote-name allow/ask/deny at admission; [mcp_access.go](../../harness/go/harness/mcp_access.go) carries it into the existing tool pipeline. [mcp_policy_test.go](../../harness/go/harness/mcp_policy_test.go) observes zero denied effects, mandatory ask despite auto-review/preapproval, new-tool default denial, per-session isolation and reconnect without replay. [ACP dispatch tests](../../harness/go/acp/mcp_policy_test.go) prove negotiation and resume. |
| Session auto-review | [permission_mode.go](../../harness/go/harness/permission_mode.go) allows ordinary gated requests in auto-review without consulting an answerer; this name does not imply a second AI reviewer. `AlwaysAsk` still asks and `ApprovalNever` still rejects. Read-only denies; workspace-write rejects shell and asks for files; full-access asks. [permission_mode_test.go](../../harness/go/harness/permission_mode_test.go) drives each mode and trusted preapproval, separately from sandbox configuration. |
| Host/App route and business authority | [app-use-mcp.ts](../../desktop/src/main/app-use-mcp.ts) maps declared aliases into the same prepared-write/schema path. [app-use.ts](../../desktop/src/main/app-use.ts) checks session, binding, scope, turn/selection and task lifecycle; the App backend still validates domain inputs. No second Desktop human prompt is added. [app-use.test.ts](../../desktop/src/main/app-use.test.ts) counts actual effects, rejects invalid/foreign writes, revokes/cancels tasks and now invokes an advertised alias before describe. Generic describe-before-write is workflow guidance, not a second security grant. |
| Skill instructions | [permissions_test.go](../../harness/go/skills/permissions_test.go) and existing mount/invocation tests cover denial before the first request and bounded invocation grants. Catalog publication does not execute resources, renew grants or bypass tool/Host owners. Selected-plugin resources/hooks remain separately admitted; legacy roots do not execute them. |
| Cancellation, unknown effects and retry | [scoped_test.go](../../harness/go/fstools/scoped_test.go) preserves committed-but-unreadable effects as unknown; [retry_test.go](../../harness/go/harness/retry_test.go) covers bounded provider retries and cancellation before dispatch. App cancellation/failed plans do not promise rollback of a started callback. MCP reconnect replaces a connection without replaying business calls. These local contracts do not establish exactly-once external effects. |

## Trace dimensions, without a new paid run

The historical real DeepSeek run described in the
[issue body](https://github.com/phodal/pero/issues/73) used Go Harness with
synthetic research interfaces. The raw session and saved-reference artifacts are
not present in this acceptance checkout, so the table explicitly distinguishes
that reported observation from newly reproduced artifact checks. It is not a
before/after quality score or an official-versus-Pero live comparison.

| Dimension | Historical trace evidence | Current acceptance evidence / limit |
| --- | --- | --- |
| Task outcome / artifacts | Issue reports five saved research references and no download or execution. | This checkout does not re-inspect those five artifacts; it does not infer scientific success from final prose. New App transport tests inspect returned values and exact effect counts. |
| Skill coverage | Issue reports no discovery or body load, despite advertised Paper tool use. | Native tests now inspect provider-visible catalog and invocation context. Live selection probability/coverage after the fix remains unmeasured. |
| Redundant calls | Direct advertised aliases were legal; an extra generic describe must not be scored as mandatory. Historical total redundancy count unavailable. | Existing App test now proves alias execution before describe, then separately exercises generic discovery/write. No claimed token savings. |
| Recovery | No historical failure/recovery denominator is retained here. | Cancellation/late approvals, digest changes, JSONL continuation, compaction and MCP reconnect are deterministic local checks; not a live-model recovery rate. |
| Usage | No trustworthy request/token/cost totals are available in the historical record. | Unknown, not zero. This acceptance makes zero new provider requests; hook/Go/Node wall time is not model usage. |
| Scientific validity | Synthetic interfaces and saved citations do not validate a scientific claim. | Unverified; artifact identity and software effects are kept separate from scientific support. |

Future optional live comparisons must save a sanitized artifact manifest plus
these separate dimensions. Do not publish credentials or raw hidden reasoning,
score only final prose, or turn unknown usage into a fabricated zero.

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

The shared test runs in the existing `go test -race -count=1 ./...` Harness job;
its BUILD entry also participates in standalone Bazel tests. The existing AST job
already checks out the fixed official source. Full/daily/manual mode now invokes
the actual hook on that checkout and uploads `official-skill-catalog.json`; it
adds no new fetch or job. Ordinary CI stays Linux and does not run the optional
official hook; full/daily OS expansion is unchanged. Explicit-root positive Skill tests
remain supported on Linux/Darwin and explicitly skipped on unsupported platforms.

This increment records L0 only. No Desktop/Mac acceptance, real provider calls,
scientific result, upstream runtime execution or permission to execute Skill
resources is claimed. Existing cancellation/digest/permission/retry tests are
reused rather than copied into a second suite. Closure rests on all seven audit
deliverables above, not on a whole-suite pass or an assertion of full parity.

### Acceptance recheck — 2026-11-11

Isolated branch `codex/issue-73-acceptance`, base `7ff7c637732606286940b50bafee4d0d3b47a2f5`:

- All 38 Harness packages passed `GOWORK=off go -C harness/go test -race -count=1 ./...`
  with Python 3.12 selected only in the test command's PATH.
- Actual unchanged pinned official hook passed the same ten fixture steps on
  local Node 26 and the CI-selected Node 22; both JSON receipts match exactly.
- Existing App Use transport/lifecycle suite passed nine tests; the alias case
  invokes the advertised alias before any describe request and inspects effects.
- CI mode/required-job contracts passed (nine tests; one unrelated existing
  archive test skipped on Darwin). The test checks the same full-mode predicate,
  source pin, required failure propagation and receipt output for the hook.
- Current source refs, local links, JSON, formatting and line limits checked.

Local receipts are under `test-results/issue-73-acceptance/` in this checkout:
`harness-race.log`, `official-catalog{,-node22}.json`, `app-use.log`, `ci-contract.log` and
`README.md`. No hosted CI, live model or GUI claim is added by these rechecks.

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
