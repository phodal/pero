# 0040: App SDK capability client and transport port

Date: 2026-11-28

Status: accepted for P0.3 of #256. Depends on [0038](0038-capability-inventory.md) and [0039](0039-capability-dispatch.md). No second App SDK and no remote adapter.

## Decision

`packages/app-sdk/src/capability-client.mjs` is a typed client over an injected transport. `createAppHost` and `HostCapability.call` stay the legacy path. A legacy `hostCall` and this client can perform the same agent status read.

The snapshot carries protocol version, provider generation, availability, an authorization hint, and operation versions. The hint is not a grant.

- `protocolVersion` other than 1 is `incompatible`.
- Availability other than `advertised` is `offline`.
- Authorization `denied` is `denied`. Authorization `consent` is `requires-consent`.
- A missing operation, or a version other than 1, is `unsupported`.
- `ready` is the only outcome that calls the transport. The other outcomes return before any call, so the client does not probe by executing the operation.

`rebind` replaces the snapshot when the provider generation changes. A handle captured before that change throws `revoked` and cannot use the new snapshot. Rebind also drops that generation's frame-correlation waiters, so an unanswered call cannot stay pending. `subscribe` rejects a second registration of the same listener. `dispose` rejects in-flight calls, drops listeners, and rejects correlation waiters.

Correlation ids are namespaced by client, so two clients that share a transport do not collide. `createCorrelation` accepts one reply per id. A second reply for a settled id is `duplicate`. An id that was never requested is `late`. A message without `ok` is `malformed`. If `send()` throws, the waiter is removed and the same id can be retried. `dispose` rejects whatever is still pending.

`createLocalCapabilityTransport` posts JSON to same-origin `/host/capability`. `createFrameTransport` requires a concrete `targetOrigin` and refuses `*`. When it listens, it owns the `message` listener and accepts a reply only when `event.origin` is that origin and `event.source` is the supplied source. A reply that does not arrive within 125000ms, the same bound as `requestAppShell`, fails as `timeout`. The remote adapter is not in this slice.

The browser fixture in the package test renders the agent status string from an injected fetch. That helper is not a public export. The client module imports neither Electron nor a Desktop preload.

## What this does not change

Scoped `AppApi`, parent-frame navigation, and the existing `callAppHost` timeout stay as they are. Shell dispatch remains ADR 0039. Nothing here authorizes a remote route.
