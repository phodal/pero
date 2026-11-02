# Foreground shell executor

The reusable foreground execution, tail collector and Unix process-group
primitives are adapted from `phodal/point` commit
`69a1f8692725078c4ce7feaf497f5b80799ca44d`, `go/harness/shell`.
See `SOURCE.json` for exact source blobs and extraction changes.

`NewLocalExecutor` requires an explicit absolute shell executable and workspace
directory: Bash on Unix, or PowerShell (`pwsh.exe`) only with the explicit Windows
ACL backend. `Resolve` validates the launch directory remains within that root,
and checks the original workspace object identity before resolution and process
start. Replacing that root between operations fails closed; pathname races in
the final check/start interval are not eliminated. **This is not a filesystem
or network sandbox**: an approved Bash command
can access other paths and network resources as its OS user. Callers must obtain
approval before execution and use external isolation for untrusted commands.

Default timeout is 30 seconds, hard maximum 120 seconds. Commands are limited to
16 KiB. Retained output is bounded to at most 64 KiB independently for stdout and
stderr; excess output is discarded while the pipes continue draining. The source
tail algorithm retains the last bytes and reports truncation. Trusted composition
can supply `LocalOptions.OutputSink` to retain the complete combined stream;
writes are serialized and a sink failure cancels the owned process group. The
executor does not create spill files itself. No background job ownership,
persistent shell, model environment overrides, product
sandbox service or managed runtime is included.

By default only explicit PATH/LANG/LC_ALL/TZ values may be supplied in BaseEnv;
no process environment is inherited. Trusted plugin composition can opt into
`TrustedBaseEnvironment` with an explicit launch snapshot. Neither setting is a
model argument. Fixed noninteractive presentation values are added.
Bash startup files are disabled. Cancellation/timeout terminate then kill the
owned process group even if the leader exits first. Pipe drain time is bounded.
Ordinary descendants are cleaned up on completion; deliberate process-group or
session escape is not prevented and requires OS-level isolation. Linux and
macOS retain this foreground execution path. Windows is accepted only with
`sandbox.Config{Backend: sandbox.BackendWindowsACL, ...}`; unsandboxed Windows
and strict Windows remain unavailable. Other platforms fail closed.

Source reuse is owner-authorized. No blanket license for the source is inferred
or assigned here; none of the selected source files carries a third-party
license notice. Repository licensing remains an owner decision.

## Windows ACL partial mode

Windows uses fixed `-NoLogo -NoProfile -NonInteractive -Command` arguments, not
Bash switches. The sandbox runner supplies a minimal environment, a restricted
Low-integrity token and Job Object ownership. **Outside reads and network are
not isolated**. Results report `enforcement: partial`, `readIsolated: false` and
`networkIsolated: false`; this mode never satisfies strict admission.

The parent holds a control pipe open; cancellation closes it so the runner can
terminate its Job Object, wait for child exit and perform ACL/temp cleanup before
returning. A five-second cleanup deadline forces termination if necessary and
reports `cleanupUncertain: true`; inspect the runner diagnostics before retrying.
The ordinary Unix process-group grace is unchanged. Native Windows tests skip
unless `PERO_REQUIRE_WINDOWS_ACL=1` is set for an approved disposable runner.
