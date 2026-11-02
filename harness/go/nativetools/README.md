# Explicit native tool composition

`--workspace /absolute/root` enables `read_file`, `write_file`, `edit_file`,
`list_directory`, and literal content `search_files`. Session cwd must resolve to
that exact workspace. ACP new/load/resume reject a mismatch before session or
MCP activation; tools still recheck at execution in case the root changes.
Reads/list/search rely on this explicit root grant.
Every write/edit call requires a fresh approval; refusal or unavailable client
fails closed. `--approval never` denies these operations even inside workspace.
No persistent allow-all grant is introduced.

`--enable-shell` additionally registers `shell`; every invocation requires ACP
approval. It starts fresh noninteractive Bash, default `/bin/bash`, with only a
small explicit environment (no inherited credentials), 30 s default / 120 s max
timeout, 16 KiB captured per output stream (further limited to 4 KiB per stream for
worst-case JSON escaping) and process-group cancellation.
**Shell is not sandboxed**: approved commands can access outside workspace and
network, and deliberately detached processes can escape process groups. Use
external OS/container isolation when running untrusted commands. The workspace
is a launch cwd, not a shell filesystem security boundary. No background job,
persistent shell, package installation automation or default broad approval.

Encoded output is capped at 64 KiB. File effects retain structured receipts on
failure; `unknown` means inspect/reconcile, not automatically retry. Shell errors
retain output/exit/timeout flags. The runtime may additionally redact a result
when the owning session is cancelled or retired, as its existing safety contract.

The CLI default approval is `ask`; existing unattended Rust Worker rejection
policy is unchanged. Without `--workspace`, the old ACP-only/no-builtins mode
remains available. Tools use the existing real agent registry and lifecycle.

## Explicit sandbox selections

`--sandbox=strict-read-only` and `--sandbox=strict-workspace-write` retain the
Linux/macOS read-and-network isolation requirement with explicit runtime mounts.
They never fall back to Windows ACL confinement.

On Windows, select `--sandbox=windows-acl-read-only` or
`--sandbox=windows-acl-workspace-write`, provide `--workspace`, `--enable-shell`,
`--approval=ask` and an absolute `--shell` path to `pwsh.exe`. Do not provide
`--sandbox-runtime`: Windows ACL does **not** isolate reads or network. The tool
description and result report this partial boundary. Every invocation still
requires approval; no strict native auto-approval descriptor is emitted.

Windows `--workspace` independently enables bounded `read_file`,
`list_directory`, `search_files` and approved **create-new-only** `write_file`.
The create-only description is exposed to the model; an existing target is always
rejected and `edit_file` is omitted. No shell or ACL changes are required for file
tools. Explicit root AGENTS.md loading also uses this read capability.

The Windows partial sandbox adds `shell` to those file tools. Its read-only mode
omits `write_file` as well as `edit_file`; shell remains approved and partial.
File-tool reads/creates remain workspace-handle-confined regardless of the shell's
unconfined-read/network limitations. Session cwd must match the configured
workspace and its original identity.
No Windows shell is enabled without the explicit partial sandbox selection.

## Claude plugin Bash

Selecting `--plugin-dir` adds the Claude tool names and parameters. Explicit
`--enable-shell` enables `Bash`, including `run_in_background`. These commands
retain the existing approval and process ownership paths. `TaskOutput` waits or
reads without cancelling on a read timeout; `TaskStop` cancels and joins the
exact owner's task. Completed output survives session reload. A previously
running process is recorded as interrupted on recovery and is never replayed.

Successful native Bash output defaults to 30,000 Unicode characters inline.
Larger output returns a private artifact of at most 64 MiB and a preview of up
to 2,000 characters. Failed output returns at most 10,000 characters from the
head and tail of the readback window. Success artifacts use `output_file`;
background working logs use `working_log_file` with a separate partial flag.
The working log has a 5 GB ceiling. The artifact writer checks the original
workspace identity; a replaced workspace causes a presentation error while
retaining the actual command result and log, without rerunning the command.

`BASH_MAX_OUTPUT_LENGTH` controls readback, default 30,000 and maximum 150,000.
`--bash-output-max-chars N` overrides both inline and readback limits, up to
128,000, and takes precedence over that environment variable. Library callers
can supply the same typed `Options.BashOutput` policy. New execution records
retain their presentation for cold recovery; older records retain their saved
bounded result and working log. Dynamic skill command expansion retains its
separate output projection.

Foreground plugin Bash defaults to 120 seconds, maximum 600 seconds. Background
commands use the unattended 30-minute default and 2-hour maximum. Automatic
foreground-to-background promotion, interactive sessions without a deadline,
and background subagent residency/command-completion wakeups are not yet wired.
