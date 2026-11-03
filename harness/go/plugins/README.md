# Claude plugin configuration and execution

`plugins.Inspect(ctx, directory)` reads an explicitly selected local plugin or
marketplace. It returns typed skill, command and agent definitions, plus hook,
MCP and LSP configuration summaries and source-relative diagnostics. It does not
execute instructions, hooks, commands, package installers or MCP servers.

From `harness/go`:

```sh
go run ./cmd/pero-agent-acp plugins inspect /absolute/path/to/plugin
go run ./cmd/pero-agent-acp plugins validate /absolute/path/to/marketplace
```

Both commands emit one JSON report without requiring a provider, credential,
session directory or ACP client. `inspect` succeeds after a readable inspection,
including when the report contains configuration errors. `validate` emits the
same report and exits unsuccessfully if any diagnostic has severity `error`.
Usage and inaccessible-root errors are written to stderr and return nonzero.

`inspectionOnly: true` identifies the read-only inspection report, independently
of the runtime entry point described below. `valid: true` means the inspected configuration rules produced
no errors. Unsupported fields remain visible as diagnostics; this is not a
complete Claude product schema validator or permission to execute a plugin.

Supported inspection behavior:

- Optional manifests and default component directories; explicit commands and
  agents replace defaults, while explicit skills add to the default directory.
- YAML frontmatter, plugin-qualified component names, separate user/model
  invocation visibility, tool expressions and required agent metadata.
- Local marketplace sources, distinct installation and manifest identities,
  version drift and unsupported entry-owned component diagnostics.
- Default and explicit integration files, inline declarations and mixed arrays.
  Default MCP servers load first; later same-name declarations replace them.
- Hook wrapper/argv checks, unsupported execution fields, MCP transport,
  credential presence and millisecond timeout diagnostics.
- Default `.lsp.json` and manifest `lspServers` declarations, extension mappings,
  strict stdio configuration and explicit unsupported-capability diagnostics.
- Paths contained in the selected plugin, bounded regular configuration files,
  stable component order and deduplication of repeated component files.

Reports omit instruction bodies, hook command/argument values, MCP URLs,
environment values and header values. LSP summaries omit executable/argument
values and initialization/settings JSON. They retain definition descriptions,
component names, tool expressions and binding key names, so they are inspection
artifacts rather than automatically public documents.

Marketplace inspection visits its declared local entries. A local plugin that
is not registered in that marketplace can be inspected by passing its own
directory. Remote acquisition, entry-owned component merging, nested command
directories remain separate implementation steps.

The ACP runtime accepts explicit plugin selections:

```sh
go run ./cmd/pero-agent-acp \
  --endpoint https://api.deepseek.com/v1 --model deepseek-flash \
  --api-key-env DEEPSEEK_API_KEY --disable-thinking \
  --max-requests 6 --max-tokens 4096 --max-retries 0 \
  --session-dir /absolute/private/sessions \
  --workspace /absolute/project \
  --plugin-dir /absolute/path/to/plugin
```

The configured credential must already be in the process environment; the CLI
does not automatically load `.env`. Stdout remains ACP NDJSON. The ACP client
initializes a session and sends a prompt such as `/product-manager:pa ...`.
Repeat `--plugin-dir` to select additional local packages or a local marketplace.
Use `--enable-shell` for the model's Bash tool. Add explicit aliases such as
`--plugin-model sonnet=deepseek-flash` for agents that declare model aliases.

Runtime mounting uses the existing harness loop and ownership boundaries:

- Skill and command names are plugin-qualified. User/model visibility is
  separate; `$ARGUMENTS`, positional arguments and plugin/project/session
  substitutions work for direct and model invocations.
- Explicit package text resources are readable through Read or Skill; Write
  creates missing workspace parents. Resource digests remain frozen for the
  lifetime of the selection.
- Dynamic shell placeholders use the existing shell executor. Rendering never
  opens an interactive permission prompt; commands without existing permission
  abort the invocation. Skill tool grants expire at the next direct user input.
  Successful output over 64 KiB is saved under `.pero/plugin-output` with a
  bounded preview. Capture uses the shared 5 GB working-output ceiling;
  failed/cancelled expansion removes its temporary file. Its projection remains
  separate from native Bash output presentation.
- Skill model overrides and `effort` last for their invocation turn. `context: fork` runs
  through the existing isolated Agent executor and returns its actual result.
  `background: false` waits for that result. `background: true` returns as soon
  as the child is running and delivers the result to the parent when it
  finishes. Instructions and tool grants remain in the child.
- Command hooks run with Claude JSON stdin and parse actual decisions. The
  supported lifecycle includes startup/resume, user input, before/after tools,
  compaction, Stop continuation, SessionEnd and SubagentStart/SubagentStop.
  Main-session lifecycle events stay on the root agent; child tool events carry
  the main session identity and the actual child identity. Stop defaults to
  eight consecutive continuations and resets after ordinary tool work.
  Structured answer submissions also pass the stop gate and can be revised.
- MCP stdio, streamable HTTP and legacy SSE connections belong to root-agent lifetimes.
  Each package gets a server namespace; children inherit the parent connection.
