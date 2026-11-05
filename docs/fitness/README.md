# Quality gates

Opt-in native Go engineering contracts, acceptance evidence, skills budgets and
memory attribution: [Engineering profile](engineering-profile.md).

Native ACP coding sample, Session usage/failure reports and observed benchmark
procedure limits: [Coding benchmark](coding-benchmark.md).

Five native HumanEval+ tasks without Docker, official controls and token/tool
failure analysis: [Native EvalPlus sample](evalplus-native.md).

Pinned DSH/Pi/Qwen comparison, native tool changes and verification:
[Native coding follow-up](dsh-native-improvements.md).

Historical output clearing, checkpoint provenance, progress/delivery feedback,
environment-owned services and request deadlines:
[Reference runtime improvements](reference-runtime-improvements.md).

Selected old failures, separate service-discovery correction and recorded usage:
[Terminal-Bench runtime reruns](terminal-bench-runtime-rerun.md).

Deferred discovery, output budgets, continuation cursors and Session boundary
measurements: [Tool-call efficiency](tool-call-efficiency.md).

Further task suites, Harbor ACP integration and current execution prerequisites:
[Coding benchmark candidates](coding-benchmark-candidates.md).

First Harbor ACP execution, official failure verdict and reviewed Session:
[Terminal-Bench cancellation smoke run](terminal-bench-smoke.md).

All 89 tasks, uncapped request configuration and current execution evidence:
[Terminal-Bench full-suite run](terminal-bench-full.md).

Failure evidence, repair boundaries and the verified turn-entry correction:
[Terminal-Bench failure repair review](terminal-bench-failure-repair-review.md).

Local environment creation, dependency installation and App-wide runtime binding:
[Local environment preparation](local-environment-preparation.md).

AI4S environment values, matching and read-only Control Lab / PC-Gym observations;
managed execution admission remains planned: [Environments P1](ai4s-environments.md).

Host-backed Environments App and scoped Paper/Control Lab inspector:
[Environments UI](environments-ui.md).

ReFrame benchmark library, local numerical references and separate Slurm/OpenFOAM
acceptance: [HPC Benchmarks](hpc.md).

Global appearance, scoped typography and current Settings shell limits:
[appearance](appearance.md).

Independent App Agent Plugin declarations, local dependencies and scoped ACP
assembly: [App Agent Plugins](app-agent-plugins.md).

Remote dispatch is covered by the Worker tests and `tests/e2e/remote.mjs`. The incident note is [2026-10-28 remote worker descendant cleanup](../issues/2026-10-28-remote-worker-descendant-cleanup.md). Use an isolated PostgreSQL database for `PERO_TEST_DATABASE_URL`; `server/` integration tests create and remove isolated schemas. Run the Go suite with `go test -race ./...`.

What each suite proves, and where screenshots land, is [tests/README.md](../../tests/README.md). Planned features are in [ROADMAP.md](../../ROADMAP.md).

The pushed GitHub/ROADMAP connector's public-source and Desktop acceptance is
recorded in [github-connector-verification.md](github-connector-verification.md).

Native release matrix, package checks and observed platform limits:
[release products](release-products.md).

The incremental [Bazel pilot](bazel.md) covers the Go control plane and seven
theme/protocol/locale checks. Its generators write to `bazel-bin`; the existing
npm/Cargo commands below continue to own Rust, GPUI Wasm and Desktop verification.
See [ADR 0004](../adr/0004-incremental-bazel-build.md) for the scope. The explicit
Bazel PostgreSQL suite is manual and uncached, and fails when its database is
not configured. Setup and invocation instructions live in [Bazel quality gates](bazel.md).

1. `npm run build`: native Host, GPUI WASM, web assets, and the Electron shell.
2. `npm run check`: TypeScript, generated DESIGN.md theme, locale catalogs, and generated contracts.
3. `npm test`: Rust tests for `pero-contracts`, `pero-runtime`, `pero-host`, `pero-chat-ui`, `pero-chat-web`, `pero-ui`, and `pero-worker`, including the ACP lifecycle cases in `tests/runtime/`.
4. `npm run test:contracts`: every Host stdio JSONL line against the Host and Computer Use extension schemas.
5. `npm run test:e2e`: real Electron against the ACP fixture. Workbench session behavior, then the tool-call matrix.
6. `npm run test:i18n`: shared catalogs in real Electron, including live switching, persistence after restart, native menus, and untranslated user content. Source rules are in [locales/README.md](../../locales/README.md).
7. `cd server && go test ./...`: control-plane tests. PostgreSQL cases skip without `PERO_TEST_DATABASE_URL`. See [server/README.md](../../server/README.md).
8. `npm run test:github`: opt-in shared-client flow with a read-only GitHub fixture, real Go/PostgreSQL, two Electron clients and an independent ACP Worker. Requires `PERO_TEST_DATABASE_URL` and the same development builds as `test:remote`.
9. `npm run test:community`: Go/PostgreSQL and Chromium verification of publication, OAuth fixtures, Worker ownership, claims, review/scoring and source changes. Requires `PERO_TEST_DATABASE_URL`; set `PERO_CHROMIUM_PATH` to an installed Chromium executable when Playwright's browser is unavailable.
10. `npm run test:connector`: actual Desktop connection form and restart against a local Go/PostgreSQL service with read-only Issue/ROADMAP fixtures. Checks project scope, source counts, pagination, tags, hierarchy and checked-source gates. Requires Go, `PERO_TEST_DATABASE_URL`, the existing `npm run build` outputs and an available OS credential store. It does not start an Agent or Worker.
11. `npm run test:connector:live`: the same local connector path with public `phodal/pero` data from `api.github.com`. Requires the connector prerequisites plus outbound HTTPS and available public API quota; no GitHub token or model login is needed. Source counts are checked against the observed snapshot. It imports without task execution or GitHub writes.
12. `npm run test:remote-settings`: real Electron safeStorage and runtime-owned Host preference writes against a local HTTP fixture. Checks encrypted persistence, restart, explicit client authority, disconnect, unavailable-storage recovery and credential exclusion. Requires the existing `npm run build` outputs and OS credential store; no Go, PostgreSQL, Worker or model login is needed.
13. `npm run test:contribution`: new OAuth identity with no project grant, published GitHub task discovery/claim, native folder selection, actual local ACP file changes, Git diff review, commit/push to an isolated bare repository, draft PR fixture and failed-registration recovery. Requires PostgreSQL and current builds. `PERO_CONTRIBUTION_REAL_AGENT=1` opts into authenticated Codex with actual tools; GitHub publication remains a fixture. See [contributor acceptance](contributor-workflow.md).

