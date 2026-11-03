---
kind: issue
status: resolved
---

# Paper startup rejects the undeclared chat close event

On 2026-11-03, Native verification of the paper-reader integration reached the
App error boundary with `[pero-app-sdk] Event "chat:closed" is not declared.`
The current Paper UI subscribes to this event in `ui-src/index.tsx`, but the
manifest did not declare it. This prevents the entire App from mounting before
any reader interaction. Local Paper/SDK issue notes were searched; none tracked
this missing declaration.

The subscription also ran before asynchronous `/host/sdk` had loaded the
permission context, so a manifest declaration alone did not fix startup.
Wait for that context in the App subscription effect, then let the existing
SDK subscription validate the event.

Declare only `chat:closed` in `permissions.events`. Keep the SDK admission rule
unchanged. Reader rendering does not own Chat event policy. App typecheck and
build pass; Native reopening is checked in the paper-reader verification record.

The preceding Native `frameOrigins` parse failure came from an outdated release
Host selected by the development bundle. Rebuilding the existing Host resolves
that separate build mismatch; no frame-origin or navigation policy was changed.
