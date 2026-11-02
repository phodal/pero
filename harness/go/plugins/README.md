# Claude plugin configuration inspection

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

`inspectionOnly: true` distinguishes this first implementation stage from
runtime support. `valid: true` means the inspected configuration rules produced
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
directories and runtime mounting remain separate implementation steps.

Verification uses temporary plugin directories and the actual CLI dispatch.
Hook/MCP sentinel programs are never executed by inspection. See the
[implementation design](../../../docs/design-docs/claude-code-plugin-compatibility.md).
