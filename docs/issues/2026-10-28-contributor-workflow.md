---
kind: feature
status: implemented
---

# Complete the Desktop contributor workflow

## What and why

A fresh contributor can sign in with GitHub, but the prior Desktop required an
operator-assigned project scope to see work. The task Execute action dispatched
to a separately configured Worker. Local ACP sessions, Git preparation and PR
publication were separate, so downloading the App did not provide a complete
contribution workflow.

## Scope

Follow [ADR 0009](../adr/0009-local-contributions.md): public task discovery and
claim without private project access; dedicated local Git workspace; the existing
ACP session; actual diff review; explicit draft PR publication and evidence
registration. Keep remote Worker coordination and acceptance authorities intact.

## Acceptance

- A new GitHub identity with no project scope can discover and claim published
  work while private Task/Run data remains unavailable.
- The Host prepares an isolated task checkout and branch without changing an
  existing repository. Missing GitHub CLI or model authentication has a visible
  recovery path.
- The existing Agent session modifies that checkout. Review includes actual
  changes, and publication rejects a candidate changed since review.
- Publication creates or finds the draft PR and registers its exact commit and
  source revision. A registration error preserves the known PR for retry.
- Real PostgreSQL, Git and Electron prove the chain using explicit GitHub/model
  fixtures. No fixture result is represented as a live PR or real-model acceptance.
- The macOS development package is rebuilt and checked; public distribution,
  notarization and live service deployment are reported separately.

## Local delivery

Implemented the public contribution API, Host-owned Git workspace/publication,
existing ACP session integration and task PR registration. Default and real Codex
acceptance passed, along with the installed development App, complete Go race
suite using PostgreSQL, Rust regression suite and Host contracts. The final
download artifact is `target/package/Pero-macos-arm64.dmg` (98,992,233 bytes).

Full results and evidence boundaries: [contributor verification](../fitness/contributor-workflow.md).
The user subsequently authorized full delivery and requested CI-built GitHub
Release assets configured for the online service. The service is deployed at
`bf3962ac`; 414 public source tasks are visible, private deployment tasks remain
private, and source reading created no Run.

The initial Release job compiled Rust/Wasm successfully, then failed because the
repository disables npm lifecycle scripts: `npm ci` did not download Electron,
and `Electron.app` was absent. The workflow now explicitly runs Electron's pinned
installer, matching local development setup. Failed jobs also retain their Rust
cache so a later packaging failure does not require another cold compilation.
The same immutable application tag is retried through workflow dispatch; no
failed installer was published.

The corrected macOS 15 job then remained queued while the repository's current
macOS runners started normally. Release builds now use the documented Apple
Silicon macOS 26 image, retaining the architecture, packaged service-origin,
signature and launch checks.

## Public delivery

[Release v0.1.0-dev.20261028](https://github.com/phodal/pero/releases/tag/v0.1.0-dev.20261028)
was published by [GitHub Actions run 40720315844](https://github.com/phodal/pero/actions/runs/40720315844)
at 2026-10-29 00:13 Asia/Shanghai. CI built the immutable application tag,
verified the package and launched its actual Host with the default online
Task Center. The public DMG is 99,407,747 bytes; build metadata and SHA256SUMS
are published beside it. No local build was uploaded.

The downloaded public App passed checksum/signature checks and the full isolated
contributor acceptance suite after installation outside the checkout. The online
service and CI-built development package are delivered. Notarization and real
maintainer acceptance of a contributed PR remain separate from this delivery.
