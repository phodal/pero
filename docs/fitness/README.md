# Quality gates

Remote dispatch is covered by the Worker tests and `tests/e2e/remote.mjs`. The incident note is [2026-10-28 remote worker descendant cleanup](../issues/2026-10-28-remote-worker-descendant-cleanup.md). Use an isolated PostgreSQL database for `PERO_TEST_DATABASE_URL`; `server/` integration tests create and remove isolated schemas. Run the Go suite with `go test -race ./...`.

What each suite proves, and where screenshots land, is [tests/README.md](../../tests/README.md). Acceptance levels L0–L3 are defined in [ROADMAP.md](../ROADMAP.md).

The incremental [Bazel pilot](bazel.md) covers the Go control plane and seven
theme/protocol/locale checks. Its generators write to `bazel-bin`; the existing
npm/Cargo commands below continue to own Rust, GPUI Wasm and Desktop verification.
See [ADR 0004](../adr/0004-incremental-bazel-build.md) for the scope. The explicit
Bazel PostgreSQL suite is manual and uncached, and fails when its database is
not configured. Setup and invocation instructions live in [Bazel quality gates](bazel.md).

1. `npm run build`: native Host, GPUI WASM, web assets, and the Electron shell.
2. `npm run check`: TypeScript, generated DESIGN.md theme, locale catalogs, and generated contracts.
3. `npm test`: Rust tests for `pero-contracts`, `pero-runtime`, `pero-host`, `pero-ui`, and `pero-worker`, including the ACP lifecycle cases in `tests/runtime/`.
4. `npm run test:contracts`: every Host stdio JSONL line against `protocol/generated/host.schema.json`.
5. `npm run test:e2e`: real Electron against the ACP fixture. Workbench session behavior, then the tool-call matrix.
6. `npm run test:i18n`: shared catalogs in real Electron, including live switching, persistence after restart, native menus, and untranslated user content. Source rules are in [locales/README.md](../../locales/README.md).
7. `cd server && go test ./...`: control-plane tests. PostgreSQL cases skip without `PERO_TEST_DATABASE_URL`. See [server/README.md](../../server/README.md).
8. `npm run test:github`: opt-in shared-client flow with a read-only GitHub fixture, real Go/PostgreSQL, two Electron clients and an independent ACP Worker. Requires `PERO_TEST_DATABASE_URL` and the same development builds as `test:remote`.
9. `npm run test:community`: Go/PostgreSQL and Chromium verification of publication, OAuth fixtures, Worker ownership, claims, review/scoring and source changes. Requires `PERO_TEST_DATABASE_URL`; set `PERO_CHROMIUM_PATH` to an installed Chromium executable when Playwright's browser is unavailable.

`npm run test:e2e:real` is opt-in. It uses the local Codex login and sends one real model request. `npm run test:remote` is also opt-in: it needs `PERO_TEST_DATABASE_URL` and runs Electron, Go, PostgreSQL, and `pero-worker` together.

Run Electron suites one at a time; they take native input focus. Chromium IME automation checks composition events. It does not certify a physical macOS input method, a signed package, or real tool execution. The fixture agent emits scripted ACP output and does not read the repository, run commands, or fetch URLs.

Optional Engram long-term memory (default off), its tool policy and the fixture versus real-Engram verification: [engram-memory.md](engram-memory.md).

Current conversation and ACP UI acceptance: [conversation-verification.md](conversation-verification.md). The bootstrap-only boundaries above are historical; actual provider replies and remaining limits are recorded separately.
