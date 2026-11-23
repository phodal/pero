---
kind: verification_report
date: 2026-10-29
---

# Native release products

A version-tag push dispatches this workflow on the default branch, and the
build still checks out the exact supplied tag. This keeps release cache storage
in a reusable branch scope: GitHub does not allow one tag to restore another
tag's caches. Manual releases use `workflow_dispatch` on the default branch.
See [GitHub cache scope](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching).

The release matrix has four independent native jobs:

| Product | Runner | Archive |
| --- | --- | --- |
| Pero | macos-26 / arm64 | Pero-macos-arm64.dmg |
| Pero | windows-2025 / x64 | Pero-windows-x64.zip |
| Pero | ubuntu-24.04 / x64 | Pero-linux-x64.tar.gz |
| Virtual Cell | macos-26 / arm64 | Virtual-Cell-macos-arm64.dmg |

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

The local observations below preceded the public release recorded in the final
section. Publishing the desktop assets did not update the hosted service.

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

Those local trials did not establish Windows/Linux native acceptance. The
subsequent native CI and public-download observations are recorded below. macOS
signing is ad-hoc with no notarization; computation checks are not scientific acceptance.


## Public release and downloaded-package acceptance

Published prerelease: [v0.1.0-dev.20261029.3](https://github.com/phodal/pero/releases/tag/v0.1.0-dev.20261029.3).
Source: `2571af3692d830d39dd9dab9bbf383785062519a`.
[Release run 40790527292](https://github.com/phodal/pero/actions/runs/40790527292)
passed all four native build/launch jobs and publication. This manual run used
workflow snapshot ref `v0.1.0-dev.20261029.2` to reuse its completed cache scope,
but checked out and verified the exact `.3` source tag. Every downloaded build
manifest reports the `.3` tag, source revision and this run URL.

| Public archive | Download bytes |
| --- | ---: |
| Pero-linux-x64.tar.gz | 134,640,224 |
| Pero-macos-arm64.dmg | 98,697,053 |
| Pero-windows-x64.zip | 168,444,898 |
| Virtual-Cell-macos-arm64.dmg | 126,702,625 |

- Downloaded all 13 public assets. Combined SHA256SUMS verified all four archives
  and all four build manifests; manifest archive hashes also matched the bytes.
- Confirmed Windows PE and Linux ELF Host binaries are x86-64. Their actual
  packaged desktop launches passed on their native CI runners. Linux CI used
  the separately verified software WebGL2 path; hardware GPU coverage is not claimed.
- Mounted both public macOS DMGs read-only, copied their Apps out, verified deep
  strict ad-hoc signatures and arm64 executables, and ran the installed copies.
- The downloaded Virtual Cell passed all six product check groups: bundled
  Python computation, simulation, language/theme/narrow layout, restart with
  persisted input, and missing-Python retry recovery. No system Python fallback.
- The downloaded Pero passed the full contributor acceptance with an account
  without project grants or a pre-existing checkout, actual local clone/branch,
  ACP file edits, review, commit/push to a bare fixture, and PR registration recovery.
  Missing/unauthenticated gh and the official help link were exercised. The
  provider and GitHub OAuth/PR remained fixtures; no live PR or model request was sent.
- All nine regular cross-platform CI jobs passed in
  [run 40788990827](https://github.com/phodal/pero/actions/runs/40788990827).
  The native/runtime/desktop source in that CI revision matches the released tag;
  the release tag adds the separately tested graphics and workflow documentation.

GitHub changed space-containing Virtual Cell asset filenames to dots on upload.
Public-download verification caught the resulting checksum-name mismatch. The
published filenames were normalized to `Virtual-Cell`, and build/checksum text
metadata was repaired and downloaded again. The DMG was never rebuilt or
replaced: its original CI SHA-256 remains
`c0caf9f7aad096fc7b88bb22b6cf85a2017efe843f83a192a2eb575b2432f0ee`.
The build manifest retains `ciArchive` for its original CI filename.

The preventive Product.artifactStem change, shared by both packagers and release
metadata, is proposed in [PR #13](https://github.com/phodal/pero/pull/13). Product
naming cases and type/generated checks passed locally. Repackaging the downloaded
CI payload also emitted `Virtual-Cell-macos-arm64.dmg` while preserving the
`Virtual Cell.app` display name. The release remains
usable while that CI/build fix waits for review. Future CI changes use PRs;
this verification PR is not merged automatically.

Local evidence: `target/release-downloads/v0.1.0-dev.20261029.3/download-verification.json`,
`test-results/product/result.json`, `test-results/contribution/result.json` and
corresponding screenshots. The native GPUI developer preview was also rebuilt
and connected locally; its [separate record](native-preview.md) keeps its checkout
dependency and missing cloud/Web App support distinct from the four public archives.


## Local ROADMAP release — 2026-10-29

Published prerelease: [v0.1.0-dev.20261029.6](https://github.com/phodal/pero/releases/tag/v0.1.0-dev.20261029.6).
Source: `65e4e1a83eb639e4694f661a7c6a8fe4d2d26886`.
[Native release run 40845181348](https://github.com/phodal/pero/actions/runs/40845181348)
passed all four native package/launch jobs and publication. The manual workflow
used snapshot ref `v0.1.0-dev.20261029.2` for its existing cache scope while
checking out and verifying the exact `.6` source tag.
[Source CI 40845172163](https://github.com/phodal/pero/actions/runs/40845172163)
passed all nine jobs.

| Public archive | Bytes |
| --- | ---: |
| Pero-macos-arm64.dmg | 103,623,414 |
| Pero-windows-x64.zip | 171,170,269 |
| Pero-linux-x64.tar.gz | 140,564,539 |
| Virtual-Cell-macos-arm64.dmg | 126,880,422 |

The user explicitly approved a 110,000,000-byte Pero macOS download limit. Both
packaging and release verification enforce it; Host and Worker are both bundled
and stripped. The `.4`/`.5` gates prevented publication before source-only
standalone types and the approved package budget were corrected. Those tags
were preserved.

The public release contains 13 assets. Downloaded all four build manifests and
the combined SHA256SUMS: each manifest hash, archive hash reference, release tag,
source revision and build URL matched. The binary archive bytes were checked
by the native publication workflow; this public metadata check did not download
and independently launch all four archives. Local packaged Electron fixture
checks passed streaming, follow-up, cancellation, permission, history reload,
locale, theme and narrow layout; packaged Host/Worker lifecycle checks passed.
The provider remained a fixture. Signing/notarization limitations above remain.

Local public-metadata evidence: `/tmp/pero-roadmap-release/public-6/verification.json`.

## Public package tutorial verification — 2026-11-18

The walkthrough used [v0.1.0-dev.20261112 Electron for macOS arm64](https://github.com/phodal/pero/releases/tag/v0.1.0-dev.20261112) from source `360e7f0ea8f2b5ff7df345dc19f97a2af7dccdc9`. The DMG and build manifest matched the published `SHA256SUMS`. The DMG SHA-256 is `b812b3b8e0a88beb50c69eee27148b562976aebddb82568ae4b30d53185f75c2`. The copied `.app` passed `codesign --verify --deep --strict` and was an arm64 executable.

The actual package ran on macOS 27.2.1. Each walkthrough launched the packaged executable with its own empty Desktop profile and a default managed CPython 3.12 binding within that profile. Electron window automation drove the product controls, selected the public input files, and captured the rendered interface. The App, Host, and storage came from the release. The screenshots use the English interface in both documentation languages.

| Tutorial | Observed result | Where the walkthrough needed care |
| --- | --- | --- |
| Paper | The clean profile could not prepare. After installing the exact-tag required plugin in that profile, the released App prepared successfully, imported the 26-page Meta-Harness v1 PDF, reopened the page 1 highlight and note, and returned results from local full-text search. | The package omits `paper-autoresearch`. See the [open incident](../issues/2026-11-18-paper-release-missing-agent-plugin.md). The first hit for `agentic proposer` was in the references, so the hit's page and surrounding text must be checked. |
| Data | Prepared in a fresh profile. Imported the downloadable six-record, three-field fixture, filtered to source rows 4–6, checked the original source, saved a view, and compared the chart sums `3.0` and `4.2`. Added a seven-row second version, then used the saved view and exported reference to verify that the view still pointed to v1 after restart. | Import opened **Table** directly. The chart used the current matching set, so clearing the filter was necessary to see both groups. **Add version** was next to the version selector. |
| Notebook | Prepared in a fresh profile. Saved `A1=2`, `B1=12` in revision 2 and `A1=3`, `B1=18` in revision 3 with the same formula. Reopened revision 3 after restarting, inspected revision 2, exported JSON and XLSX, and checked the workbook formula. Reimported the JSON as an independent notebook with `3` and `18`. **Ask Agent** prepared a draft for revision 3. | The active floating Chat overlapped the bottom of the File menu during a later export attempt. Close or dock it before opening the menu if the export command is covered. The Agent draft was not sent. |

After recovering Paper, the authenticated Codex integration rejected the first selected model for the test account. A supported model completed the public-PDF question and saved a report with three sections and 13 evidence entries. After restarting, **Research results** opened the report and the first evidence control returned to PDF page 4. The native download flow produced JSON and Markdown. The report still showed **Conclusions not verified**. This was one bounded question on the public sample. Autonomous research and scientific acceptance were outside the walk-through.

Visual evidence and expected results are included in the [Paper](https://openpero.com/docs/paper/), [Data](https://openpero.com/docs/data/), and [Notebook](https://openpero.com/docs/notebook/) tutorial sources. Windows, Linux, Native, upgrade, and Gatekeeper acceptance were outside this run.

## Native CPython REPL, 2026-11-23

The macOS arm64 Native packager uses the existing CPython 3.12.16 pin. It copies
the standalone distribution into `Contents/Resources/app/runtime/python`, signs
the interpreter and dynamic modules, then seals the App. Installed Native
supplies that executable to the connector. The development build continues to
discover Apple Python through `xcrun`. Both run cells through the same macOS
sandbox and Pero Host tool contracts.

The local ad-hoc signed DMG measured 168,091,922 bytes. Both mounted Apps
passed strict signature verification, and the production App passed the
relocated installation smoke with a clean home, a system-only PATH, and an
invalid developer-tools directory. A separately signed copy with the
`native-probe` binary ran the deterministic ACP fixture and returned the exact
bundled `python3.12` path from inside a cell. WebKit authorization, trusted
input, image return, state retention, reset, timeout, and sandbox file/network
refusals passed. The physical test machine still has Xcode installed.

Codex `gpt-5.6-sol` ran the two cells through the packaged ACP adapter. With
the DMG's new companion, WebKit produced one trusted click and the model read
`164EBD` from the returned image. macOS reported Accessibility and Screen
Recording as `not_detected` for that companion and refused window discovery.

A comparison run kept the signed Native probe and bundled CPython, using
the already authorized companion in `~/Applications`. Codex read a new
canvas-only code, the AppKit fixture recorded exactly one background press
and Count=1, and the Host and ACP image bytes matched for one 2360 × 1838
WebKit PNG and two 1200 × 944 AppKit JPEGs. Evidence is in
`target/native-repl-final/native-repl-codex/`. Developer ID signing and
notarization remain separate acceptance conditions.

After operator authentication, both System Settings Add pickers selected the
exact installed copy of the mounted DMG companion. macOS logged a modification
for both services. The restarted companion still reported both permissions as
`not_detected`. The TCC logs identify an existing code requirement with cdhash
`12b7f0f7abbcd057df372a2bf28eda9756ec713f` and the running DMG companion with
cdhash `6eec2581175741ed3f8d0394689f3082952bd8c5` under the same bundle ID.
Codex read the WebKit screenshot marker `D3995F` and stopped at native window
discovery. Desktop input and captures were not attempted. The recorded
session is in `target/native-repl-dmg-permissions/native-repl-codex/`.

With explicit operator approval, the old Screen Recording entry was removed
in System Settings and Accessibility was reset only for
`com.openpero.computer-use`. Both Add pickers then granted access to the
verified DMG companion. Its executable SHA-256 matched the mounted DMG
(`dd7dc8e6f3811db70e1300ef5a8c8f06c312ffd024d9740b40a7446d23b83f3d`).
The newly launched companion reported both permissions granted. In the
signed Native probe, real Codex `gpt-5.6-sol` drove one AppKit background
press, the Host recorded `executed`, and the fixture independently recorded
Count=1. Both 1200 × 944 AppKit JPEGs matched the corresponding ACP payloads
byte for byte by SHA-256. The same run read the WebKit screenshot marker
`1F4032`. Evidence is in `target/native-repl-dmg-grants-verified/native-repl-codex/`.
