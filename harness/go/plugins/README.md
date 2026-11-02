# Claude plugin configuration and execution

`plugins.Inspect(ctx, directory)` reads an explicitly selected local plugin or
marketplace. It returns typed skill, command and agent definitions, plus hook
and MCP configuration summaries and source-relative diagnostics. It does not
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
- Paths contained in the selected plugin, bounded regular configuration files,
  stable component order and deduplication of repeated component files.

Reports omit instruction bodies, hook command/argument values, MCP URLs,
environment values and header values. They retain definition descriptions,
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
  bounded preview. Capture over 64 MiB fails and removes incomplete files.
- Skill model overrides last for their invocation turn. `context: fork` runs
  through the existing isolated Agent executor and returns its actual result;
  ACP waits synchronously. Instructions and tool grants remain in the child.
- Command hooks run with Claude JSON stdin and parse actual decisions. The
  supported lifecycle includes startup/resume, user input, before/after tools,
  compaction, Stop continuation and SessionEnd.
  Main-session lifecycle events stay on the root agent; child tool events carry
  the main session identity and the actual child identity. Stop defaults to
  eight consecutive continuations and resets that count after a tool call.
- MCP stdio and streamable HTTP connections belong to root-agent lifetimes.
  Each package gets a server namespace; children inherit the parent connection.
- Agent, TaskOutput and TaskStop run and cancel actual harness children.
  TaskCreate, TaskUpdate, TaskList and TaskGet persist state in the session log.
- AskUserQuestion is available when an ACP client negotiates the
  [structured question extension](../acp/USER_QUESTIONS.md). It supports free
  text, multiple questions and cancellation without using permission dialogs.

Explicit plugin execution receives the launch environment after the selected
provider credential has been removed. Hook/MCP configuration values remain out
of inspection output. Unknown execution fields and invalid declarations stop
runtime loading instead of silently changing their meaning.

This profile is still incomplete. In particular, conditional Bash grants and
exit-1 interpretation for compound syntax, background Bash,
Workflow scripts, Web/LSP and several additional Claude hook/configuration
features remain open. Hooks do not yet use the sandbox backend; selecting both
command hooks and a sandbox currently returns an error. SSE transport is not
substituted with streamable HTTP. Explore/Plan use a narrower read-only tool set.
The current Desktop client does not negotiate structured questions yet.
See the design's implementation matrix for the remaining work.

Verification uses temporary plugin directories and the actual CLI dispatch.
Hook/MCP sentinel programs are never executed by inspection. See the
[implementation design](../../../docs/design-docs/claude-code-plugin-compatibility.md).
