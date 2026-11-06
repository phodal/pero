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
- [x] Caller-filtered discovery and opt-in durable deferred tool declarations.
- [x] Skill disallowed-tools enforced until the next direct user turn.
- [x] Notebook read preserving source and output provenance.
- [x] Shell-owned PTY stdin/EOF/resize/stop with durable native startup.
- [x] Root worktree transitions retain files, original return point and resume leases.
- [x] Probed PDF pages and saved notebook raster output with provenance.
- [x] Shared catalog budget, paginated recovery and retained session spill quota.
- [x] Bounded same-model native guidance A/B with recorded samples.

Monitor/cron/team remain demand-driven product work, as described in the source
analysis. Do not expose placeholder tools. Update each item only after its
behavioral verification, and record remaining limitations explicitly.

## Earlier baseline verification, 2026-11-03

Go `go test -race ./...`, `go vet ./...` and all 34 Harness Bazel tests
passed. The real CLI/ACP MessageDisplay regression is included in both full
suites. The Bash disk-recovery regression passed ten consecutive race runs after
its shutdown assertion accepted the existing pending receipt and awaited Drain.
At that baseline, no paid provider requests were made; HTTP fixtures use
loopback and real local file/process effects. Reference code, full third-party prompts and tests were not
imported.

Hierarchical loading is opt-in with `--enable-hierarchical-instructions`; the
existing explicit root-only mode remains available. File mutation guards and
instruction lookup follow a typed native root-worktree lease. NotebookRead keeps
saved cell JSON with pagination; NotebookImage separately reads saved raster
pixels and PDFRead requires a successfully probed Poppler renderer.

## Five-track implementation, 2026-11-03

| Track | Implemented contract | Verification / remaining boundary |
| --- | --- | --- |
| Deferred tools | `--defer-tool-loading` starts with ToolSearch; complete results durably activate exact schemas for subsequent requests. Authorization, current registration and request declarations still gate dispatch. | Real HTTP wire, same-batch rejection, unload/reload, failed checkpoint, compaction, disk resume and child isolation. Another authoritative/PTC presenter or tool-history protocol is explicitly incompatible. |
| Interactive terminal | Real Open/Read/Write/Resize/Stop on the existing shell owner. Approved startup intent is flushed before launch; live-only exact-agent handles, bounded output/lifetime, observed cancellation and exit. | macOS real process/race tests, including interruption then reopening. Linux runtime now passes in PR #116 Harness CI (2026-11-05); Windows cross-compiled only. No Windows or configured-sandbox PTY tools. |
| Root worktree | Approved root-only retained detached checkout, durable cwd/return point, file/shell/instruction rebinding. Exit/shutdown never delete files or Git registration. | Real Git, dirty-file preservation, JSONL restore, instruction refresh and checkout-filter cancellation. Starts at committed state; existing dirty edits are not copied. No automatic merge or cleanup. |
| Document images | Probed pdftoppm/pdfinfo, descriptor-backed source via stdin, page numbers/SHA-256; saved notebook raster outputs/attachments include cell provenance. | Real Poppler two-page rendering and notebook fixtures; next provider request tested in image/text routes. PDF: 32 MiB source, 30 seconds, up to three pages/call. No OCR or notebook execution; renderer must be installed. |
| Shared budgets | 64 KiB across Skill/Agent catalog descriptions and MCP initialization guidance; owner-backed paginated metadata recovery. Retained text/process spill defaults to 256 MiB/session. | Large catalogs/UTF-8/full-text recovery; concurrent store writers, abort and restart accounting. Quota synchronization is within one runtime process; simultaneous runtimes writing the same directory are not coordinated. |

Final integration passed Go `go test -race ./...`, `go vet ./...` and all 34
Harness Bazel test targets. After the final deferred native-output change,
`harness`/`nativetools` race, vet and both Bazel targets passed again. The ordinary
model-evaluation test is opt-in and skipped during these local suites. Changed
Go files stay within 1000 lines; diff whitespace, source metadata hashes and
removed business/author identifiers were checked.

Complete catalog rows remain with the existing owners. Skill/skill `summary`
reads metadata without invoking a workflow or a fork; AgentList and
read_mcp_instructions recover their respective full descriptions. Recovery
prompts name only tools present in the admitted request. Local spill quota errors
preserve previously retained artifacts and do not rerun a process.

## Prompt outcome evaluation

The explicit opt-in TestNativeGuidanceModelEvaluationOptIn uses the same
`deepseek-flash` model and tools on fresh synthetic workspaces, with only the
native guidance section varied. Three independent runs of two tasks and two
variants produced 12 samples; raw metrics are in
[harness-guidance-evaluation.json](../../design-docs/harness-guidance-evaluation.json).
No shell, real business data or downloaded implementation was sent to the model.

| Variant | Completed | Requests | Tool calls / errors | Input / output tokens | Total elapsed |
| --- | --- | --- | --- | --- | --- |
| Without native guidance | 6/6 | 26 | 26 / 0 | 8,067 / 2,479 | 33.26 s |
| With native guidance | 6/6 | 28 | 29 / 0 | 8,380 / 3,027 | 32.51 s |

