---
kind: verification_report
date: 2026-10-29
---

# Local execution setup and automatic restore

Scope: [canonical local-execution tracker](../issues/2026-10-29-local-worker-onboarding.md)
and [device enrollment](../adr/0010-desktop-worker-enrollment.md).

A fresh profile opens local Projects without an account or a first-run gate.
The sidebar footer is one Settings row. It shows Sign in (登录账户), or the
account name once connected. Choosing that account action opens the existing
connection settings. Restoring a saved account does not replace the local
Projects page with Cloud tasks. After sign-in, enabling
this device still requires an explicit granted Project, workspace key/directory
and installed ACP Agent through execution resources.

The shell persists Cloud/device credentials in OS storage. Local execution uses
a separate Worker identity. A pending enrollment receipt and secret are durable
before the HTTP mutation, so interrupted replies can be reconciled. Returning to
the same account restores only explicitly enabled configuration. Logout or a
changed account suspends intake; returning to the original verified account
restores the saved enabled intent. Explicit Stop or an attention state persists
disabled intent and requires Resume. The Host owns the
managed Worker, progress and bounded shutdown. It does not create another Agent
runtime or replay unknown execution.

The server checks current Client project grants and exact advertised capability
triples before leasing a Run. Local ACP turns and Worker execution share the same
workspace lease. Worker network retries preserve the original claim identity.
Provider authentication/reconciliation requires attention instead of repeated
execution. Unattended permission requests remain denied by the existing Worker.

## Evidence — passed 2026-10-29

- Server tests use isolated PostgreSQL and `go test -race ./...`, including
  lost-reply enrollment, conflicting receipts, credential rotation, owner/scope
  isolation, revoked grants, capability matching and legacy Worker compatibility.
- Host/Worker shell checks use temporary data directories and loopback Cloud;
  actual Worker startup/restart/stop, cold restore, Host EOF/crash cleanup and
  credential exclusions passed in `tests/runtime/local-worker-host.mjs`.
- Electron evidence is in `test-results/local-execution/`: actual scoped enrollment,
  ACP fixture execution, uploaded events and result, OS-encrypted stored record,
  restart without re-enrollment, explicit Stop/Resume/account recovery and
  dark/narrow setup. All 14 checks passed: one enrollment, one completed Run,
  12 uploaded events, zero reported errors.
- Native macOS uses the same public UI with keychain credentials and a separate
  private controller. All 11 native Cloud/device tests passed using an in-memory
  vault and loopback fixtures; they do not read or modify the user's keychain.
- `npm test` passed 73 Rust tests. `npm run check` passed TypeScript, 491 bilingual
  messages, theme and generated-contract checks. Five packaging tests passed;
  native, Host, Worker, Wasm and Desktop development builds succeeded.

## Acceptance boundary

The execution checks are development L0/L1 checks using isolated fixture data.
The approved Cloud rollout below separately verifies the deployed API revision
and migration. No Worker was registered on app.openpero.com and no real
provider/user task was executed during verification. Native secure storage is implemented for macOS; other
native platforms report unavailable, while Electron uses the platform safeStorage
backend. Worker execution remains Unix-only. Signed packages and physical OS
keychain restart acceptance remain separate from compilation/fixture evidence.

## Service compatibility and error recovery — 2026-10-29

Read-only inspection of app.openpero.com found release/source/Docker revision
`ed086f6f40bbf0b7e41880230da897f4ed0b44f8`, without enrollment POST or migration
014. Its existing GET-only Worker route rejects enrollment with a plain-text
405 response. The old Desktop decoded JSON first and hid that status behind a
generic English error. This is a deployed-version mismatch, not invalid local
project or directory input. No real enrollment request was made for diagnosis.

Desktop and Native now preserve safe typed reasons and HTTP status, then render
the reason using the active UI locale. HTML 404/plain-text 405 ask for a server
update; 401 offers account reconnection; scope, conflict, invalid configuration,
temporary service, network and malformed-response failures remain distinct.
Raw server bodies and credentials never become public setup diagnostics.

The actual Electron fixture passed nine enrollment failure cases followed by
recovery: 404, 405, 401, 403, 409, 400, 503, a lost response after server commit,
and invalid JSON with HTTP 200. Every retry retained the same device, request and
secret; one registration and one ACP Run completed with 12 uploaded events and
no renderer errors. Chinese 405 evidence:
`test-results/local-execution/enrollment-405-zh-CN.png`. Fifteen Native flow tests
passed, including HTTP/body classification and typed-receipt validation. The
remote-settings Electron regression and `npm run check` also passed (507 messages
at the final check).

After explicit user approval, release `20261029T075057Z-8b55dd83` deployed the
prepared server revision. Active revision and binary SHA matched the build,
HTTPS health returned 200 and migration 014 plus both empty tables were verified.
A pre-deployment backup was present. This makes the enrollment API available for
the user's saved pending request; verification did not register a real device or
dispatch a task. See the [deployment receipt](task-center-deployment.md).

## Local-first navigation — 2026-11-02

`tests/e2e/local-project-start.mjs` passed against actual Electron with a fresh,
isolated profile and fixture-only Agent configuration. It opened the local
workspace and ROADMAP without credentials or completing onboarding, opened the
existing account settings from the sidebar footer, and restarted without a
login gate. Light, dark and narrow screenshots were inspected under
`test-results/local-project-start/`. Renderer page errors: zero.

Wasm/web builds, `npm run check`, and all 17 `pero-ui` library tests passed.
This verifies the development Electron UI; no installed release was rebuilt,
no real OAuth login was performed, and device enrollment was not changed.
