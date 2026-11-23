---
name: pero-cua-repl
description: Develop or verify Pero's Browser Use and Computer Use scripting in Electron or macOS Native. Use when changing a REPL, its host integration, or the acceptance flow for either shell.
---

Use the actual shell named in the task and confirm its MCP tools before writing a cell.

| Shell | Development entry | MCP tools | Cell language |
| --- | --- | --- | --- |
| Electron Workbench | `npm run build:desktop`, then `npm start` with the Workbench payload built | `javascript_repl`, `javascript_repl_reset` | JavaScript with top-level await. Use `nodeRepl.write(value)` and `nodeRepl.emitImage(result)`. |
| macOS Native | `npm run build:connectors`, then `npm run dev:native` | `python_repl`, `python_repl_reset` | Python with top-level await. Use `print(value)` and `cua.emit_image(result)`. |

An installed macOS Native package launches its pinned CPython from `Contents/Resources/app/runtime/python`. The Native development build discovers Apple Python through `xcrun --find python3`. Both use the macOS sandbox launcher. Tool discovery comes from the shell, independent of the directory or interpreter used to run a development script.

Both runtimes accept `await cua.browser(request)` and `await cua.computer(request)`. Read the advertised `browser_use` and `computer_use` schemas for arguments. Run actions sequentially, reobserve after each input and use the Host receipt to reconcile an interrupted action. Both runtimes persist bindings in the current ordinary Workbench chat. Reset, timeout, cancellation, and close discard bindings.

For changes, keep runtime selection in Electron Main or the Native connector. Keep CUA calls in the shared Host MCP adapter so tab grants, native action admission and receipts apply per operation. Do not add a second browser or desktop driver in a kernel. Verify state across cells, reset, denied actions and a real page effect through the shell under test. Record which shell and fixture produced the evidence.

Before testing an action, probe the bridge with `nodeRepl.write(await cua.browser({action: "status"}))` in Electron or `print(await cua.browser({"action": "status"}))` in Native.

Run the isolated Chat → ACP/MCP → Browser Use and Computer Use check with `node tests/e2e/cua-repl.mjs` after the Electron build. Run `node tests/e2e/cua-repl.mjs --native` after building the Native binary with the `native-probe` feature and rebuilding the connectors. It uses an actual WKWebView. Set `PERO_NATIVE_REPL_INSTALLED_APP` to run the check against a signed installation with the probe binary and verify the bundled Python path.

On macOS, set `PERO_COMPUTER_NATIVE=1` to extend either run with a background click on the owned AppKit fixture. The fixture independently checks its click counter. This lane requires an existing Computer Use accessibility grant.

For a real Codex run, set `PERO_NATIVE_REPL_REAL_AGENT=1` and `PERO_NATIVE_REPL_INSTALLED_APP`, then run `node tests/e2e/native-repl-agent.mjs`. The signed companion `Pero Computer Use.app` needs macOS Accessibility and Screen Recording access. The test asks the model to read a marker rendered only in the browser screenshot and verifies both fixtures' action effects and the saved images.

For external Chrome, build the extension with `node scripts/build/chrome-extension.mjs` and add `--chrome` to the real Codex test. This mode uses the extension’s pairing and tab approval controls in Chrome for Testing and exercises Browser Use through the same Native REPL. Run `node tests/e2e/chrome-relay.mjs` after the Electron build for the wider deterministic coverage of tab management, history, screenshots and file transfer.