This small fixed-order sample establishes successful behavior on those fixtures;
it shows no reliable efficiency improvement. It does not establish the best
prompt, evaluate deferred mode with a real model, or validate all plugins.
Broader model/task evaluation and unsupported platform/sandbox capabilities remain
product work. Native Linux PTY now passes the Harness Linux CI contracts. Monitor/cron/team
remain demand-driven; no placeholder tools are added.


## Follow-up verification, 2026-11-05

Integrated compatibility fixes pass full Go race/vet and 36/36 standalone Bazel
contracts. coder/new_code opt-in actual CLI regressions also pass. New bounded
real-model trials cover new_code two-repository development/local publication
and SAD standards/validator/reviewer execution; scopes and remaining boundaries
are in [the compatibility follow-up](claude-compatibility-gaps.md).

## Responses provider evaluation, 2026-11-06

This follow-up starts from the freshly fetched `origin/master` commit
`185673fc` in a separate `codex/claude-openapi-master` worktree. The original
checkout's uncommitted changes are preserved. The selected provider is
`http://187.124.157.143:8989/v1`, model `gpt-6.1-sol`. Its credential is stored
only in the ignored local `.env`, with mode 0600.

The model-list request succeeded. A Chat Completions streaming probe returned
HTTP 503 with `NO_AVAILABLE_CHANNEL`; an explicit nonstreaming Responses probe
returned HTTP 200, status `completed`, and the requested `OK` text. These are
separate probes, not an automatic replay of a tool-bearing request.

The existing opt-in guidance experiment now accepts `PERO_EVAL_API_FORMAT`,
`PERO_EVAL_ALLOW_HTTP=1` and `PERO_EVAL_DISABLE_STREAMING=1`. Responses keeps
provider reasoning defaults instead of sending the Chat Completions thinking
extension. `PERO_EVAL_DEFER_TOOL_LOADING=1` selects the existing deferred tool
profile; its ceiling is 12 steps per sample and 48 requests per four-sample run,
versus six steps and 24 requests for eager tools. Both retain zero retries,
1024 output tokens per request, and independent file/content validation.

The original coder review verifier exposes the same explicit transport options:
`--api-format responses --disable-streaming --allow-http`. It retains the
original workflow, selector, report parsers and source-preservation checks.
Only the existing hash-checked quoted-output hook migration is applied to a
private plugin copy; the original external package is unchanged.

Raw sample metrics, the coder review receipt, source hashes and private-log
hashes are retained in
[the provider evaluation report](../../design-docs/harness-guidance-openapi-evaluation.json).

| Tool profile / guidance | Passed | Requests | Tool calls / errors | Input / output tokens |
| --- | --- | --- | --- | --- |
| Eager / without | 6/6 | 18 | 12 / 0 | 109,868 / 968 |
| Eager / with | 6/6 | 30 | 24 / 0 | 193,870 / 1,200 |
| Deferred / without | 6/6 | 24 | 18 / 0 | 132,254 / 1,034 |
| Deferred / with | 5/6 | 31 | 26 / 0 | 174,017 / 1,163 |

All 24 planned samples ran. The failed deferred sample received provider HTTP
429 before any tool call and wrote no report; it is retained as a failure and
was not retried. The other 23 samples passed independent report and input-file
preservation checks. The deferred test command therefore exits nonzero. The
profiles overlapped with the coder review, and guidance variants used fixed
order; elapsed time is not a controlled performance comparison. These small
fixtures establish successful tool use but no prompt efficiency improvement.

The original coder review passed with 44 actual Responses HTTP attempts and
44 reported completions, one Workflow call and four workflow-member agents.
The unchanged selector chose spec, D9, D8 and D4; original report parsers all
returned pass. The six Python fixture tests passed, tracked source and commit
were unchanged, the selected plugin digest was unchanged during execution, and
the session ended normally with exit 0 and no cleanup failures. This verifies
the original review subflow, not another full development/merge workflow.
Both opus and sonnet aliases explicitly route to `gpt-6.1-sol`.

Verification on macOS arm64: baseline full Go race and vet passed; the affected
native guidance/deferred race tests and vet passed; all 21 Trial tests passed.
The credential remains excluded from Git. No new image/PDF/PTY, desktop,
cross-platform or other-plugin model acceptance is claimed. Earlier Claude
references remain the documented historical extraction, and Workflow helpers
retain their DSH-derived contract; this run does not establish full parity with
the latest Claude Code implementation.

To rerun the opt-in experiment after exporting the local `.env` values:

```sh
PERO_GUIDANCE_EVAL=1 \
PERO_EVAL_ENDPOINT="$OPENAI_BASE_URL" \
PERO_EVAL_MODEL="$OPENAI_MODEL" \
PERO_EVAL_API_KEY="$OPENAI_API_KEY" \
PERO_EVAL_API_FORMAT=responses \
PERO_EVAL_ALLOW_HTTP=1 \
PERO_EVAL_DISABLE_STREAMING=1 \
go -C harness/go test -race ./nativetools \
  -run '^TestNativeGuidanceModelEvaluationOptIn$' -count=3 -v -timeout=15m
```

Add `PERO_EVAL_DEFER_TOOL_LOADING=1` to select the deferred profile. The Go test
does not load `.env` automatically. Run profiles serially when measuring
latency or investigating provider limits; no automatic retry is added.
