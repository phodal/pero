# 0044: Protocol harness for a browser client

Date: 2026-11-28

Status: accepted for P0.7 of #256. Leave issue 256 open; reference it only with Refs. Depends on the inventory, the shared dispatch, the capability client, the Paper read, the run projection, and the device-file transfer. It does not choose GPUI Mobile, Capacitor, Tauri, or Expo.

## Decision

The browser slice lives at `web/protocol-harness`. It imports the App SDK modules for capability negotiation, Paper read, run observation, and device pick. It does not import Electron, Capacitor, a Desktop preload, or a backend credential. The page keeps the client token in memory for one submission. The handler serves that page and those four modules on its own origin. The browser then calls the API without a cross-origin preflight. A separate static host is not part of this slice. Each submission mints its own handle, upload, and request id. A retry inside that submission reuses those ids.

The server composition is `ProtocolReadyHandler`. It mounts the existing client route table and then admits only the selected routes: client identity, Paper read, run observation, device-handle registration, and the bounded PDF transfer. Any other path, including the operator route, is refused before a handler runs. The bearer token is the project client named by the conformance corpus. It is not an operator token.

That handler is the harness composition. `server/cmd/server` is unchanged: a nil Paper domain still fails closed, and a nil importer still leaves the device routes unmounted. The harness supplies both for one in-memory owner that stores the Paper bytes and projects one existing control-plane Run through `runlifecycle.Observe`. It does not create a Run, and an effect other than `none` is refused.

`protocol/fixtures/protocol-ready/corpus.json` is the expected behavior for version, dispatch, identity, errors, events, and resource binding. Electron `dispatchEnvelope` and Native `dispatch_envelope` both execute the dispatch cases. The Go handler and the browser session execute the remote cases. A local-only inventory operation is not in `remoteAllow`.

## What this does not do

This slice does not migrate domain REST into capability RPC, add a registry, or add a Task/Run state machine. It does not package a store build. Safari, iPad, and Android Chrome are not claimed from this VM. A later mobile-framework ADR waits on those device columns.
