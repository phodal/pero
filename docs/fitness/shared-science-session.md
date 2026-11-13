# Shared science session verification

Date: 2026-11-13 (Asia/Shanghai). Platform: macOS arm64, development checkout
`/Users/phodal/workspaces/pero-science-work/p0-shared-kernel`, branch
`codex/science-p0-shared-kernel`, based on `c4f4ecdaf85b0a23dc3b04e1581bd680bba67b23`.

## Implemented owner chain

Production Viewer / public App SDK → existing Desktop or Native capability
carrier → Rust Host App grant and conversation scope → ACP exact live Agent →
existing `scienceenv.Env` → existing Python/R/repl interpreter process.

The shared Notebook does not own a process pool. The same `python`, `r` and
`repl` tools and user cells update the same computation. Agent tools retain the
Harness approval seam; a user pressing Run uses the existing App agent grant.
Unrelated App sessions are not listed or accepted. Only the Pero Agent advertises
this extension when scienceenv is mounted; Scientific Viewer App conversations
automatically add the existing `--science-env` flag. Other providers receive an
explicit unsupported message and may use the separate Jupyter mode.

Input and result receipts use the existing Agent JSONL log (`science/cell`), not
an additional database. Reopening an Agent retains history, starts with no live
interpreter, and does not replay cells. Incomplete receipts become outcome
unknown. Cell errors retain interpreter state; interruption kills it and requires
Start/restart. Every fresh process has a new generation. Closing the shared view
only detaches observation; exact Agent retirement closes its own kernels.

## Checks and evidence

- `PATH=/opt/homebrew/bin:$PATH go test -race ./scienceenv ./acp ./model`
  from `harness/go`: passed. The shared lifecycle check runs real Python with
  actual Harness tools/approval, user submission, stdout/failure, file-observed
  readiness before interruption, restart, isolation, retirement and resume.
  Journal tables cover pure transitions and incomplete receipt recovery.
- `PATH=/opt/homebrew/bin:$PATH go test -race ./cmd/pero-agent-acp`: passed.
  `go vet ./scienceenv ./acp`: passed.
- Rust Host/runtime check, Host build, App scope access test and duplex ACP
  science transport test: passed. The latter serves science status/interrupt
  while a prompt is pending, and rejects unsupported providers. Fixture transport
  tests do not claim interpreter execution; the separate chain below does.
- App SDK typecheck and 178 existing tests: passed.
- Viewer typecheck, build and 31 existing tests: passed.
- Existing production artifact browser regression: 12 checks passed; saved
  Notebook outputs and both themes remain covered independently of execution.
- `git diff --check`: passed. Changed code files remain below 1,000 lines.

`tests/e2e/shared-science-browser.mjs` runs the production Viewer bundle, public
SDK and production DesktopApps carrier against the real Rust Host and Go ACP
binary. A bounded loopback scripted provider selects the real Python tool; no
real-model inference, credentials or external requests are used. Existing Host
approval replies are test-driven. Loopback HTTP replaces Electron's protocol.

Observed in that chain:

| Behavior | Result |
| --- | --- |
| Agent → user → Agent | Agent sets `shared_value=10`; actual Notebook cell reads 10 and changes it to 17; Agent's later Python tool reads 17. Both origins and outputs appear in the UI. |
| Failure | User stdout before `ValueError` and the failure are retained in history. |
| Interrupt Agent from Notebook | UI interrupts real Python only after its readiness file exists; process stops, history reports interrupted, variables clear, Start recovers. |
| Restart | User sets a variable, presses Restart, then confirms that variable no longer exists. Old receipts remain. |
| Isolation and close | Session B holds 900. Closing A leaves B's value 900 and its interpreter usable. |
| View lifecycle | Switching away from the Notebook and back preserves B; Agent reads 900 afterward. |
| Missing R | Actual R start reports unavailable with install/configure/retry guidance. Selecting Python recovers the still-live Python session. Rscript is absent on this machine. |

Evidence is local and intentionally not committed as binary assets:

- `test-results/shared-science/verification.json`: final pass, binary/bundle
  SHA-256 values, fixture substitutions and 12 loopback provider requests.
- `test-results/shared-science/shared-state-light.png`: Agent/user/Agent receipt chain.
- `test-results/shared-science/isolated-session.png`: independent session history.
- `test-results/shared-science/r-unavailable.png`: real missing-R state.
- `test-results/shared-science/shared-session-narrow-dark.png`: 390 px dark
  shared Notebook; horizontal page overflow check passed and screenshot reviewed.
- `test-results/session-artifacts-viewer/`: existing saved-preview regression.

The primary agent also opened the live production Viewer in real Chrome via CUA,
imported the Notebook, inspected A's Agent/user/Agent 10→17 receipts and switched
to B. B visibly showed Shared kernel ready, `isolated-after-close: 900` and
`survived-unmount: 900`. The light screenshot was visually inspected: origins,
code, outputs and working cell are readable and separated without clipping.

## Reproduce

From this checkout, build the Host and ACP into its own `target/debug`, then:

```sh
npm run typecheck --prefix apps/scientific-viewer
npm run build --prefix apps/scientific-viewer
PERO_SCIENCE_PYTHON=/opt/homebrew/bin/python3 node tests/e2e/shared-science-browser.mjs
```

ACP build command (from `harness/go`):

```sh
go build -o ../../target/debug/pero-agent-acp ./cmd/pero-agent-acp
```

Set `PERO_SCIENCE_PYTHON` to a suitable local interpreter on another machine.
When Playwright has no downloaded Chromium, also set `PERO_CHROMIUM_PATH` to an
installed Chrome executable; the observed run used
`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`.
The inherited macOS command path chooses system Python 3.9 by default, which
fails an existing literature sidecar's Python 3.10 union annotation. The same
complete scienceenv suite passes with Homebrew Python 3.14; this task did not
change the repository's existing Python version policy or install another R.

## Remaining boundaries

This establishes local interpreter behavior and the browser/Host/ACP development
chain. Electron and Native capability routing is implemented and compiled where
reported, but no actual Electron window, Native GPUI/WebView or signed package
acceptance is claimed. Standalone Jupyter's existing rich MIME/image path remains
separate; shared scienceenv currently exposes its existing captured text streams
and errors. Its buffered output from an interrupted unfinished cell is not
streamed/preserved before the final worker result. No scientific-validity,
real-provider decision, external account, cluster or GPU acceptance is claimed.
