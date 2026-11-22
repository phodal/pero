---
name: pero-cua-repl
description: Develop or verify Pero's Browser Use and Computer Use scripting in Electron or macOS Native. Use when changing a REPL, its host integration, or the acceptance flow for either shell.
---

Use the actual shell named in the task and confirm its MCP tools before writing a cell.

| Shell | Development entry | MCP tools | Cell language |
| --- | --- | --- | --- |
| Electron Workbench | `npm run build:desktop`, then `npm start` with the Workbench payload built | `javascript_repl`, `javascript_repl_reset` | JavaScript with top-level await. Use `nodeRepl.write(value)` and `nodeRepl.emitImage(result)`. |
| macOS Native | `npm run build:connectors`, then `npm run dev:native` | `python_repl`, `python_repl_reset` | Python with top-level await. Use `print(value)` and `cua.emit_image(result)`. |

Native discovers Apple Python through `xcrun --find python3` and requires the macOS sandbox launcher. If execution reports that Apple Python is unavailable, check Xcode or Command Line Tools. Tool discovery comes from the shell, independent of the directory or interpreter used to run a development script.

Both runtimes accept `await cua.browser(request)` and `await cua.computer(request)`. Read the advertised `browser_use` and `computer_use` schemas for arguments. Run actions sequentially, reobserve after each input and use the Host receipt to reconcile an interrupted action. Both runtimes persist bindings in the current ordinary Workbench chat. Reset, timeout, cancellation, and close discard bindings.

For changes, keep runtime selection in Electron Main or the Native connector. Keep CUA calls in the shared Host MCP adapter so tab grants, native action admission and receipts apply per operation. Do not add a second browser or desktop driver in a kernel. Verify state across cells, reset, denied actions and a real page effect through the shell under test. Record which shell and fixture produced the evidence.

Before testing an action, probe the bridge with `nodeRepl.write(await cua.browser({action: "status"}))` in Electron or `print(await cua.browser({"action": "status"}))` in Native.

Run the isolated Chat → ACP/MCP → Browser Use and Computer Use check with `node tests/e2e/cua-repl.mjs` after the Electron build. Run `node tests/e2e/cua-repl.mjs --native` after building the Native binary with the `native-probe` feature and rebuilding the connectors. The Native check uses the actual WKWebView and requires Apple Python.

On macOS, set `PERO_COMPUTER_NATIVE=1` to extend either run with a background click on the owned AppKit fixture. The fixture independently checks its click counter. This lane requires an existing Computer Use accessibility grant.