`npm run test:e2e:real` is opt-in. It uses the local Codex login and sends one real model request. `npm run test:remote` is also opt-in: it needs `PERO_TEST_DATABASE_URL` and runs Electron, Go, PostgreSQL, and `pero-worker` together.

Run Electron suites one at a time. They use hidden real Electron windows by default;
`PERO_TEST_HEADED=1` opts into foreground acceptance. Linux still requires X11/Xvfb;
the CI desktop job runs workbench, tool-call and native App Use suites in a separate Xvfb display.
See [background test setup](../../tests/README.md#后台桌面测试). Chromium IME automation checks composition events. It does not certify a physical macOS input method, a signed package, or real tool execution. The ordinary fixture agent emits scripted ACP output without executing commands. Its explicit contribution scenario writes a file only in the disposable prepared checkout; the real-provider contribution mode uses actual Codex tools.

Connector screenshots/results are in `test-results/connector/fixture/` and
`test-results/connector/live/`; saved-connection evidence is in
`test-results/remote-settings/`. The service remains local in both connector modes:
these checks do not deploy openpero.com. Desktop connection setup is in
[desktop/README.md](../../desktop/README.md#remote-tasks); repository and ROADMAP
configuration is in [server/README.md](../../server/README.md#github-issue-intake).

First-run connection and local execution: [local-execution.md](local-execution.md).

Local workspace ROADMAP loading and ACP execution: [local-roadmap.md](local-roadmap.md).

MCP 「工具与资源」 acceptance progress, with the ROADMAP checkbox still open: [mcp-tools-resources.md](mcp-tools-resources.md).

Current conversation and ACP UI acceptance: [conversation-verification.md](conversation-verification.md). The bootstrap-only boundaries above are historical; actual provider replies and remaining limits are recorded separately.

Shared GPUI App Chat, Workbench scope switching and optional standalone Product
chat: [app-chat.md](app-chat.md). This record tracks source checks, actual
Electron behavior, package size and platform acceptance separately. The
`virtual-cell-chat` development Product uses system Python and `chat: true`;
its results do not extend the existing Virtual Cell release acceptance.

## Acceptance levels

| Level | Evidence |
| --- | --- |
| L0 | Compilation, unit tests and contract checks pass. |
| L1 | A development build runs in actual Desktop with an Agent fixture. |
| L2 | The flow runs against a real provider, environment or external service. |
| L3 | A signed release package installs, upgrades and runs on the target system. |

Record the source version, level, date, target system and remaining gaps in the relevant verification record before marking a feature complete. A checked source item is separate from Run verification and acceptance.

Workspace content tabs, shared Chat layout, semantic icons and current Desktop
acceptance: [workspace.md](workspace.md).

Workspace navigation ownership and pure layout refactor:
[workspace-architecture.md](workspace-architecture.md).

Agent → App tools, task grants and panel evidence: [App Use](app-use.md).

External Computer Use v1 types and pure admission (L0, no native driver):
[Computer Use contract](computer-use.md).

Automatic ACP Agent preparation, draft preservation and external login: [Agent preparation](agent-preparation.md).

Reasoning, tool input/results and ACP session title replay:
[streaming presentation](streaming-presentation.md).

The opt-in trusted Kubernetes Worker runtime and its separate fake-API,
PostgreSQL, process and cluster evidence are tracked in
[Agent Sandbox verification](agent-sandbox-runtime.md).

Retained generic HTTP(S) Web sources, isolated Electron and native Wry engine
acceptance: [web-documents.md](web-documents.md).

Single-session Paper research, source recall, evidence gaps and explicit
continuation: [Paper research Agent](paper-research-agent.md).

Public literature search, source metadata and thumbnails: [Paper search](paper-search.md).

Single-row reading controls, approved-source TeX compilation and Native/browser
verification: [Paper reading views](paper-reading-views.md).



Pinned Harness/DSH capability comparison, deterministic Skill compaction evidence
and remaining gaps: [Harness behavior parity](harness-behavior-parity.md).

Local research goals, Overview and links to App-owned records: [research Projects](research-projects.md).

Independent scientific HTML reader package and Paper integration: [Paper reader](paper-reader.md).

- [Validation-driven coding recovery](validation-driven-coding.md): diagnostic evidence, reproducible profiles, atomic edits and offline recovery-window accounting.
