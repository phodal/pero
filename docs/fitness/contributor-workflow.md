---
kind: verification_report
date: 2026-10-28
---

# Desktop contributor workflow

Implementation: [ADR 0009](../adr/0009-local-contributions.md).

## Verified source workflow

The new contributor suite uses a fresh OAuth identity with **no private project
scope or assigned Worker**. Public tasks come from the actual Go intake and
publication model, and PostgreSQL owns the claim and PR evidence.

Both the default ACP fixture and the opt-in authenticated Codex run passed:

1. Browser OAuth consent and Desktop code exchange create the new identity.
2. Public GitHub-backed work appears; an unpublished private task and its goal do
   not enter the Desktop snapshot. Actual canvas controls select and claim work.
3. Native folder selection prepares a separate clone and task branch. The
   existing seed checkout remains clean.
4. The existing ACP session writes `CONTRIBUTOR.md` in the prepared checkout.
   In the real-provider run, Codex used actual read, shell and edit tools and
   performed its own document checks; it was not an exact-reply smoke test.
5. The Host reports the real tracked/untracked diff. An edit after review blocks
   publication until a new review.
6. Git creates a real commit and pushes it to an isolated local bare repository.
   A GitHub CLI fixture supplies fork and draft-PR responses.
7. A deliberate first-registration 503 preserves the known PR. Retrying only
   registration stores the exact URL, branch, head SHA and source revision;
   repeated registration creates no second PR.
8. Chinese, dark theme and a narrow window retain the task and recovery actions.

The browser callback is delivered at Electron's native event boundary in this
suite. It does not establish OS URL dispatch or real keychain persistence. The
macOS fixture uses `--use-mock-keychain` and an isolated profile.

Evidence is generated under `test-results/contribution/` and
`test-results/contribution-real/`. The latter's `03-agent-edited.png` shows the
real Codex tools. `result.json` identifies the provider and GitHub fixture
separately. These ignored artifacts contain local test paths and are not releases.

## Regression checks

- `npm run check`: passed, including 390 bilingual catalog entries and generated
  TypeSpec contract drift checks.
- `npm test`: 49 Rust tests passed, including actual local Git contribution tests
  and six Worker process/lease integration tests.
- `go -C server test -race ./...` with required, isolated PostgreSQL: passed.
- `node tests/contracts/host.mjs`: passed; 26/40 event kinds exercised. Missing
  variants are reported explicitly by the existing contract harness.
- Existing `tests/e2e/workbench.mjs`: passed streaming, follow-up, cancellation,
  permission, 1000-chunk exact rendering, scroll retention, replay and themes.
  Stale sidebar coordinates were updated to the inspected current layout.
- Existing tool-call suite: nine tool types passed with no page errors.
- `bazel test --config=ci //:checks`: all seven targets passed after refreshing
  the checked-in npm input cache for the added package scripts.

## Local package acceptance

The final macOS arm64 development package was rebuilt, ad-hoc signed and checked
with deep strict signature verification. Its App was copied outside the checkout
and the contributor end-to-end suite passed from that temporary installation.
The packaging path also mounted its DMG read-only and copied an App for acceptance
before the final GitHub CLI argument correction; the final corrected App was
separately copied and rechecked. The final DMG is 98,992,233 bytes and its SHA-256 is
`8af2531f19a711f8ca18691efab4af09d3f8a86d7a3b9c9a68ab0cba4e5bd079`.
The uncompressed App is 287,358,941 bytes. Both are ignored build artifacts under
`target/package/`. This is the current working-tree candidate, not a public release.

Packaging initially reused an old release contracts artifact without session
settings. Invalidating only that package's release cache restored the build.
The installed GitHub CLI's actual command semantics were also checked against its
matching official source: fork uses the locally resolved upstream with no explicit
repository argument, and PR lookup uses a branch plus author filter. The shared
GitHub CLI fixture and local Git tests pin those arguments.

Native Agent CLIs, Git and authenticated GitHub CLI remain user prerequisites;
GitHub identity login does not grant model authentication or repository
publication credentials. Online delivery is recorded separately below.

The contribution acceptance suites made no live GitHub fork, code push, PR or
merge. PR submission does not claim independent verification, issue closure,
maintainer acceptance or contribution points.

## Online service delivery

The user subsequently authorized deployment and public distribution. The exact
source revision `bf3962acf2f81091b865b3feea24c703a18a8093` is now deployed at
`/opt/openpero/releases/20261028T152323Z-bf3962ac` on app.openpero.com. The existing
deployment saved a pre-migration backup and retained OAuth configuration.

Verified at 23:23:53 Asia/Shanghai:

- HTTPS health and public tasks returned 200; GitHub login redirected correctly.
- Additive migrations 12 and 13 applied; the container had no restarts.
- Startup GitHub sync completed without partial coverage or errors.
- Public sources: 414 (3 Issues and 411 ROADMAP items). Ten manual deployment
  acceptance tasks remained private; total tasks stayed at 424.
- Runs stayed at eleven terminal records (six cancelled, five succeeded). Public
  source reading and publication started no execution.

## GitHub Release delivery

[GitHub Actions run 40720315844](https://github.com/phodal/pero/actions/runs/40720315844)
succeeded and published [v0.1.0-dev.20261028](https://github.com/phodal/pero/releases/tag/v0.1.0-dev.20261028)
at 2026-10-29 00:13 Asia/Shanghai. The public package was built on the macOS 26
Apple Silicon runner from the immutable source tag; the local DMG above was not
uploaded. The installer is an ad-hoc-signed, unnotarized development prerelease.

- CI passed contract/type checks, package contents, arm64 architecture, strict
  signature verification and the DMG size budget.
- The actual packaged Desktop launched with an isolated profile and no service
  override. Both renderer and Host were ready, with default Task Center
  `https://app.openpero.com` and no operator/client token preconfigured.
- Release assets are `Pero-macos-arm64.dmg` (99,407,747 bytes),
  `Pero-macos-arm64.build.json` and `SHA256SUMS`.
- The downloaded public assets passed `shasum -a 256 -c SHA256SUMS`. The build
  metadata identifies source `bf3962acf2f81091b865b3feea24c703a18a8093`, this CI
  run, the online Task Center, arm64 and the pinned GPUI snapshot.
- Public DMG SHA-256:
  `ccc68de5b8f2c6142d26dd0218558f33790044556185d7f16e4cc46c53783dfa`.
- The public DMG was mounted read-only, its App copied to a fresh temporary
  installation and the image detached. Deep strict signature verification and
  the complete contributor suite then passed from that downloaded App, including
  the actual local Git push, stale-review rejection and registration recovery.
  Agent/GitHub seams in this installed-package run were explicit fixtures; the
  separate real-Codex run above proves actual model tool use.
