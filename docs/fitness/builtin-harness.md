---
kind: verification_report
date: 2026-10-30
---

# Built-in DeepSeek harness

Desktop registers `harness/go/cmd/pero-agent-acp` as `pero`, first in the built-in
registry. Saved `chat_agent` preferences still win. The Agent launches a compiled
Go executable, with the chosen conversation workspace, ACP approval, native file
tools, Unix shell, workspace instructions and todos. The generic explicit
`{workspace}` argument is resolved at session launch. User configuration may
replace any registered Agent as before.

The full development build includes `build:harness`; shared adapter staging
builds the native binary into Workbench and chat-enabled Product payloads.
`npm start` reuses existing builds. Desktop preparation performs no model API
request, dynamic model discovery, dependency installation or compilation.

Development reads the checkout `.env`. Packaged Workbench and App Products read
user-data `.env`; `PERO_ENV_FILE` overrides the location. Only DeepSeek key, URL
and model values are forwarded; process variables take precedence. The local
Point `.env` was copied with mode 0600; it remains Git-ignored and is never staged
in a distribution. A safe `.env.example` documents supported variables.

## Evidence

L2: `DEEPSEEK_REAL_API=1 node tests/e2e/builtin-harness.mjs` passed real Electron →
Rust Host → Go harness → DeepSeek. A fresh isolated profile selected `pero`,
prepared with no messages and returned exactly `PERO_HARNESS_OK` after the user's
prompt. No renderer errors. The observed local development run took 758 ms from
Electron launch to Host readiness and 219 ms from New chat to session readiness;
these are single-run observations including polling/rendering, not a latency SLA.
A subsequent readiness-only run passed at 866 ms Host / 192 ms session after
rebuilding the local Host executable. Its registry was checked directly to
contain the available `pero` entry first. Light/dark and the supported narrow
Desktop window are captured under
`test-results/builtin-harness/`. The suite without the opt-in performs preparation
and screenshots only, without a model prompt.

L0: provider-env tests (including quoted dotenv, exported/empty override and
unrelated credential exclusion), `npm run check`, 53 Rust runtime/Host tests,
Go race tests for `./cmd/pero-agent-acp ./acp`, Workbench web payload test, and a
native harness build into a disposable package-like `bin/` directory passed.

The broader `agent-preparation.mjs` fixture regression did not pass: its fixed
Agent-picker click missed the current controls at the second switch. A local
coordinate adjustment progressed to the authentication click, which also failed
to activate. That adjustment was removed; the fixture now explicitly disables
`pero` alongside other real providers. No full fixture-regression pass is claimed.

No signed release package, Windows shell, installed Desktop upgrade, or native
GPUI preview acceptance is claimed. Production deployment is unchanged.

## Settings interface (2026-10-30)

Workbench Settings includes a searchable Built-in Agent section with API URL,
model and a masked API Key field. Blank key preserves the configured credential;
removal requires a second click. Saving encrypts the key with Electron safeStorage
and writes ciphertext through Host runtime settings, preserving other settings.
Saved configuration overrides dotenv/process defaults and updates the registered
Agent for new conversations immediately. Live sessions keep their configuration.
No stored or environment key is sent back to the renderer; diagnostics omit the
key editor's value. Deleting a saved key persists an explicit empty credential.

L1: `node tests/e2e/harness-settings.mjs` drove actual GPUI inputs and keyboard
Save in background Electron. It verified encrypted persistence, unrelated setting
retention, invalid HTTP endpoint rejection, restart restoration and a new real
Go harness request against a loopback OpenAI-compatible fixture with the saved
model and credential. It also verified two-click key removal and restart without dotenv fallback.
It captured light, dark, narrow and error states with zero
renderer errors. This is actual Desktop/Host/harness wiring with a fixture model
endpoint; the earlier DeepSeek reply above is the separate real-provider lane.
Evidence: `test-results/harness-settings/`.

L0: TypeScript/theme/locale/contracts checks, provider configuration table tests,
Host/runtime/contracts Rust tests, settings persistence regression and native
GPUI compilation passed. The new interface is on the Electron Workbench path;
native GPUI preview and standalone App Products have no credential editor.

## Integration review (2026-10-30)

Reviewed on top of master `034f36d2`. The settings module now uses the same
Wasm/native feature gate as the other UI modules; without it, ordinary
`npm test` cannot compile the crate. The integration also excludes the generated
GPUI cache from the parent Cargo workspace and refreshes the standalone
Computer Use lock for the existing shared-contract dependencies.

Current verification passed: `npm test`, `npm run check`, Host, Harness,
Computer Use, Wasm, web and Desktop development builds, provider configuration
and Workbench payload tests, Go race tests for `./cmd/pero-agent-acp ./acp`, and
all 23 Paper Agent Python tests with their declared PDF dependencies.
Host protocol conformance and all seven frozen Bazel generated checks pass.
`harness-settings.mjs` passed again with encrypted save, invalid-endpoint
recovery, loopback model request, restart and key removal; its light/dark,
narrow and error screenshots were inspected. `builtin-harness.mjs` passed
readiness without a model prompt and with zero renderer errors.

The broader preparation fixture was rerun and still fails at its fixed-coordinate
second Agent switch (`fast` remains selected instead of `codex`). No full
preparation-fixture pass or new real-provider/release acceptance is claimed.