- Agent, SendMessage, TaskOutput and TaskStop run, continue and cancel actual harness children.
  An agent `effort` of low, medium, high, xhigh, or max is sent on that child's requests.
  Custom/general-purpose agents retain their ID and history across completed
  turns and, with explicit persistence, JSONL reload. Explore/Plan and temporary
  ConfigureChild compositions remain one-shot. See the [agent profiles](../subagents/README.md).
  TaskCreate, TaskUpdate, TaskList and TaskGet persist state in the session log.
- AskUserQuestion is available when an ACP client negotiates the
  [structured question extension](../acp/USER_QUESTIONS.md). It supports free
  text, multiple questions and cancellation without using permission dialogs.
  The Desktop client negotiates this extension and renders its own question form.
- Selected JavaScript Workflow scripts run through the existing child-agent
  service, including nested scripts and structured results. Execution supports synchronous results, owned background task handles and
  automatic online completion notices; see the [Workflow contract](../workflow/README.md).
- Native plugin Bash supports background tasks, durable output logs and success
  artifacts. Foreground timeouts promote the same live process after a durable
  transition; sleep/disable/bare exceptions still stop it. Explicit
  `--bash-host-mode interactive` removes background deadlines; unattended is
  the default. `--disable-bash-background` disables starts and promotion. See
  [Bash output and timing](../nativetools/README.md#claude-plugin-bash).
- Selected `.lsp.json` / manifest `lspServers` declarations mount the `LSP`
  query tool by default. `--disable-plugin-lsp` suppresses bundled servers;
  explicit repeatable `--lsp-config` files remain available independently.
  Selection grants execution of trusted local stdio servers; it does not
  install missing executables. Nine capability-checked queries, cancellation,
  restart limits and shutdown are implemented. Native saved-file diagnostic
  checks default to enabled; continuous asynchronous monitoring and dynamic
  registration remain pending. See the [LSP contract](../lsp/README.md).
- Explicit `--web-provider deepseek-api` enables WebSearch/WebFetch, using the
  existing approval channel and a tool-free child for page extraction. See
  [Web provider configuration](../webtools/README.md).
- The optional [ACP trial adapter](../../tools/trial/README.md) supplies Harness
  trial execution while preserving the original SDK runner as a separate choice.
  It uses the real agent binary, explicit provider/model/environment binding,
  same-session continuations and existing tool approvals. Every requested
  session and final artifact pattern must succeed. Cancellation, close errors
  or nonzero process exit cannot become success because an artifact exists.
  Provider usage is recorded when reported; unknown usage/cost is not estimated.
  Positive USD budgets and automatic prompt retries are explicitly unsupported.

Explicit plugin execution receives the launch environment after the selected
provider credential has been removed. Hook/MCP configuration values remain out
of inspection output. Unknown execution fields and invalid declarations stop
runtime loading instead of silently changing their meaning.

This profile is still incomplete. Running-task cold recovery and several
additional hook and configuration features remain open.
Command hooks run as host processes alongside an optional Bash sandbox. Full
external-service and per-plugin business workflows still require their own
acceptance.
Selected managed background agents retain native Bash across their current turn
and receive command-completion continuations before final parent settlement;
foreground and one-shot child cleanup stays scoped to their original run.
The selected CLI also delivers root Bash completion notices automatically,
reconciling persisted terminal facts into the original inbox after controller
readiness. Notice recovery never restarts the historical command or clears a
user interrupt. Library native-tool hosts enable BackgroundNotifications explicitly.
See [background activity ownership](../subagents/README.md#background-bash-activity).
See the design's implementation matrix for the remaining work.

The user-selected
[Deep-Research-skills source](https://github.com/Weizhena/Deep-Research-skills/tree/6ce38f60e3f8b22502c29873f96503a4e0c5addb)
now supplies an explicitly selected research dependency. Provide
`--research-source`, `--research-python`, `--plugin-model opus=MODEL`,
`--enable-shell` and an explicit Web provider. Python/PyYAML must already be
available; no global installation or source checkout edit is performed. A
content-addressed package view adds `deep-research:deep-research` to compose the
original Chinese research, research-deep and research-report stages in the root
session. Outline/item/field, per-batch and report-field confirmations remain
human gates. See the [research profile contract](../researchprofile/README.md).

The original chain passed real CLI loopback acceptance on 2026-11-03: six ACP
question interactions, two background researchers, ten searches, two fetches,
two tool-free extractions and sixteen tool approvals. The original validator
ran, report.md was read back, and approved cp/cmp preserved its actual bytes in
raw research before the caller wrote its ledger, final report and summary.
Fixture clients answered questions/approvals; this proves the gate positions,
not human review. Model and Web data were fixtures, so real-world research
quality remains unverified. Parent-exit residency and cold background-agent
resumption are not promised.

Verification uses temporary plugin directories and the actual CLI dispatch.
Hook/MCP sentinel programs are never executed by inspection. See the
[implementation design](../../../docs/design-docs/claude-code-plugin-compatibility.md).
The installed clangd hover and both LSP CLI selection paths have passed; the ACP
trial suite passes 15 local tests, including final-artifact and shutdown failure
regressions. These results do not establish every plugin's business workflow or
every external service connection. Final frozen-source Go race/vet passed and
Bazel passed 34/34 targets. The existing real-provider evidence remains the PRD
flow and one Search/Fetch request each; the full research chain was loopback.
