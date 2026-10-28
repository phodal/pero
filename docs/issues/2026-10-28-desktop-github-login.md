---
kind: feature
status: resolved
---

# GitHub sign-in and Desktop return

## What and why

The deployed Task Center supports browser OAuth but Desktop accepts only a
manually provisioned bearer token. Connecting should open the system browser,
confirm the GitHub identity, and return to the initiating Desktop.

## Scope and authority

- Reuse the community GitHub identity and its existing project-scoped Client.
- Browser consent issues a two-minute, single-use code bound to Desktop's S256
  proof. The fixed `pero://connect/callback` link carries code and state only.
- Exchange creates an independent device credential; credentials are hashed on
  the server and OS-encrypted through the existing Host settings owner locally.
- Login grants no new project or Worker authority. An unprovisioned identity can
  connect with an empty project scope; operator assignment remains explicit.
- Pending login is held in the running Desktop for ten minutes. Restart during
  login requires starting again; a completed saved connection survives restart.
- macOS URL delivery requires an app bundle with CFBundleURLTypes. The local
  development bundle is generated under target/local/Pero.app and ad-hoc signed.
  It is not a distributable, notarized release.

## Findings

The first end-to-end run exposed an interaction between callback navigation and
refresh: opening the tasks page immediately refreshed and cleared sign-in errors.
Callback navigation now changes the view without starting a second request.

## Verification

- Native Go with PostgreSQL and race detector: passed.
- Bazel checks and all four PostgreSQL packages: 11 targets passed.
- Go/PostgreSQL + OAuth fixture + Chromium + Electron integration: passed,
  including consent, wrong state, proof exchange, duplicate callback, cancellation,
  encrypted persistence and restart.
- Existing Desktop credential storage regression: passed.
- Live app.openpero.com OAuth: deployed at server revision a9b9e92; real GitHub
  login identified phodal (GitHub ID 472311), macOS delivered the callback to
  target/local/Pero.app, and application restart restored the identity and tasks.
- phodal was explicitly provisioned for existing project pero. No new Worker or
  real model execution was part of this login acceptance.
- Repeated live callback initially displayed an error after success. The running
  Desktop now ignores its just-completed callback; the database code still cannot
  be redeemed twice. The regression is covered by desktop-login.mjs.
