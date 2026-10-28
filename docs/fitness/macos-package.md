---
kind: verification_report
date: 2026-10-28
---

# macOS arm64 portable development package

This records the original packaging trial. The newer contributor candidate and
its final artifact hash are recorded in [contributor verification](contributor-workflow.md).

The built source is a frozen snapshot of committed master plus this packaging
change. Concurrent, unfinished workbench changes were excluded. The snapshot is
under `target/package-source`; build products are under `target/package`.

| Artifact | Bytes | Decimal MB |
| --- | ---: | ---: |
| `Pero-macos-arm64.dmg` | 98,224,617 | 98.22 |
| `Pero.app` regular files, excluding symlink aliases | 285,586,523 | 285.59 |

The build fails when the DMG reaches 100,000,000 bytes. The App itself is larger
than 100 MB. Neither Codex nor Claude native runtimes are included. Their ACP
adapters initialize successfully using Electron's bundled Node runtime.

Verified:

- Frozen-source `npm run check`: passed, including 266 bilingual messages.
- Rust runtime/Host suite: 13 runtime tests passed.
- Ad-hoc signing and deep strict signature verification: passed.
- Real packaged executable with isolated profile and ACP fixture: Chinese
  composition, streaming, follow-up, cancellation, permission, 1000 chunks,
  reader scroll, reload/history replay, language switching, dark and narrow.
  Zero console errors. Result: `test-results/package/workbench/result.json`.
- Screenshots were inspected for Chinese conversation and code rendering.
- The DMG was mounted read-only, its App copied outside the repository, and its
  deep strict signature checked again. The copied executable reported packaged
  mode, loaded resources from the copied bundle and connected to its bundled
  Host. Evidence: `test-results/package/install.json` and `installed.png`.

DMG SHA-256: `5470cd4ec4906b98afa9d9f8c4dd30ee8c64bc1e6d9cd9869bceb1f98109e882`.

The macOS fixture uses Electron's `--use-mock-keychain` test flag because new
ad-hoc identities can trigger interactive OS keychain prompts. It does not
validate real credential persistence. Normal App launches do not receive that
flag. Real model execution, packaged OAuth return, notarization, physical IME and
other operating systems remain unverified.

An independent native feasibility probe built gpui-kit 0.8.1's official
`hello_world` with `nightly-2026-10-28`. Its binary is approximately 14 MiB and
links macOS system frameworks. This proves the framework has a native build;
it is not a native Pero implementation or product acceptance.
