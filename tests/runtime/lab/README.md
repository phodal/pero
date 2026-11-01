# Lab deterministic actual-Host verification (#69)

```sh
node --experimental-transform-types tests/runtime/lab/run.mjs \
  /absolute/path/to/pero-host /absolute/path/to/isolated-python312-venv
```

Requires Node 24+, Linux (owned descendant identity checks), loopback listeners,
and an already prepared CPython 3.12 venv with the exact dependencies in
`apps/lab/app.json`, including **real pylabrobot==0.2.2**. The runner does not
install/download dependencies. It never reads model keys, calls an LLM, starts
hardware/device discovery, or selects a physical backend. It writes private
ignored evidence under `test-results/lab-runtime/fixture-*`.

## Boundary and assertions

- Actual Rust Host stdio lifecycle and installed production Lab Python backend;
  actual `DesktopAppUse` / `AppWriteRoutes` MCP, scripted ACP process from the
  shared `tests/fixtures/lab-acp.mjs`. Only the package HTML is a placeholder.
- An unapproved actual Host session is denied without state changes. A trusted
  headless client supplies a frozen reference to the production goal owner;
  the actual Host `user_message` must activate that exact reference. This is
  **not UI capture, a human approval click, or authenticated human identity**.
- Frozen experiment/budget and typed protocols flow through declared MCP tools.
  Foreign App/experiment probes fail. Real PLR Chatterbox executes two linked
  trials, retaining actual operation receipts and volume-tracker correspondence.
- Full immutable exports independently corroborate fixture outputs: baseline
  FAIL, revision PASS, observed synthetic +0.1 discrepancy, true numerical
  comparison, original assets/hashes, and no human acceptance decision.
- Installed-backend client requests exceed the frozen budget, attempt replay,
  mutate criteria and invoke Agent review; each fails without altering export.
  These HTTP checks are distinct from the ACP tool routing evidence.
- A separate installed-backend trial exercises CSV import with original-byte
  hashing/export. Imported provenance remains imported, not physical evidence.
- Actual Host/backend restart preserves both complete exports including attempt
  IDs, timestamps, receipts and assets; nothing is executed again. Owned Host,
  ACP and Python processes must exit naturally; forced cleanup is failure.

Reports retain source commit/status, executable and manifest/fixture SHA256,
engine version, full exports, tool trajectory and cleanup result. A failure
creates its own evidence directory and is not overwritten by a subsequent pass.

## Local executable provenance / scope

The 2026-11-01 development run uses the pre-existing
`/tmp/pero-independent-host-target/debug/pero-host` (also linked by the older
`pero-research-import-clean` worktree), SHA256
`4481d3178a99c3d1c8849e4e7b68d8e06d6a897ac535c8f94a0702186c1924a4`.
Its depfile points to `/tmp/pero-independent-host-check`, an independently built
reduced Host workspace, **not a fresh current-branch Desktop build**. Current
`crates/pero-host` and `crates/pero-runtime` have no diff against the older
worktree commit `9a3206e34e15377ab253b327afc2e9821ac149c4`; this comparison is
not a reproducible-build attestation. New Lab manifest/backend and production
Desktop TypeScript routing are loaded from this worktree and exercised together.

Local command uses `/tmp/pylabrobot-contract/venv` (3.12.14). Real Desktop/UI,
signed releases, natural model planning, physical accuracy, fluid dynamics and
biological trust are outside this runner. See `tests/e2e/lab.mjs` for the separate
Desktop gate. If loopback binding is denied, record that failure and run in an
authorized CI environment; do not substitute a fake backend or another route.
