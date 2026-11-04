# Explicit native tool composition

`--workspace /absolute/root` enables `read_file`, `write_file`, `edit_file`,
`list_directory`, and literal content `search_files`. Session cwd must resolve to
that workspace or its active retained root-worktree lease. ACP new/load/resume
validate the original workspace before session or MCP activation; tools still recheck at execution in case the root changes.
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

Ordinary Bash calls retain their last observed shell directory. Callers can
choose a directory for individual commands: Bash's optional
`workdir` resolves relative to the Session workspace, never the remembered
directory. It applies to foreground and background calls and does not update
the remembered directory, even if the command uses `cd`. Existing directory
admission, approval and durable call/workdir identity still apply. Trusted hosts
can wrap an execution context with `WithSessionWorkingDirectory(ctx)` to run a
check in the session workspace without reading or changing that persistent
directory. The exact command, approval policy and execution ownership are kept.

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
exceptions, TaskStop, owner retirement and cold interrupted recovery. Selected
managed background subagents now retain their native Bash activities across
turns and receive actual completion notices in the same child, including
foreground-to-background promotion. Foreground children still stop commands
when their run ends. The selected plugin CLI also enables root command
completion notices; library hosts choose Options.BackgroundNotifications.
Root notices carry the bounded actual result and use the existing inbox, with
stable task IDs deduplicated across pending/consumed history. Root interruption,
retirement, and unconfirmed terminal persistence do not trigger automatic model
work. TaskOutput reports notification_error when online delivery was not confirmed.
Running-process cold recovery remains outside this addition; task lookup stays exact-owner scoped.
See [background activity ownership](../subagents/README.md#background-bash-activity).

With attached persistence, root recovery reconciles terminal facts at controller
readiness and before subsequent model steps. It stages missing notices in
terminal-log order before resuming the existing FIFO inbox driver; it does not
re-execute commands. Lost owners become interrupted. A stopped controlling turn
is not automatically resumed; later explicit input allows reconciliation.
The recovery budget is five seconds. Saved-file availability changes affect
current TaskOutput, without changing an already accepted completion message.
Real process/JSONL tests cover terminal-to-inbox fault injection, two fresh
runtime reloads without replay, missing logs, terminal FIFO and stopped roots.
The ordinary plain-text -p waiting/exit policy remains unimplemented.

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


`ToolSearch` (`tool_search` in the generic profile) searches current caller-visible
names/descriptions, returns current input schemas and declaration hashes, and
picks tools matching all literal keywords first. If no tool matches every word,
it returns `partial_match: true` with partial matches ranked by keyword coverage,
then name matches. Unknown exact `select:` names still return no matches;
aliases are not inferred. Keyword pages default to five tools; exact selection
defaults to twenty. Both retain their explicit page limit and paginate within
a 32 KiB item budget. It changes no permissions or activation
state in the default profile. With `--defer-tool-loading`, only discovery is
initially declared. Complete search results are durably activated for the next
request; oversized omitted schemas are not activated. Every declaration and
dispatch still checks current caller authorization and schema/registration
identity. Unloading and replacement invalidate the affected entry; current
restrictions hide denied tools. Forks do not inherit discovery; disk resume revalidates retained entries.
The existing registry remains the owner. Another authoritative presenter or
tool-history presentation is explicitly incompatible with this selection. Use
only tools declared for the current model request.

`NotebookRead` (`notebook_read` generically) reads saved nbformat 4 cell source,
IDs, execution counts, outputs and attachments. `offset`/`next_offset` are 1-based
cell numbers, with a default 20 cells and 48 KiB cell budget. Oversized cells carry
an explicit omission marker and source preview. No code is executed and embedded
images/HTML are not rendered. Files stay under the same workspace read authority.

## Interactive terminals and retained root worktrees

`--enable-shell` also exposes TerminalOpen/Read/Write/Resize/Stop (generic
`terminal_open/read/write/resize/stop`) on macOS/Linux without a configured
sandbox. These own a real PTY, bounded lifetime/output, stdin, canonical EOF,
resize and process-group cleanup. Opening and writing require approval; all
handle operations require the exact agent's handle. Read cursors report discarded
output and actual exit/timeout/cancellation. Interrupted turns stop their PTYs;
a later turn can open another. Restart never recreates a historical process.
Startup intent is flushed before process creation; uncertain writes/effects must
be inspected before retrying. macOS has runtime coverage; Linux is cross-compiled
here and still needs native runner verification. Windows/sandbox PTYs are absent.

EnterWorktree/ExitWorktree are root-only, approved transitions in unsandboxed
native composition. Entry requires the configured workspace to be a Git root,
starts a detached worktree at committed HEAD or an explicit ref, and records its
return point with the execution cwd. Original dirty edits are not copied.
File tools, new shell/terminal commands and hierarchical instructions follow the
lease. Existing processes retain their own cwd. Exit and shutdown retain all
files and Git registration under `.pero/worktrees`; they never reset or delete
that checkout. Cold resume validates the retained Git registration before
rebinding it, and never replays creation. Reconcile or remove retained worktrees
explicitly after preserving their changes.

## Saved document images

NotebookImage (`notebook_image`) decodes a selected saved raster output or
attachment with cell/output provenance; it executes no notebook code or HTML.
PDFRead (`pdf_read`) is registered only after a real Poppler capability probe.
`--pdf-renderer /absolute/pdftoppm` selects the renderer and adjacent pdfinfo;
empty auto-detects, `-` disables, and an invalid explicit selection fails startup.
PDF sources use the workspace descriptor and renderer stdin, with a 32 MiB
source limit and 30-second subprocess limit. A call renders at most three pages;
results carry page numbers and source SHA-256. Images use the existing 2048px /
4 MiB normalization and provider vision/text fallback. No OCR is provided.

Skill/Agent descriptions and MCP initialization guidance share a 64 KiB request
budget after final tool/model selection. Omitted entries have explicit markers;
Skill/skill offset/limit lists catalogs, summary reads complete metadata without
activating a workflow, AgentList pages agent metadata, and read_mcp_instructions
recovers visible server text. Byte reads use UTF-8 boundaries and next_offset.
Local spill text and process output share a retained session quota, 256 MiB by
default (`LocalSpillStoreOptions.SessionMaxBytes`), including files found after
restart. Exhaustion preserves existing artifacts and returns a quota error.
