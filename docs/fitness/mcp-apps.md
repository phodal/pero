---
kind: verification_report
date: 2026-11-13
---

# MCP Apps Runtime and Notebook Inspector

Source: `codex/mcp-apps-conversation`, based on master `7f10d0919`; see the PR commits for the exact changes.
Environment: macOS arm64, Node 26.8.1, existing pinned npm dependencies.
These are local checks; CI configuration is updated but no release result is claimed. Concurrent Data/Paper edits are excluded by the isolated worktree.

## Shared SDK Surface verification — 2026-11-13

The SDK now exports a shared React `McpAppSurface`, standard theme adaptation and
container size policy. The tools/resources panel and its recorded-result route
consume the same Surface; Notebook consumes the shared View theme mapping.
Controls remain in `@pero/app-sdk/ui`, with no generated token changes.

Local macOS/Node 26 checks on the SDK implementation:

- Core TypeScript and MCP asset builds passed.
- Size/theme concept tables passed (5 tests including theme subcases).
- `node scripts/test/mcp-app-sdk.mjs` passed with actual AppBridge, production
  sandbox, two loopback origins and React StrictMode. Class Host methods revoke
  their actual owner; original input/result, one iframe, live size/theme/locale
  changes, retained text fallback and active unmount passed. A failing revoke
  still completes disposal and product dismissal, with its error observed.
- Each fixture resource was fetched once and each Host revoked once. Updating
  size/theme did not reconnect or replay a tool; only the explicitly clicked
  UI tool ran. No unexpected Host or page errors were reported.
- Existing MCP source/session tests passed 14/14. The real Python Notebook
  backend passed with Chromium and Electron after migration to the Surface.
  Python 3.14 and `PYTHONPATH=packages/source-extraction/python` were used.
- Frozen Bazel checks passed 7/7 after the normal lock translation.

Inspected `test-results/mcp-app-sdk/light.png` and `dark-narrow.png` (1100/560px)
and the Notebook browser/Electron images: retained source content, readable
light/dark controls, live locale and no horizontal overflow. SDK failure,
fallback and cleanup receipts are in `test-results/mcp-app-sdk/result.json`.
These generated screenshots/receipts are not committed; CI uploads them in the
existing core-contracts artifact. This section proves the public SDK fixture and
isolated Notebook surface; full conversation acceptance is recorded separately.
Native GPUI graphical and signed-package acceptance are not implied.

### Integrated conversation run with the shared Surface

After rebasing the SDK onto conversation implementation `12daa9347`, rebuilt
Desktop and MCP assets and reran `scripts/test/mcp-official-conversation.mjs`.
The unchanged Host/Harness and Wasm builds from that conversation implementation
were reused. Actual Electron Workbench → Rust Host → Go ACP → upstream 2.0.4
passed automatic mounting, collapse/expand, close/reopen, explicit UI tool call,
live dark/narrow layout, `ui/message` follow-up and session cleanup.

The audit records exactly two `get-time` calls (initial Agent call and one
explicit UI call), two `ask` approvals and three deterministic loopback model
requests. Mounting/reopening did not repeat the initial tool. No real model
provider was called; no renderer errors were reported. Inspected the light and
dark/narrow screenshots in `test-results/mcp-apps-conversation/`; the receipt is
`result.json` in that directory. This validates both product entries using the
shared Surface; it remains separate from Native graphical/package acceptance.

## Official compatibility example

The primary example is the published and unchanged
`@modelcontextprotocol/server-basic-vanillajs@2.0.4`. The acceptance command is:

```sh
npm run test:mcp-official -- --install
```

It installs the exact upstream npm version into generated storage and checks its
integrity. Host SDK dependencies remain pinned. The test launches actual Rust
Host and Go ACP with the official stdio server, uses `McpSessionPanels`, renders
the original upstream HTML verbatim, and checks initial/interactive get-time
results. Both calls receive mandatory `ask` approval: two approvals, zero model
requests. It observes cross-origin DOM denial, light/dark narrow rendering,
frame removal, and graceful shutdown. This managed path creates no second
standalone MCP client. Receipt: `test-results/mcp-apps-official/result.json`;
screenshots: `vanilla-light.png` and `vanilla-dark-narrow.png` in that directory.

