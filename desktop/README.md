# Pero Desktop

Electron loads the shared GPUI Web/WASM workbench. The isolated renderer has no
Node.js access. A bounded preload bridge connects it to `pero-host --stdio`.
The Rust Host uses the official ACP SDK to supervise one Agent process per live
conversation. Closing the app closes those processes.

## Run

Requirements: Node.js 22.12+, Rust stable and nightly-2026-10-28, and the local
gpui-kit checkout at snapshot `ec89cfc` (0.8.1).

```sh
npm ci
node node_modules/electron/install.js
rustup toolchain install nightly-2026-10-28 --profile minimal --target wasm32-unknown-unknown
export PERO_GPUI_KIT_PATH=/absolute/path/to/gpui-kit
npm run dev
```

Font binaries are generated and ignored by Git. `build:wasm` first reuses
validated fonts from `PERO_FONT_DIR` or the Kit checkout, then cached sources;
missing sources download from checksum-pinned URLs. See
[font preparation](../web/public/fonts/README.md) for offline setup and the
optional cached Python/fontTools toolchain.

The maintainer checkout detects `../../test/gpui-kit` automatically. The Cargo
wrapper patches only Kit packages; matching `gpui-pre-* =0.3.10` snapshots come
from the registry. `/Users/phodal/test/zed` is a source reference, not a second
GPUI dependency. No upstream source is modified.

## Agents and conversations

Choose **New task**, an installed Agent and a workspace. Enter sends;
Shift+Enter inserts a new line. Context adds user-selected text files through a
native file chooser. The Agent and workspace are fixed once connected.

