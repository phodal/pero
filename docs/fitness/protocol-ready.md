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
| Paper read | remote HTTP | browser | `paper-read`, `paper-reopen`, `wrong-project` | `readPaperResource` against `ProtocolReadyHandler` | NOT_VERIFIED |
| PDF pick and import | remote HTTP | browser | `pdf-import-once`, `path-handle` | SDK pick, handle registration,  raw upload, one domain import, second finalize returns the same Paper id | NOT_VERIFIED |
| run observe | remote HTTP | browser | `run-observe`, `run-disconnect`, `run-replay`, `run-gap` | existing Run projection; disconnect is `transport_abort`; the same request id returns `duplicate` and effect `none` | NOT_VERIFIED |
| operator route | remote HTTP | browser | `operator-route`, `missing-token` | absent and unauthenticated | NOT_VERIFIED |

Android Chrome and WebView are the same NOT_VERIFIED column. They are not implied by the Ubuntu loopback run.

## What ran here

- `go -C server test -count=1 ./internal/httpapi -run 'TestProtocolReadyCorpus|TestPaperPDF|TestDeviceRoutes'`
- `node --test scripts/ci/protocol-ready.test.mjs`
- `node` under that Go test runs `web/protocol-harness/session.test.mjs` against the live handler
- Native: `cargo test -p pero-ui --lib protocol_ready_corpus_matches_native_dispatch` when the UI crate builds

Normal CI stays the existing `go test` job and `node --test scripts/ci/*.test.mjs`. No new device lane and no timeout change. Physical-device checks stay opt-in.

## Legacy exceptions

Desktop, Native shell, and existing domain Apps may still import Electron or a host bridge for routes that are not in this migrated set. The fitness check covers `web/protocol-harness` and refuses `electron`, `capacitor`, and `preload` there. It does not fail the repository for those older call sites. Insights, connectors, automation, and direct host-agent routes stay on their current shells. `server/cmd/server` still has no Paper domain and no importer, so production device routes stay unmounted.

`remoteAllow` is only `paper.read`, `run.observe`, `device.files.pick`, and `device.files.transfer`. Inventory rows marked `local_only` or `privileged`, including `agent/start`, `agent/cancel`, `agent/retry`, `agent/prepare`, `agent/terminal`, and `connectors/secret.set`, are refused as remote grants.

Public SDK names `readPaperResource`, `observeRun`, `interpretDevicePick`, `planDeviceTransfer`, and `capabilityOutcome` stay in `packages/app-sdk/test/contracts/public-exports.json`.

## Gaps

- Safari on iPad, and Android Chrome or WebView, have no physical-device record.
- Production still does not register picks or mount device routes until a composition root supplies an importer. The harness is that composition for the slice.
- The in-memory desk can still retain PDF bytes after a successful import. The domain copy is what the reopen reads.
- A cancel that overlaps finalize, and a same-digest retry after the handle expires, stay follow-up. This slice does not add that lock.
- The SDK still accepts a nonempty `path` that does not contain a slash. The HTTP finalize and handle registration refuse a path field. Native pick refusal of every nonempty path is the Rust contract.
- Version negotiation is the SDK snapshot. The HTTP routes do not carry a second protocol-version field; an unknown route is absent.

## Phodal-Studio

1. On a machine that has this repo, hold the harness open with `PROTOCOL_READY_LISTEN=1 go -C server test -count=1 -timeout 30m -run TestProtocolReadyListen ./internal/httpapi`. It listens on every interface and prints a port. On a physical iPad, open `http://<that-machine>:<port>/web/protocol-harness/index.html`. The page and the API are that same origin. Do not open the HTML from a second static server. Leave Origin as the page origin. Use the printed project client token. Submit without choosing a file, then again with a different PDF under 32 MiB. Confirm each submission shows role `client`, the seeded digest, its own Paper id, `observed`, `transport_abort`, and `duplicate`. The second Paper id differs from the first. Confirm the network log has no operator token, no `OPTIONS` preflight, and no request outside the page, the four SDK modules, `/api/client/v1/me`, and `/api/client/v1/projects/lab/`.
2. Repeat that page on Android Chrome, then in the Android WebView shell if one is installed. Record each as its own row. A desktop Chrome window does not fill either row.
3. On Electron and on the Native shell, dispatch the corpus envelope for `agent-status` and `agent-start-stays-local` through the running shell, not only the unit function. Confirm start stays on `/host/app-agent` and does not appear on the client API.