Managed views now also advertise text `ui/message`. `ui/update-model-context`,
non-text messages and the demo's logging feature are not advertised.

## Official demo in an actual conversation

```sh
PERO_OFFICIAL_MCP_ROOT=/tmp/pero-official-mcp-app node scripts/test/mcp-official-conversation.mjs
```

After building Web/WASM, Desktop, Host and Harness, this launches the actual
Electron Workbench with Rust Host, Go ACP and the unchanged official package.
The model is a deterministic loopback fixture, **not an external real model**.
The fixture emits a real Agent tool request; a transparent stdio audit counts
actual upstream `tools/call` messages. The npm integrity and exact served HTML
are checked against the published 2.0.4 package.

Observed: the tool result automatically opens inside its conversation without
the tools/resources picker. Tool collapse/expansion retains the same iframe;
closing/reopening restores the original captured timestamp. An explicit
**Get Server Time** dispatches one follow-up tool call through the existing
`ask` approval (both approvals click the actual GPUI **Allow once** control).
The official **Send Message** enters the ordinary Host prompt
owner and produces the next Agent reply in the same conversation. The receipt
records **3 model requests, 2 actual get-time calls, 2 approvals**, with no
additional tool/model call for mounting, expansion or reopening. Session close
removes the surface. Evidence: `test-results/mcp-apps-conversation/result.json`.
Inspected screenshots: `official-inline-light.png` at 1400×1050,
`official-inline-dark-narrow.png` and `official-conversation-followup.png` at
1100×1000 in that directory. Observed: the tool disclosure precedes the embedded
view; theme updates reach the unchanged demo; the follow-up user message and
Agent reply remain in the conversation. No horizontal resource overflow.

This full product run caught and corrected two nesting omissions: Workbench's
`frame-src` needed the loopback panel, and sandbox/resource `frame-ancestors`
needed the trusted conversation origins. It preserves the separate origins and
bound API. The renderer does not relax CSP for arbitrary remote hosts.

## Product path

Rebuild Desktop (`node scripts/build/desktop.mjs`) or the Native connector helpers
(`node scripts/build/connectors.mjs`). Enable Notebook, select an open Pero Agent
conversation and open **session Tools and resources → Notebook Inspector**.
Agent tool calls with a declared UI also open automatically in the tool row.
Use the saved entry ID and optionally a revision; the initial result fixes the
revision used by subsequent block/index/chunk reads. The new view lives at
`ui://pero/notebook/inspector-v1`, on the existing `app_use` MCP server.

The selected conversation can inspect saved content between Agent turns.
Saved-read access never grants idle editing. All other Host tools are model-only
for this MCP resource; interactive calls still pass the existing MCP policy and
App route authority. This is separate from the explicitly configured standalone
provider used by part of the isolated renderer acceptance.

## Observed verification

| Check | Result / scope |
| --- | --- |
| Core CI TypeScript + explicit Inspector TSX check | Passed |
| `node scripts/build/desktop.mjs` | Passed; existing CJS `import.meta` warning in Linux approval code remains |
| `node scripts/build/connectors.mjs` | Passed; builds Native helper and self-contained resource |
| `npm run test:app-use:unit` | 20 Host/core + 12 SDK tests passed |
| Existing MCP sources/session Node suites | Passed, including resource/CSP rejection, approval cancellation, revocation and Unicode body decoding |
| Original MCP call capture/adoption | Go `test -race ./mcp ./harness ./acp` passed; complete input/result/meta, original identity, repeated adoption, wrong session/generation/URI, model-only initial tool and closed receipts |
| Conversation source adapter | Original mount/reopen sends no `tool`/`prepare`; closed/stale messages rejected; invalid prepared/adopted payload revokes remote binding |
| App Product shell and staged provider | 29 tests passed; actual copied provider starts from a foreign working directory and serves panel/JS/CSS/sandbox; no full Product graphical claim |
| Final build/contracts | Web/WASM, Desktop, Host and Native library check passed; 14 MCP contract tests, Host MCP/automation regression checks and 7 frozen Bazel checks passed |
| `node tests/contracts/mcp-session-panel.mjs --browser` | Passed real Rust Host → Node provider → Go ACP → loopback MCP, including the production browser surface, one MCP connection, no model requests |
| `PERO_MCP_BROWSER=1 npm run test:mcp-apps` | Passed actual Python Notebook backend → existing AppWriteRoutes → DesktopAppUse → official MCP client → production sandbox/Runtime in Chromium |
| `PERO_MCP_BROWSER=1 PERO_MCP_RENDERER=electron npm run test:mcp-apps` | Passed same Notebook flow in a real hidden Electron BrowserWindow with sandbox, context isolation and no Node integration |

