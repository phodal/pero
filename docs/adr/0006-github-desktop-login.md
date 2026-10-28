# GitHub sign-in and Desktop connection

Status: accepted, 2026-10-28. Extends ADRs 0003 and 0005.

## Decision

GitHub OAuth remains server-owned and uses the existing community identity and
session. Desktop opens the selected service's `/connect/desktop` page in the
system browser. Browser OAuth returns to `/auth/github/callback`, then resumes
Desktop consent. The callback never accepts an arbitrary redirect URL.

The running Desktop owns a ten-minute login attempt: service origin, random
state and a verifier. It sends the S256 challenge to the browser. After explicit
consent, the server issues a two-minute single-use authorization code. The fixed
`pero://connect/callback?code=…&state=…` link carries no bearer token.

Desktop validates the callback against its pending attempt and exchanges code
and verifier over HTTPS at the original service. PostgreSQL serializes consumption
and credential creation. Each device receives an independent hashed credential
for the existing GitHub Client; logging in does not rotate other device tokens.
The Client remains the single owner of project scope. New users start with an
empty scope, and operator provisioning remains separate from login.

The native main process saves the credential using OS encryption and the Host's
runtime settings writer. Renderer snapshots contain connection state and public
identity only. Cancelling sign-in preserves the saved connection. Restarting a
pending attempt requires signing in again; completed credentials survive restart.
A duplicate callback for the just-completed attempt has no further effect.

macOS requires a protocol-declaring app bundle. The local development build lives
at `target/local/Pero.app`, declares `CFBundleURLTypes`, and is ad-hoc signed. It
references this checkout's Desktop source and is not a portable release package.
Windows and Linux native events are wired, but only macOS is accepted here.

## Verification

See [GitHub Desktop login verification](../fitness/github-desktop-login.md).
Protocol references: [GitHub web authorization](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)
and [Electron deep links](https://www.electronjs.org/docs/latest/tutorial/launch-app-from-url-in-another-app).