| Agent | Local adapter | Setup |
| --- | --- | --- |
| Codex | Project dependency `@agentclientprotocol/codex-acp` 2.3.0 | `npm ci` installs the official [Codex ACP adapter](https://github.com/agentclientprotocol/codex-acp) and its locked Codex CLI. Authenticate Codex, then select a model offered by the Agent. |
| Claude | Bundled `@agentclientprotocol/claude-agent-acp` | Authenticate Claude using its supported local login. |
| Grok | `opencode acp` | Install OpenCode and configure xAI authentication. The registry selects `xai/grok-code-fast-1`. |

Installed means an adapter executable was found; it does not establish provider
authentication. Advertised Agent login methods are explicit actions. Terminal
login methods are displayed but require login in a terminal. Authentication
does not automatically resend a failed prompt.

The built-in Codex entry uses this project's `node_modules/.bin/codex-acp` and
does not fall back to a global adapter. Run
`node_modules/.bin/codex login` for the installed CLI's supported login flow.

Optional adapters live in ignored `agents.local.json`, or a path supplied with
`PERO_AGENTS_FILE`. Start with [agents.example.json](../agents.example.json).
An entry with an existing ID replaces that built-in entry. `model` is optional;
omit it to retain the Agent's default. Configuration values and credentials are
kept in the native process, never sent in the public Agent list.

Messages retain GPUI Markdown entities. Text deltas are coalesced before document
updates. Tools appear as compact, expandable rows; adjacent read/search/fetch
calls share one summary. Permission requests and failure reasons stay visible.

History is saved in the app's user-data directory (`sessions.jsonl`). Renderer
reload reconstructs live conversations; restarting the app reopens history as
read-only, without automatically resuming or replaying Agent work. Temporary
overrides: `PERO_HISTORY_PATH`, `PERO_SETTINGS_PATH`, `PERO_DESKTOP_DATA_DIR`.

## Verification

Suite map and screenshot paths: [tests/README.md](../tests/README.md). Commands: [fitness](../docs/fitness/README.md).

```sh
npm run check
npm test
npm run test:e2e
# Opt-in: uses the local Codex login and makes one real model request.
npm run test:e2e:real
```

Run desktop tests sequentially because they control native input focus.
See [provider verification](../docs/fitness/acp-provider-verification.md) for
actual Codex/Claude replies and the outstanding Grok authentication check.

The original task overview remains labeled example data. **Remote tasks** is a
separate real Task/Run view backed by the Go service described below. GitHub/PR
publishing, a persistent local Desktop daemon, signed packaging and physical
macOS IME testing remain separate slices. `npm run dev:web` renders the same UI
without the native Agent/remote bridge.

## Remote tasks

The default Task Center is `https://app.openpero.com`. For this service, leave
the URL at its default and enter your project-scoped Pero client token. Existing
saved connections and explicit disconnects retain priority. See the
[deployment runbook](../deployment/task-center/README.md).

Start the [Go control plane](../server/README.md) with PostgreSQL and provision a
project-scoped client token. In Desktop, open **Remote tasks**, enter the service
URL and that token in the connection form, keep **Project client** selected, and
choose **Connect and save**. Use an HTTPS origin; loopback HTTP is allowed for local development.
This is a Pero client token, not a GitHub personal access token. Repository
bindings, provider credentials and optional ROADMAP intake are configured on the
[Go service](../server/README.md#github-issue-intake).

The connection survives an app restart and reopens Remote tasks. URL and access
mode use the runtime-owned preferences; the credential is encrypted by the OS
credential store. If that store is unavailable, unlock or enable it and reconnect.
**Disconnect** persists the disconnected state, including across restarts.
Environment-only setup remains supported with `PERO_CLOUD_URL` plus
`PERO_CLIENT_TOKEN` or `PERO_OPERATOR_TOKEN`. A saved connection takes precedence;
a saved disconnect prevents environment fallback. Client authority never falls
back to an operator token. Credentials are excluded from renderer diagnostics and
the local Host environment.

Open **Remote tasks**. Clients see **Available / Mine / All**, claim an idle Task,
and choose **Execute**. These ownership filters cover loaded pages; **Load more**
extends them. **Issues / ROADMAP** and tag filters run on the service before
pagination. Issue labels and ROADMAP inline tags appear as selectable tag chips;
nested ROADMAP items retain their parent link and heading path.
Only the claim's owner can execute/cancel it or release an idle claim to another
client. These are Pero client identities and claims, not GitHub login or assignee
changes. Provisioning instructions are in the
[server setup](../server/README.md#client-identities-and-shared-tasks).

Operators can **Sync sources** from configured repositories and see their manual
or label-gated automatic dispatch policy. Imported Tasks link to the source Issue
or a commit-pinned ROADMAP line. ROADMAP intake is opt-in and always creates drafts;
Issue auto-dispatch policy does not execute ROADMAP items.
Closed sources block new work; changed sources keep the saved goal frozen and
require the indicated refresh/review step. Independent verification and GitHub
writeback are separate operations.

Operators can also create a draft with its project, allowed workspace key,
Agent ID and completion criteria, then choose **Dispatch**. A provisioned
[independent Worker](../crates/pero-worker/README.md) for that project receives the
Run even if Desktop subsequently closes. Agent choices are identifiers to resolve
on the Worker; local installation does not establish remote availability.

The view polls durable task state and recent events, supports task pagination,
and marks a truncated event tail explicitly. Stop requires confirmation and stays
pending until the Worker acknowledges. `reconcile` prevents redispatch while
execution effects or cleanup remain unknown. Execution completion is distinct
from independent verification and acceptance.

Build and exercise the complete local protocol path:

```sh
npm run build
npm run build:worker
PERO_TEST_DATABASE_URL='postgres://.../pero_test?sslmode=disable' npm run test:remote
```

This launches real Electron, Go, PostgreSQL and a separate Rust Worker using an
ACP fixture. It checks UI create/dispatch/progress/cancel, server restart recovery,
connection errors, language, dark/narrow layouts and credential exclusion. It
does not deploy a service to openpero.com or certify a real model provider.

`PERO_TEST_DATABASE_URL='postgres://.../pero_test?sslmode=disable' npm run test:github`
adds the read-only GitHub fixture, two project-scoped Desktop clients, claim
conflicts/handoff and automatic dispatch to the same real local service/Worker
path. Fixture checks do not establish public GitHub or real-model acceptance.

The connector and saved-connection checks use the existing `npm run build`
outputs. They do not need a Worker or model login:

```sh
npm run test:remote-settings
PERO_TEST_DATABASE_URL='postgres://.../pero_test?sslmode=disable' npm run test:connector
PERO_TEST_DATABASE_URL='postgres://.../pero_test?sslmode=disable' npm run test:connector:live
```

`test:remote-settings` uses real Electron, the OS credential store and Host writes
against a local HTTP fixture; it needs no Go service or database. It checks
encrypted persistence, restart, client authority, disconnect and recovery errors.
`test:connector` needs Go and an isolated PostgreSQL database, then drives the real
Desktop connection form against a local Go service with GitHub/ROADMAP fixtures.
It checks source counts, filters, hierarchy, scoped visibility and restart.
`test:connector:live` uses that same local service and Desktop against read-only
public `phodal/pero` data at `api.github.com`, so outbound access and available
public API quota are required; no GitHub token is needed. Its counts come from
the observed repository snapshot. Both connector tests import without execution
or GitHub writes. These checks verify a local setup; openpero.com has not been
deployed by them.

### GitHub sign-in

In **Tasks → GitHub Connector**, choose **Sign in with GitHub**. The system
browser opens the configured service, completes GitHub login, and asks to connect
Desktop. Choose **Open Pero Desktop** to return. No token copying is required.
The connection is saved through the existing OS-encrypted runtime settings.
The access-token form remains available for operator-provisioned connections.

GitHub sign-in does not assign project or Worker access. An unprovisioned account
connects with an empty scope; the operator must grant its projects. The current
`phodal` GitHub identity is provisioned for project `pero` on app.openpero.com.

For local macOS URL delivery, run `npm run build` then
`npm run build:macos-dev`. Open `target/local/Pero.app` before signing in. This is
an ad-hoc-signed development bundle referencing the checkout; it is not a portable,
notarized distribution. Other OS protocol registration has not been accepted.

Run `npm run test:desktop-login` with an isolated `PERO_TEST_DATABASE_URL` and,
if necessary, `PERO_CHROMIUM_PATH`. It exercises Go/PostgreSQL, a local OAuth
provider fixture, Chromium consent and Electron's native callback event, encrypted
saving, restart, cancellation and wrong/repeated callbacks.