The Notebook test creates an isolated SQLite store, saves actual revision 1,
updates it to revision 2, and checks that the pinned Inspector continues to show
the original `12.5 U/mL`, while an unpinned read sees revision 2. It reads the
block index and a selected block, and checks read access after `turn_finished`,
rejection of idle writes, selection changes, disabled Notebook, unknown resource
URI, and session close. A write attempt through the resource binding is rejected
before dispatch. It closes the view and observes frame removal. No real model,
user notebook or external service is involved.

The renderer screenshots were actually inspected at light/wide and dark/560px.
Observed: full Chinese title and fixed revision badge, retained original content,
shared controls, source disclosure, readable dark contrast, no horizontal content
overflow, hidden tool form while viewing, and a reachable Close action. The Host surface uses shared controls and no persistent server sidebar or MCP Apps heading. Switching
Host color scheme updates the resource theme via standard Host context.

Evidence (generated, not committed):

- `test-results/notebook-mcp-app/chromium/light.png`
- `test-results/notebook-mcp-app/chromium/dark-narrow.png`
- `test-results/notebook-mcp-app/electron/light.png`
- `test-results/notebook-mcp-app/electron/dark-narrow.png`
- Existing full-chain receipt: `test-results/mcp-session/panel-result.json`.

The new test bundles its TypeScript because Node 26's strip-only loader cannot
load the existing AppWriteRoutes parameter properties; it does not modify that
production route for the test. The view build resolves one React instance for
the Notebook resource and public controls. An initial duplicate-React render
failure was corrected and the actual renderer flow rerun successfully.

## Unverified / remaining work

This is an isolated **Electron MCP resource surface**, not a full Workbench or
Native GPUI Notebook graphical acceptance run. The official upstream example also passes the actual Host/ACP managed-session chain; combining the new Notebook consumer with the
entire GPUI menu in each platform remains separate acceptance. Signed packages,
Windows/Linux Native rendering, physical keyboard/screen-reader use and other
third-party Host interoperability were not tested.

Interactive reopening after process
restart, Task/Run/Artifact binding, notifications from background domain work,
panel/fullscreen modes, writable approval workflows and Data/CI consumers remain
follow-ups. The workspace package is private; no SDK publication or marketplace
installation is claimed. See [the decision](../adr/0036-mcp-apps-host-runtime.md)
and [task record](../exec-plans/2026-11-13-mcp-apps-runtime.md).

## Example and surface corrections

Notebook validates the five actual read shapes at its boundary. Continuations
use the returned target/blockId, so failed reads preserve a valid paging target.
Index/character ranges, retry and return-to-first-part controls retain context.
Basic lists and quotes render as content, while unknown scientific fields remain
available in their original form. Closing prevents late view updates.

Host view cleanup revokes the captured binding on unmount, preserves a newer
view during asynchronous close, and suppresses expected cancellation errors.
Parent and resource themes both follow changes. Resource responses cannot replace
a later source selection. The full managed pending-approval cancellation test
was rerun against these final controls and passed.

The Zed proposal, pinned source comparison and implemented inline identity seam are
recorded in [the conversation design](../design-docs/mcp-apps-conversation.md).

## Draft PR CI follow-up

At PR #217 head `564b804e`, CI exposed two composition omissions: the new
workspace was absent from the Bazel translation inputs/derived lock, and the
Product shutdown test's existing shell-port fake did not export the newly
injected Notebook resource. These were integration failures, not MCP protocol
or scientific backend failures.

