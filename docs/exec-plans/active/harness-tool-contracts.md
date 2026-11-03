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
| Interactive terminal | Real Open/Read/Write/Resize/Stop on the existing shell owner. Approved startup intent is flushed before launch; live-only exact-agent handles, bounded output/lifetime, observed cancellation and exit. | macOS real process/race tests, including interruption then reopening. Linux/Windows cross-compiled; Linux runtime remains unverified. No Windows or configured-sandbox PTY tools. |
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
Broader model/task evaluation remains product work, along with native Linux PTY
execution and unsupported platform/sandbox capabilities. Monitor/cron/team
remain demand-driven; no placeholder tools are added.
