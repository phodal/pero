# Selected stdio language servers

The `LSP` tool uses configured local language servers without running a model.
An operator selects a JSON server map with `--lsp-config`, or selects a plugin
declaring `.lsp.json` / manifest `lspServers`. `--disable-plugin-lsp` suppresses
bundled declarations. Executables are resolved before mounting; processes start
on the first matching query. A declaration alone does not establish availability:
each query requires successful initialization and a real advertised capability.

The nine operations are `goToDefinition`, `findReferences`, `hover`,
`documentSymbol`, `workspaceSymbol`, `goToImplementation`, `prepareCallHierarchy`,
`incomingCalls`, and `outgoingCalls`. The compatibility input uses `operation`,
`filePath`, `line`, and `character`. Positions are one-based UTF-16 cursor
coordinates; the protocol receives zero-based coordinates. Only UTF-16 is
advertised, and a server selecting a different encoding is rejected. Workspace
symbols use the identifier at the supplied cursor; call-edge queries prepare the
exact hierarchy item first and preserve its opaque server data. References
include the declaration.

Sources are read through the existing descriptor-rooted workspace reader, with
its 1 MiB text bound and symlink constraints. Relative paths use the current
session working directory. A server starts in that same canonical directory,
which must remain within the launch workspace. An explicit `workspaceFolder`
must resolve to that current directory. A local language server is a trusted
operator-selected process, not an OS sandbox; it can index dependencies using
its own filesystem access. The host never applies server edits or commands.

Each server/current-directory pair owns one serialized stdio connection. The
host performs `initialize`, `initialized`, configuration, transient `didOpen`,
queries and `didClose`. Static settings answer `workspace/configuration` and are
sent with `workspace/didChangeConfiguration`. Startup and each request use their
configured deadlines. Cancellation sends `$/cancelRequest`; a server that does
not acknowledge it within 250 ms is terminated and reaped. Shutdown requests
`shutdown` then `exit`, with forced process-group cleanup at the configured
deadline. Default startup/request/shutdown budgets are 10/60/5 seconds. The host
retains at most 32 server/current-directory pairs and bounds frames to 16 MiB and
rendered results to 100 entries / 16,000 characters.

`restartOnCrash` and `maxRestarts` control lazy replacement on a subsequent
query; the failed query is not silently retried. Defaults permit three
replacements. Supported configuration is strict: unknown fields, non-stdio
transport and explicit `diagnostics: true` are rejected. Live post-edit
diagnostics injection and dynamic capability registration are not implemented;
omitting `diagnostics` leaves that feature disabled in this runtime. Managed
process ownership is currently implemented only on Linux and macOS.

Tests use a local stdio fixture without network access. With an installed
compiler server, `PERO_LSP_REAL_CLANGD=1 go test ./lsp -run TestLSPRealClangdOptIn`
performs a real hover query in a temporary workspace; it installs nothing.

References: [plugin server configuration](https://code.claude.com/docs/en/plugins-reference#lspservers),
[Claude LSP behavior](https://code.claude.com/docs/en/tools-reference#lsp-tool-behavior),
and [LSP 3.17](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/).
The current Agent SDK tool-input union does not export an LSP input type. The
uniform compatibility shape is also recorded in the
[upstream schema report](https://github.com/anthropics/claude-code/issues/38011).
Implementation provenance and licensing are recorded in `SOURCE.json`.
