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

Observed results: Host/runtime/worker Rust suites passed 152 cases; App Use/SDK
passed 30 cases. An exported committed source snapshot including code through `5e54df15` passed
`npm run check`, the 30 App Use/SDK cases and the plugin Host/ACP wiring test
(using the rebuilt development Host binary). The snapshot reused the existing
Node dependencies, generated reader-Wasm declarations and GPUI icon checkout.

The broader existing `tests/contracts/apps.mjs` remains blocked at its Python
environment recovery fixture. The observed rebinding and source comparison are
recorded in [the supporting verification note](../issues/2026-11-02-app-plugin-contract-verification.md).
This failure is not counted as passing plugin acceptance.
