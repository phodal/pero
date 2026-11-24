# macOS Computer Use capability acceptance

2026-10-30, macOS 27.0.1, arm64. These are owned GUI application checks through
the actual Rust worker and Desktop transport, with independent application state.
They do not certify arbitrary third-party workflows or another macOS/CPU version.

| Lane | Result |
| --- | --- |
| Generated TypeSpec/JSON Schema/TypeScript + Rust corpus | Pass; old inputs and new finite action/value/selector/observation values |
| Native workspace unit tests and Clippy | Pass |
| Windows cross-check; Linux cross-check/Clippy | Pass; no new native OS feature advertised there |
| Source-only isolated build | Pass with Point network access denied and no checkout/cache |
| Original AppKit native suite, foreground enabled | Pass: AX/pixel click, Unicode insertion, selection chord, scroll, drag, durable/stale receipts, stop/restart |
| Extended AppKit suite, foreground enabled | Pass, 32 receipts: 18 button/count/delivery combinations, value replacement/clear, disabled/read-only refusal, finite semantic action, subtree renewal, secure suppression, hover, explicit focus, pixel cursor move, object displacement, same-PID overlay, moved-window refusal, timed/cancelled hold |
| SwiftUI native AX | Semantic button effect, Unicode control value replacement and clear pass |
| Electron native AX | Semantic button effect, Unicode DOM input value replacement and clear pass |
| Signed/notarized release; macOS 13; Intel; multiple displays | Not run |

```sh
node scripts/build/computer.mjs --test
node scripts/build/computer.mjs
node tests/contracts/computer-use.mjs
node tests/e2e/computer-transport.mjs
node tests/build/computer-source.mjs
PERO_COMPUTER_NATIVE=1 PERO_COMPUTER_FOREGROUND=1 node tests/e2e/computer-native.mjs
PERO_COMPUTER_NATIVE=1 PERO_COMPUTER_FOREGROUND=1 node tests/e2e/computer-macos.mjs
PERO_COMPUTER_NATIVE=1 node tests/e2e/computer-frameworks.mjs
```

The extended suite defaults to background-only input. Foreground opt-in also
checks real pointer movement and same-process overlay refusal. Early attempts
encountered WindowManager thumbnail layouts and correctly refused foreground
coordinates; after leaving window overview the complete foreground lane passed.
The native geometry now comes from AX, and capture resolution from the SC filter's
content rectangle. No user window-management setting was changed.

The drag fixture moves a rectangle from `(30,70)` to `(110,110)`; callback counts
alone are insufficient. The same-PID overlay receives zero clicks. Cancellation
waits for a real button-down effect, closes the connection during a ten-second
hold, verifies button-up before process exit and preserves an unknown receipt.
The short hold independently checks at least 140 ms of actual app-side down/up
separation for a requested 160 ms.

SwiftUI's NSTextField value can change without immediately updating its published
binding. The fixture records the actual native control value and the separate
model value. `set_value` does not synthesize edit/submit events or keyboard focus;
callers must explicitly commit when appropriate and verify the application's
result. Electron's oracle reads DOM state but performs no DOM input automation.
Both frameworks receive input only through the native driver.

Ignored local evidence: `target/computer-verification/macos-capabilities.json`,
`macos-latest.jpg`, `frameworks.json`, and `native-result.json`. The prior native
and Linux/Agent evidence remains in [computer-use.md](computer-use.md). No real
model run, installed package, permission revocation or lock-screen cycle was
repeated in this change.

## Sublime Text document round trip

On macOS 27.2.1, Sublime Text build 4215 saved a disposable document after
native focus, click, Unicode typing and a Save shortcut. The test compared the
entire UTF-8 file with the expected insertion and original text. It closed the
document through Computer Use, then restarted the editor with the same file.
The reopened window had a fresh target ID and the file digest still matched.
Six consecutive runs passed, including three runs of the checked-in entry point. Each run
recorded five input receipts and the reopened window image.

The fixture uses Sublime Text Safe Mode, which recreates its separate Safe
Mode profile. Run it after quitting Sublime Text and with an expendable Safe
Mode profile. [Sublime Text Safe Mode](https://www.sublimetext.com/docs/safe_mode.html)

```sh
node scripts/build/computer.mjs
PERO_COMPUTER_NATIVE=1 node tests/e2e/computer-sublime.mjs
```

Evidence is under `target/computer-verification/sublime/`. This used the
development driver and scripted input. The separately installed macOS helper
answered its transport handshake and status request, but its permission
preflight reported Accessibility and Screen Recording as `not_detected`.

## Live window preview in macOS Native

2026-11-23, macOS 27.2.1 arm64, development Native build from
`ae9048698` with the preview changes. The ordinary chat ran a local ACP fixture
that observed a real AppKit window. The Native dark-theme screenshot showed the
entire window fitted inside the inline preview. Accessibility inspection found
the hide/show and float/return buttons, and verified that the running turn
continued while the preview was hidden. The return control appeared on opening
the floating window and disappeared after the task completed.

The opt-in AppKit test also checked that preview pixels change after background
input without a new Agent observation, that refreshing preserves the original
input anchor, that another conversation cannot read the preview, and that a
secure field withholds pixels until removed. The existing Computer Use
transport and shared contract checks passed.

```sh
node scripts/build/computer.mjs --test
node tests/contracts/computer-use.mjs
node tests/e2e/computer-transport.mjs
PERO_COMPUTER_NATIVE=1 node tests/e2e/computer-native.mjs
```

The isolated companion bundle used for the first UI run had no macOS
Accessibility or Screen Recording grants. The interactive checks used the
same source-built driver with the development process's existing grants.
The packaged companion, light-theme rendering, and window ordering across
applications and Spaces remain unverified.

### Compact floating presentation

The Native development build was rechecked with the same AppKit fixture. The
original floating window measured 360 × 292 points with its system title bar.
The updated window measured 288 × 202 points and showed one Pero header with
Return to Chat and Hide controls. The captured application window kept its
own content and aspect ratio.

The accessibility tree exposed both Pero buttons and no system window buttons
inside the floating preview. Dragging changed the window origin from
(1376, 171) to (1271, 246). Returning it to Chat and opening it again restored
the new origin. Hide left the Agent turn running and carried over to the next
turn in the same chat. Showing it again restored the preview, and completing
the turn removed the floating window from the native window list.
