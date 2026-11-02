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
is a launch cwd, not a shell filesystem security boundary. This legacy `shell`
profile has no background jobs or persistent shell. It adds no package
installation automation or default broad approval.

Legacy encoded output is capped at 64 KiB. File effects retain structured receipts on
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

Foreground plugin Bash defaults to 120 seconds, with a 600-second ceiling.
A live command that reaches its foreground wait limit continues as the **same
process** in the background. The response includes task_id, promoted, a timeout
message and working_log_file. The original intent remains unchanged; a separate
shell-task/promoted fact is appended and flushed before returning the handle.
If promotion cannot be persisted, the process is cancelled and joined. Commands
that have not actually started are never reported as promoted.

`--bash-host-mode unattended` is the default. Background commands get a
30-minute default and 2-hour ceiling; an explicit background call's timeout
selects its running limit within that ceiling. A promoted command's background
limit starts when promotion is committed. `--bash-host-mode interactive` is an
explicit host selection: background commands have no execution deadline,
including after promotion. The runtime never guesses this mode from a TTY.
Owner interruption, TaskStop and runtime shutdown still cancel and join jobs.

`BASH_DEFAULT_TIMEOUT_MS` raises the foreground and background defaults;
`BASH_MAX_TIMEOUT_MS` raises their ceilings. Lower nonnegative values keep the
defaults, and each ceiling is at least its default. A default above two hours
also raises the background ceiling. Values must fit a Go duration without
overflow. Model timeouts cannot increase a host ceiling. These settings are
read from the explicitly supplied launch environment.

Commands beginning with `sleep` stop at the foreground limit instead of being
promoted. `--disable-bash-background` or
`CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1` disables both explicit background starts
and automatic promotion; foreground commands then stop at their limit. Library
hosts can select the same behavior with Options.BashTiming, including its Bare
option. The CLI does not expose a separate general-purpose bare mode.

The Claude Bash tool adds no outer fixed tool timer: its owned execution
controls waiting and deadlines while retaining the caller's cancellation. The
legacy shell keeps its existing limits and 125-second outer timer. This ACP
runtime does not implement Claude's separate plain-text `-p` waiting policy.

Real-process tests verify one PID and one set of effects across promotion,
durable handoff, cancellation after a returned tool call, promotion flush
failure, background deadlines, explicit interactive mode, sleep/disable/bare
exceptions, TaskStop, owner retirement and cold interrupted recovery. Resident
background subagents and command-completion notifications/automatic wakeups
remain separate work; exact-owner task lookup is unchanged.

## Selected language servers

`LSP` is available through explicit `--lsp-config /absolute/servers.json` or
language-server declarations bundled with a selected plugin. Bundled servers
are selected by default; `--disable-plugin-lsp` disables those declarations
while preserving separately selected operator files. Server executables must
already be available. Selection resolves the executable; the process starts
lazily for a matching query and must advertise the requested capability.

The nine query operations use one-based UTF-16 cursor positions and the existing
workspace reader. The host never applies server edits or commands. Language
servers are trusted local processes, with cancellation, restart limits and
shutdown ownership; they are not an OS sandbox. Native Write/Edit now trigger bounded saved-file diagnostic checks by default;
see the LSP contract. Continuous asynchronous diagnostics and dynamic capability
registration remain unsupported. Actual `/usr/bin/clangd`
hover and both operator/bundled CLI fixture paths have passed. See the
[LSP contract](../lsp/README.md) for configuration, supported operations and
remaining platform limits.

## Explicit research dependency

`--research-source` and `--research-python`, together with explicit
`--plugin-model opus=MODEL`, `--enable-shell` and a Web provider, compose the
selected original Chinese research chain. Python/PyYAML must already be
available. Preparation publishes a content-addressed package view without
changing the source checkout or global skill directories. The root session
retains the original human questions; background item researchers use the same
Agent, Web, approved file/Bash tools and owner lifecycle. See the
[research profile contract](../researchprofile/README.md).

The real CLI loopback chain passed on 2026-11-03 with six ACP question
interactions, two background agents, ten searches, two fetches, two tool-free
extractions and sixteen tool approvals. The original validator and generated
report script ran; Read then approved cp/cmp preserved report.md byte for byte
as raw research before ledger/final/summary generation. The fixture client
answered the gates; actual human approval and real-world research quality are
separate. Provider and Web data were loopback fixtures. This does not add
background-agent residency after parent exit or restart recovery.
