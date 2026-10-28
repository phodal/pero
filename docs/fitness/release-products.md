---
kind: verification_report
date: 2026-10-29
---

# Native release products

The release matrix has four independent native jobs:

| Product | Runner | Archive |
| --- | --- | --- |
| Pero | macos-26 / arm64 | Pero-macos-arm64.dmg |
| Pero | windows-2025 / x64 | Pero-windows-x64.zip |
| Pero | ubuntu-24.04 / x64 | Pero-linux-x64.tar.gz |
| Virtual Cell | macos-26 / arm64 | Virtual Cell-macos-arm64.dmg |

Each job verifies source-tag identity and embedded product/platform metadata,
then launches its actual packaged executable from outside the checkout. macOS
also verifies architecture and deep strict ad-hoc signing. The workbench checks
Host readiness and the default `https://app.openpero.com` connection. Virtual
Cell runs its existing full product acceptance, including real bundled Python
computation, restart, language/theme and missing-runtime recovery.

One dependent publication job downloads all four successful artifacts, checks
the combined SHA256SUMS, uploads to a draft prerelease, and publishes only after
all uploads succeed. It refuses to replace an already published release.
Use a new version tag containing the packaging changes; rebuilding an older tag
does not bring newer packaging scripts into that tag.

The offline Product builder receives the runtime explicitly. The release-only
download script pins CPython 3.12.16 from python-build-standalone release 20261026,
including the upstream asset's SHA-256 in `scripts/release/python.json` and the
build metadata. Source: [upstream release](https://github.com/astral-sh/python-build-standalone/releases/tag/20261026).

Local verification and remaining native CI limits are recorded below. This
working-tree change does not publish a release or update the hosted service.

## Observed locally, macOS arm64

- `npm run check`, `npm run test:product` and all Rust suites in `npm test` passed.
- `bazel test --config=ci //:checks`: all seven frozen checks passed. The npm
  repository input hash was regenerated for the new packaging command.
- actionlint and Bash syntax checks passed for the release workflow.
- The exact pinned Python archive downloaded and passed SHA-256 verification.
  `build:product -- --product virtual-cell --python <downloaded runtime> --package`
  produced a 127,524,305-byte DMG; the full `test:product:e2e` passed against it.
- `npm run package:desktop` built the actual Pero App and DMG. The packaged App
  launched outside the checkout with a clean profile, started its Host, registered
  its adapters and reported the default online Task Center without credentials.
- Both packaged ACP adapters returned their versions using Electron's Node
  runtime directly, without Unix wrappers or a separate Node installation.
- Contributor acceptance passed against the packaged App with actual local Git
  cloning, branch creation, ACP file edits, diff review, commit and push to an
  isolated bare repository. GitHub OAuth/PR and the provider remained fixtures.
  The scenario started without a checkout or gh login, exercised missing gh,
  unauthenticated gh, the official help URL, and rechecking after recovery.
- Screenshots of pre-clone guidance, the login warning before review, installation
  recovery and Chinese dark/narrow layout were visually inspected. Evidence is
  under `test-results/contribution/`, `test-results/product/` and
  `test-results/release/local-smoke.json`.

Windows/Linux native packaging and launch remain unobserved until this workflow
runs on those runners. No new CI release has been triggered. macOS signing is
ad-hoc with no notarization; UI and computation checks are not scientific acceptance.