The workspace is now declared in both package-manager owners and MODULE data;
Bazel regenerated the pnpm importer and input-hash record. Local
`bazel test --config=ci //:checks` passed all 7 checks with the frozen lock policy.
The existing Product port fake now includes NotebookInspector, with all 7
original shutdown/dispatch assertions passing. No assertion or production
permission was weakened. Updated remote checks must be evaluated on the new
head rather than counting the previous failed run as passing.

## Read-only history — 2026-11-24

Base: master `0fc86a2b`. Reopening a chat or restarting the process restores
the saved tool text, source, and `pero.mcpApp` descriptor. It does not call
the initial tool, send a model request, execute the resource HTML, or admit a
live binding.

Closing the session in the **current** process uses the same sentence. The
row is no longer interactive, so the iframe is removed and the tool row shows
`mcp.history.readonly`. That flag is not the archived-reload flag: `historical`
stays false until the body is loaded from saved history. An archived row sets
`historical`, and `admits_live_binding(true, …)` refuses a live binding even
when a new process reuses the server name and generation. A full replay
(`history` omitted) includes those tool events immediately; every closed
thread in that replay is sealed the same way, so it cannot adopt a live view.
The product startup sends `history: "catalog"`, which defers the tool body
until the conversation is selected.

The Electron test reads `mcpHistory[].notice` and `mcpHistory[].interactive`
from the Workbench diagnostic snapshot. `notice` is `history_notice()`, the
same string the row renders when that row is visible and not interactive. The
receipt stores those read values. It does not embed a second copy of the
sentence or a hardcoded `interactive: false`. Keyboard focus of the notice was
**not verified**.

The Chinese sentence is “历史结果，当前不可交互”. It is not “已关闭”
(`mcp.runtime.closed`).

#234 still returns the archived body only when that conversation is selected.
`1268ff1b` can omit tool images from the ACP projection without dropping the
text or descriptor.

### Local commands

| Command | Result |
| --- | --- |
| `PERO_GPUI_KIT_PATH=… node scripts/cargo.mjs test --locked -p pero-contracts --lib -- i18n session_history mcp_source` | 8 passed, 0 failed, 141 filtered out |
| `go -C harness/go test -race -count=1 -timeout 180s -run 'TestSharedUIResourceStaysOnItsServer\|TestModelInputOmitsUIOnlyMeta\|TestMCPOriginalAppCall\|TestMCPSessionAccessUsesOwnedHTTPConnection' ./harness ./acp` | both packages `ok` |
| `go -C harness/go test -count=1 -v -run` the same filter | `TestMCPOriginalAppCall` (including its four subtests), `TestSharedUIResourceStaysOnItsServer`, `TestModelInputOmitsUIOnlyMeta`, and `TestMCPSessionAccessUsesOwnedHTTPConnection` passed |
| `node scripts/check/locales.mjs` | 1416 bilingual messages checked |
| `xvfb-run -a env PERO_TEST_SOFTWARE_GL=1 node scripts/test/mcp-official-conversation.mjs` | passed, about 42s, after Wasm, `npm run build --workspace @pero/web`, Desktop, Host, and Harness were built |

### Official Electron chain

Unchanged `@modelcontextprotocol/server-basic-vanillajs@2.0.4`, integrity
`sha512-L+IOxLjfX9oAwvnzLAMGX1pwBsIsXUsc9mB5iOTFuQ7lIaejetsrfYngPKwf9ZPHk9iCNVbHHaI7sj5dqax55Q==`.
Actual Electron Workbench → Rust Host → Go ACP, deterministic loopback model,
not an external model. Receipt:
`test-results/mcp-apps-conversation/result.json`.

Before close, the audit has two `get-time` calls (the initial Agent call and
one explicit UI click) and three fixture model requests. After switching the
running Workbench to zh-CN and closing that session, and again after process
restart, the snapshot notice is “历史结果，当前不可交互”, `interactive` is
false, and the call counts stay 2 and 3. No interactive iframe is mounted.
The in-process close keeps `historical` false. The restarted row sets it true
and keeps the original timestamp text and
`Official example · ui://get-time/mcp-app.html`.

