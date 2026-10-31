# Connectors App verification

2026-10-31. Point source reference:
`b45190a3db725953128b4a8a40e95a287aa9bfd7`; Pero starting revision:
`fbda7c2b7f131821b667cd53bc3b638d9b548a50`.

Final functional revision: `e8c6b0761155ddec303249f5f3bc00451818f698`.
The App/Main were rebuilt and the Desktop check rerun against that revision.

## Scope and ownership

See [ADR 0025](../adr/0025-connectors-app.md). The management feature is a local
Workbench App. The App owns UI; Host owns grants, configuration, secrets and
connections. Existing ACP sessions own Agent execution and permission.

| Point management behavior | Pero implementation and evidence |
| --- | --- |
| Directory, categories, search and launch gates | 110 non-channel provider entries, including 13 documentation-only entries; category/preset tests and actual App search |
| Custom MCP import and structured/JSON editing | Ported editor state and import parser; unit tests plus actual Electron import/save |
| Revision-checked save, enable/disable and remove | Ported control/registry authority; stale revision rejection, restart and disable/remove integration tests |
| Credential references and OAuth | Main-owned encrypted store; no plaintext in registry/App projection; actual Rust OAuth loopback exchange, refresh rotation, reopen and logout |
| Connection test and tool grants | Actual HTTP/stdio drivers; probe release, deny unknown tools, UI remove/restore allowlist and per-conversation fencing |
| Runtime discovery and managed setup | Catalog-owned recipes, pinned executables/helpers, bounded install jobs/records, cancellation and completion cleanup tests |
| Feishu consent and account | Bundled helper and CLI adapter; pinned fake CLI verifies device-code secrecy, attempt binding, rebinding/disposal rejection |
| Agent use | Official MCP SDK client talks to the real loopback adapter and native worker; Rust ACP forwarding and scoped-token tests |

## Checks run

- Baseline `npm run check` passed before editing.
- `npm run check` and Connectors App TypeScript checking passed.
- `node --test apps/connectors/test/*.test.mjs packages/connectors/test/*.test.mjs desktop/src/main/connector-*.test.ts`:
  46 passed, no skipped tests. Includes loopback HTTP/OAuth, real pinned stdio,
  credentials, configuration conflict/restart, cancellation without replay,
  session-token admission and encrypted-store restart.
- `cargo test --locked --manifest-path use/connectors/worker/Cargo.toml`:
  44 passed. Covers fixed provider routes, scopes, pagination, errors, framing,
  registry admission and owned-process reaping.
- `node scripts/cargo.mjs test -p pero-runtime -p pero-contracts`: 62 runtime
  and 47 contract tests passed. The 23 ACP lifecycle tests also passed after
  adding the inherited master-key exclusion.
- `node scripts/cargo.mjs test -p pero-host`: seven passed.
- `node tests/contracts/apps.mjs`: real Host stdio and generated schema passed,
  including permission absent/disabled denial for Connectors.
- Source builds passed for the native connector worker/helpers, App, Rust Host,
  workbench Wasm/Web and Electron Main. Existing Wasm `eval`/unused-method build
  warnings remain; they are not Connector runtime failures.
- `node tests/e2e/connectors.mjs`: actual background Electron + App origin +
  Host + native HTTP driver passed import/save, secret input clearing, verify,
  tool grant removal/restoration, menu Escape/focus return, keyboard tooltip,
  restart/decryption, disable, chat draft composition, en/zh, light/dark and
  1000px window. Screenshots were inspected in
  `test-results/connectors/{catalog-light,detail-light,narrow-dark-zh,detail-narrow-dark-zh}.png`.

All fixtures use temporary profiles and loopback endpoints; the runners close
their children/listeners and remove profile/credential state. The Electron test
uses `--use-mock-keychain` to exercise Electron's encryption API without opening
an OS consent dialog. It does not establish signed-release Keychain behavior.

## Remaining acceptance boundaries

No personal account credentials were used. Live GitHub/GitLab/Linear,
Gmail/Microsoft 365 OAuth, Feishu consent and external scientific runtimes were
not account-accepted. Catalog listing and deterministic protocol tests must not
be reported as verification of all providers. Managed recipes were not used to
download third-party runtimes during tests.

macOS development Desktop was inspected. Linux live Secret Service, Windows
execution, standalone Connectors Product composition, signed/notarized packages
and release/production deployment were not verified in this run. Workbench
package staging includes the driver and bundled helpers; source wiring alone
does not prove an installed release.

## Independent pre-push verification

2026-10-31, macOS arm64 development environment. Rechecked the committed migration
at `a168ef1ff09048339f486662cd0c64c5f639e79f`, independently of the earlier results:

- Repository and App type/contract generation checks passed.
- `npm run test:connectors` rebuilt the local driver/helpers with the isolated
  locked workspace: 46 JS/TS tests and 44 native tests passed, none skipped.
- The repository Cargo wrapper passed 47 contracts, 62 runtime (including ACP
  lifecycle) and seven Host tests. Host build and actual App stdio/schema checks
  passed; the Connectors App and Electron Main were rebuilt.
- Background Electron passed the full Connectors flow with temporary profiles,
  loopback MCP and mock Keychain. The four documented screenshots were inspected.

The remote advanced with the Data App during verification. Merge
`8d140baf5ef09ad5091dee607375f3469fa52175` integrates remote
`61639714` without replacing its changes. Repository checks, Wasm/Web and Desktop
builds, seven Product composition tests and the full background Connectors E2E
passed after that merge. Fresh screenshots confirm the updated Data sidebar and
Connectors surface together. Existing Wasm eval/unused-method warnings remained.

No product or test assertion changes were needed. Test-owned profile/listener
cleanup completed; only the seven local GPUI path-patch source/checksum removals
were restored in Cargo.lock. No personal-account authorization, third-party
runtime installation, real Agent tool execution or release-package acceptance
was performed. The remaining boundaries above still apply.
