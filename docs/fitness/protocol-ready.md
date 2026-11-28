# Protocol Ready harness

Scope: P0.7 of #256. Leave issue 256 open; reference it only with Refs. Baseline for this record is master `02f99dc94534eb695fdad54454bfae6f73bc9138` plus the harness on this branch.

The corpus is `protocol/fixtures/protocol-ready/corpus.json`. Contract checks, loopback execution, and a physical device are separate columns. Emulation is not a device result.

## Matrix

| Operation | Carrier | Platform | Contract | Actual execution | Real device |
| --- | --- | --- | --- | --- | --- |
| version negotiation | SDK snapshot | browser, Electron, Native | corpus `version` | `scripts/ci/protocol-ready.test.mjs` calls `capabilityOutcome` and does not open a transport | NOT_VERIFIED |
| agent status dispatch | local `/host` envelope | Electron | corpus `dispatch` `agent-status` | `dispatchEnvelope` in `desktop/src/main/capability-dispatch.mjs` | NOT_VERIFIED |
| agent status dispatch | local `/host` envelope | Native | same case | `dispatch_envelope` in `crates/pero-ui/src/capability_dispatch.rs` | NOT_VERIFIED |
| agent start | local `/host` envelope | Electron, Native | `agent-start-stays-local`, `remote: false` | both dispatch adapters route it to `/host/app-agent` and the remote allow list does not name it | NOT_VERIFIED |
| unknown operation | local envelope | Electron, Native | `unknown-operation` | both adapters return `unknown_operation` | NOT_VERIFIED |
| scoped login | remote HTTP | browser | corpus `scoped-login` | harness `GET /api/client/v1/me` with the project client token | NOT_VERIFIED |
| Paper read | remote HTTP | browser | `paper-read`, `paper-reopen`, `wrong-project` | harness loopback, and `PersistedPaper` on `server/cmd/server` when `PERO_DATABASE_URL` is set. The id is `rev_…`, owner `pero-paper` | NOT_VERIFIED |
| PDF pick and import | remote HTTP | browser | `pdf-import-once`, `path-handle` | one import per upload; a second finalize returns that revision; the desk drops the bytes after success; cancel during import does not report success | NOT_VERIFIED |
| run observe | remote HTTP | browser | `run-observe`, `run-disconnect`, `run-replay`, `run-gap` | `persistedRuns` reads the existing Run. Non-`none` receipts are database rows and survive a new process | NOT_VERIFIED |
| operator route | remote HTTP | browser | `operator-route`, `missing-token` | absent and unauthenticated | NOT_VERIFIED |

Android Chrome and WebView are the same NOT_VERIFIED column. They are not implied by the Ubuntu loopback run.

## What ran here

- `go -C server test -count=1 ./internal/httpapi -run 'TestProtocolReadyCorpus|TestPaperPDF|TestDeviceRoutes|TestConcurrentFinalize|TestPlaceKeeps'`
- `go -C server test -count=1 ./internal/paperdomain`
- `TestProductionServerKeepsAPaperAndARunReceipt` runs in the existing Postgres job with `TestResearchCampaignTemporal`. It skips when `PERO_TEST_DATABASE_URL` is unset.
- `node --test scripts/ci/protocol-ready.test.mjs`
- `node` under that Go test runs `web/protocol-harness/session.test.mjs` against the live handler
- Native: `cargo test -p pero-ui --lib protocol_ready_corpus_matches_native_dispatch` when the UI crate builds

Normal CI stays the existing `go test` job and `node --test scripts/ci/*.test.mjs`. No new device lane and no timeout change. Physical-device checks stay opt-in.

## Legacy exceptions

Desktop, Native shell, and existing domain Apps may still import Electron or a host bridge for routes that are not in this migrated set. The fitness check covers `web/protocol-harness` and refuses `electron`, `capacitor`, and `preload` there. It does not fail the repository for those older call sites. Insights, connectors, automation, and direct host-agent routes stay on their current shells. `server/cmd/server` now installs `PersistedPaper` when the database is open. A nil importer still leaves the device routes unmounted.

`remoteAllow` is only `paper.read`, `run.observe`, `device.files.pick`, and `device.files.transfer`. Inventory rows marked `local_only` or `privileged`, including `agent/start`, `agent/cancel`, `agent/retry`, `agent/prepare`, `agent/terminal`, and `connectors/secret.set`, are refused as remote grants.

Public SDK names `readPaperResource`, `observeRun`, `interpretDevicePick`, `planDeviceTransfer`, and `capabilityOutcome` stay in `packages/app-sdk/test/contracts/public-exports.json`.

## Gaps

- Safari on iPad, and Android Chrome or WebView, have no physical-device record.
- The production binary mounts device routes when the database is open. A nil importer still leaves them unmounted.
- The production desk drops PDF bytes after a successful import. The in-memory harness owner can still keep its copy. The domain row keeps the bytes.
- A same-digest retry after the handle expires stays follow-up. Cancel overlapping finalize is reserved on the upload and does not report success.
- The SDK still accepts a nonempty `path` that does not contain a slash. The HTTP finalize and handle registration refuse a path field. Native pick refusal of every nonempty path is the Rust contract.
- Version negotiation is the SDK snapshot. The HTTP routes do not carry a second protocol-version field; an unknown route is absent.

## Phodal-Studio

1. Start the production binary, not the harness listener: `PERO_DATABASE_URL=… PERO_OPERATOR_TOKEN=… PERO_PROTOCOL_ROOT=$PWD PERO_LISTEN=0.0.0.0:8787 go -C server run ./cmd/server`. Create a project client and dispatch one Run with the existing task API. On a physical iPad, open `http://<that-machine>:8787/web/protocol-harness/index.html`. Leave Origin as that page. Set Owner to `pero-paper`, Local project to the shared project id, and Run to the dispatched run id. Use the project client token. Submit the fixture PDF, then a different PDF under 32 MiB. The first seeded Paper may be missing; each import returns a `rev_` id, and the second id differs. Confirm `transport_abort` on disconnect and `duplicate` on the repeated request. Restart the binary and repeat the same cancel or approval request id; the stored receipt is the same decision. Confirm no operator token and no `OPTIONS` preflight.
2. Repeat that page on Android Chrome, then in the Android WebView shell if one is installed. Record each as its own row. A desktop Chrome window does not fill either row.
3. On Electron and on the Native shell, dispatch the corpus envelope for `agent-status` and `agent-start-stays-local` through the running shell, not only the unit function. Confirm start stays on `/host/app-agent` and does not appear on the client API.
