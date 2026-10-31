# Local terminal

Implemented 2026-10-31. Terminal is a bottom-left sidebar action that toggles
an integrated bottom panel. Manage apps sits first in the Apps group, followed
by enabled App shortcuts. Both expanded and collapsed sidebar layouts retain
these actions.

`pero-host` owns PTY processes via `portable-pty`; native and WASM GPUI share the
`TerminalView` VT100 presentation. The versioned Host protocol declares open,
write, resize and close operations and typed terminal events. The shell starts
in the current workspace (or Host working directory when no workspace is
selected), using `$SHELL` or the platform default. Terminal input and output do
not enter Agent sessions or their journal.

Each tab has a separate shell. Hiding the panel or changing the main page keeps
its process and screen state. Closing a live terminal requires an inline confirmation and ends its shell. Terminal tabs
are process-local and do not reopen shell processes after restarting Desktop.
The panel supports ANSI colors, cursor and alternate-screen state, scrollback,
Unicode input, clipboard paste, visible-output copy, arrow keys and Ctrl+C.
PTY dimensions follow the panel width and height using the measured monospace
font width. Exited shells keep their output and exit status until closed.

## Verification

`node tests/e2e/terminal.mjs` drives a real Electron window and real Host PTY:

- A command produces output and a file in a temporary directory.
- The shell starts in the workspace; its environment survives hiding and page changes.
- Ctrl+C interrupts a real `sleep`; commands can run afterward.
- New tabs are independent; closing one preserves the other.
- ANSI output, Unicode clipboard paste, resizing (`stty size`) and exit status.
- Light, dark and narrow-window screenshots, with no renderer errors.

Evidence is generated in `test-results/terminal/`. Native macOS was also
checked with an isolated profile: opening the panel, running `printf`, and
pasting a command containing Chinese text all produced the expected output.
The existing Sessions/Apps navigation suite is rerun alongside the terminal
suite. Build/check results include the Host, native UI, WASM, web, Desktop,
UI library tests and repository code-generation/type checks.

This is local desktop acceptance. Windows ConPTY, Linux graphical sessions,
physical IME composition, screen readers, mouse-driven TUI programs and signed
release packages have not been certified by these checks.