Screenshots: `history-closed-same-process-zh.png` and
`history-readonly-zh.png`. Live screenshots from the same run:
`official-inline-light.png`, `official-inline-dark-narrow.png`,
`official-conversation-followup.png`.

Keyboard focus of the historical notice was not verified.

### Notebook Inspector on the tool row

`xvfb-run -a env PERO_TEST_SOFTWARE_GL=1 node scripts/test/mcp-notebook-conversation.mjs`
passed locally. The Agent calls the Host-registered `app__notebook__read-entry`
on `pero-app-use`. `desktop/src/main/notebook-inspector.ts` serves
`ui://pero/notebook/inspector-v1`. `app-write-routes.ts` reads Notebook's
`/api/agent-read`. The saved tool text is 582 bytes, inside that route's
1 MiB response limit. The HTML document is read separately by resource URI and
is not embedded in the tool result. The row shows revision 1 (“Sample A: 12.5
U/mL”) after Notebook has saved revision 2. Browsing blocks adds one pinned
read. Close and reopen do not. After restart the snapshot notice is
“历史结果，当前不可交互”, `interactive` is false, and `historical` is true.
Receipt: `test-results/mcp-notebook-conversation/result.json`. Screenshots:
`notebook-inline-pinned.png`, `notebook-history-closed-zh.png`,
`notebook-history-readonly-zh.png`.

Tool results and other MCP session replies stay at 1 MiB. A resource read may
be 2 MiB. Native GPUI was not launched.

### #218 A–D on this head

| Item | Status | Evidence |
| --- | --- | --- |
| A. Typed result identity through Harness → ACP → tool row | Met | Existing capture plus `TestMCPSessionAccessUsesOwnedHTTPConnection`; the conversation row uses that descriptor |
| A. UI-only `_meta` stays out of the model request | Met | `TestModelInputOmitsUIOnlyMeta` marshals both `GenerateRequest`s and rejects `UI_ONLY_META_9f3c`, `ui://fixture/private-view`, and `bindingToken` |
| B. Mount the saved result in the tool row without `execute` | Met | Official conversation: mount, collapse, expand, close, and reopen keep the initial effect at one call until the explicit UI click |
| C. Reopen or restart restores text, source, and descriptor with no tool or model call | Met | Contract archive test, image-omission projection inside the ACP session test, and the Electron restart above |
| C. No current binding says “历史结果，当前不可交互” and does not restore live interaction | Met | zh-CN screenshot; `admits_live_binding(true, …)` is false even when generation matches |
| C. Live follow-up calls still use the existing approval path | Met | Same run: two `ask` approvals before restart; restart adds none |
| D. Unchanged official 2.0.4 on the full Electron chain | Met | Receipt above |
| D. Notebook Inspector through the same Agent tool-result entry | Met | Real `pero-app-use` / `app__notebook__read-entry` Electron receipt above. The tool result is 582 bytes. The inspector HTML is a separate resource read |
| D. Native GPUI | 未验证 | `scripts/dev/native.mjs` refuses to launch the Native shell outside macOS. This Linux run did not open a Native window. Re-run `node scripts/test/mcp-native-inspector.mjs` on macOS and record usable, degraded, or not interactive. That script exits 2 and is not a pass |

Two servers that declare `ui://shared/view` stay apart:
`TestSharedUIResourceStaysOnItsServer` reads and adopts each server’s own HTML
and result, rejects the crossed adopt, and leaves each effect count at 1.

Linux core stays at a 15 minute timeout. The Wasm, Workbench, Desktop build
and this conversation e2e run only in the `mcp-browser` job, which is skipped
unless that scope is selected. That job’s timeout is 30 minutes. A warm local
path was about 8 minutes (Wasm about 4 minutes, Host about 1.5 minutes, the
conversation about 42 seconds); 30 minutes is the cold-compile ceiling, not a
claim that the job takes that long.

`ui/update-model-context`, Task/Run/Artifact binding, author tooling,
panel/fullscreen, and marketplace distribution stay out of this pass.
