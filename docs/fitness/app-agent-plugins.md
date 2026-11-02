# App Agent Plugin verification

kind: verification_report

2026-11-02, macOS arm64 development source. This implements
[ADR 0027](../adr/0027-app-agent-plugins.md) independently of Point.

The Rust concept tables cover declaration/grant/tool admission and local package
installation, enabled choices, missing dependencies, package snapshots and
portable MCP paths. The Host/runtime tests cover the existing ACP lifecycle.

`node tests/runtime/app-agent-plugins.mjs` launches the real Host in a disposable
profile and an ACP protocol fixture. It installs an App with an embedded Skill
and MCP dependency, verifies auto-install on enable, checks frozen declaration
and package digests, and observes App instructions/Skill/MCP in ACP requests.
An ordinary session receives none of that App's plugin content. Disabling the
dependency closes its dependent session and prevents a new mount while preserving
the user's disabled choice. No model or remote MCP service is invoked.

`desktop/src/main/app-agent-plugin.test.ts` checks the pure scoped write/budget
concept and the shared loopback MCP adapter: aliases and generic writes share
the limit, undeclared writes fail, changed declarations fail, history replay
cannot recreate a capability, and secondary panels retain their session scope.

Commands:

```sh
node scripts/cargo.mjs test -p pero-runtime -p pero-host -p pero-worker
npm run build:host
node tests/runtime/app-agent-plugins.mjs
node --test desktop/src/main/app-agent-plugin.test.ts desktop/src/main/app-use.test.ts
npm run check
node tests/contracts/apps.mjs
```

These are source/protocol and loopback acceptance. Real-provider behavior,
packaged Desktop distribution, Windows/Linux and remote Worker App sessions
have not been accepted by these checks. No UI surface was added.

## Real built-in Harness integration

`tests/runtime/app-plugin-harness.mjs` runs the production Go `pero-agent-acp`,
Rust Host, shared `DesktopAppUse`/`AppWriteRoutes`, an installed Node App backend
and an installed dependency's HTTP MCP connection. A scripted loopback model
provider drives actual Harness tool calls; no real credential or paid inference
is used. The test checks that App instructions and the dependency Skill reach
the provider, a hidden route is refused, one declared write reaches the backend,
a second generic write shares the alias's exhausted budget, and the dependency
MCP returns its observed citation. Ordinary-session isolation and dependency
disable/failed remount are also checked.

```sh
npm run build:harness
npm run build:host
node tests/runtime/app-plugin-harness.mjs
```

Observed on 2026-11-02/macOS arm64: passed, six provider requests, one backend
write and one dependency MCP call. The report at
`test-results/app-plugin-harness/result.json` includes source/test/binary hashes.
The ACP session defaults to `auto-review`: zero permission requests were observed
despite `--approval ask`. This test does not certify manual approval behavior,
real-model decision quality, or packaged UI acceptance. It exercises the shared
headless shell adapter and real Harness execution.

### Real model and explicit approval (2026-11-02)

The real `deepseek-flash` model passed both explicit `full-access` permission
scenarios through the Go Harness, Rust Host and shared App Use adapter:

| Decision | Agent permission requests | Backend writes | Dependency MCP calls |
| --- | --- | --- | --- |
| `allow_once` | 1 | 1 | 1 |
| `reject_once` | 1 | 0 | 1 |

The denied call finishes as a failed tool result. Both scenarios also check an
ordinary session and reject a new App connection after disabling its dependency.
Only synthetic evidence and temporary App data reach the real provider.

```sh
node tests/runtime/app-plugin-harness.mjs --decision=allow
node tests/runtime/app-plugin-harness.mjs --decision=reject
node tests/runtime/app-plugin-harness.mjs --real --decision=allow
node tests/runtime/app-plugin-harness.mjs --real --decision=reject
```

Real runs use the official endpoint and load the credential from the inherited
environment or the local `.env`; the credential is passed only through process
environment, excluded from the installed package/configuration and report.
Each ACP process has an eight-request ceiling, a 2048-output-token request cap
and no provider retries. Reports are `real-allow.json` and `real-reject.json`
under `test-results/app-plugin-harness/`, including executable and test hashes.

Approval propagation fix: `f64a1181`. This exposed and fixed missing approval propagation: explicit mutating MCP
annotations now become Harness `RequiresApproval` registrations. App data writes
and their aliases declare mutation. Default `auto-review` still proceeds without
a question; an explicit interactive permission mode uses the existing broker.
Legacy unannotated MCP tools retain their existing behavior. An annotation is
not an independent authorization grant or a guarantee about an untrusted server.

Approval replies in these checks are supplied by the test driver acting as the
operator. They exercise real Agent-originated requests and allow/reject responses;
human button clicks, packaged Desktop and arbitrary third-party plugins are not
certified. Go MCP/Harness/ACP race suites, TypeScript and the 30 App Use/SDK cases
also passed.

Observed results: Host/runtime/worker Rust suites passed 152 cases; App Use/SDK
passed 30 cases. An exported committed source snapshot including code through `5e54df15` passed
`npm run check`, the 30 App Use/SDK cases and the plugin Host/ACP wiring test
(using the rebuilt development Host binary). The snapshot reused the existing
Node dependencies, generated reader-Wasm declarations and GPUI icon checkout.

The broader `npm run test:apps:contracts` now passes after the Python recovery
fix in `a1527117`. The strengthened contract covers unchanged explicit bindings,
same-Host repair, restart and real backend/child-interpreter environment selection.
The App plugin, App Agent and Point Agent wiring checks also passed with the
rebuilt Host. The original failure and resolution are recorded in
[the supporting verification note](../issues/2026-11-02-app-plugin-contract-verification.md).
