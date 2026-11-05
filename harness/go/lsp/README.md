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
transport is rejected. Query capabilities support connection-local dynamic
registration/unregistration with language, file scheme and glob selectors.
Patterns support `*`, `**`, `?` and character classes; brace alternatives and
notebook selectors are rejected. Dynamic document synchronization is not supported.
Post-edit diagnostic checks default to enabled; `diagnostics: false` disables
them for the selected server. Managed
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

## Query-time diagnostic evidence

The stdio reader now accepts `textDocument/publishDiagnostics` for the document
currently opened by a query. Initialize advertises version support. Every
reopening uses a new document version; publications for another URI or another
version are ignored. A versionless publication is accepted only while that
URI is open, as permitted by LSP. Servers that omit versions cannot identify a
delayed publication from an earlier opening of the same URI.

A publication replaces the preceding set; an empty array explicitly clears it.
Malformed replacements leave the last valid set intact. Retained evidence is
bounded to 100 entries and 16000 Unicode characters. Query results render the
latest publication received when the query result is assembled, using the
existing shared result limits. Missing publication means no evidence received;
it is never represented as a clean diagnostic result. The host does not wait
for a server to finish all asynchronous validation.

Real stdio tool tests cover Unicode diagnostics, clear notifications, foreign
URIs, stale versions and repeated openings. This is the receiving path needed
for automatic diagnostics described below. A saved-file document stays open
after its snapshot. A later publication for that same document and version is
delivered on the next model step. Reopening the file or shutting down the
server closes it first.
Protocol reference: [publishDiagnostics](https://raw.githubusercontent.com/microsoft/language-server-protocol/gh-pages/_specifications/lsp/3.17/language/publishDiagnostics.md).

## Automatic checks after saved files

`diagnostics` defaults to true, matching the selected Claude configuration.
After a successful native Write/Edit (or write_file/edit_file), the existing
After pipeline reads the actual applied filesystem receipt. For a mapped file,
it reads the saved contents through the existing workspace authority and opens
a fresh versioned document on that server. If the server advertises save
support, the host sends didSave, including text only when requested. It retains
the versioned document for late publications; it never sends an invented didChange
for a document that it did not already own.

The host waits up to two seconds for startup, connection admission and the
first valid publication (also bounded by requestTimeout for publication).
The latest received set becomes a durable additional context on the same tool
result, attributed as lsp-diagnostics. An empty set is explicit server evidence
at that moment, not a promise that all asynchronous analysis has finished.
Failure, timeout or server exit preserves the successful file operation and
adds an unavailable notice; it never retries the write or reports a clean set.
Denied/failed effects and unmapped or disabled files do not start this check.

Tests execute real native Write and Edit, observe error and empty publications,
and prove that the next model requests receive both contexts with exactly two
approvals and two effects. A separate prompt observes a publication that
arrives after the saved snapshot. Crash, silent-server and disabled cases are
covered. Before each model step, the host checks the content digest of the last
observed file per existing server/agent/current-directory instance. Bash/editor
changes to that file invalidate stale diagnostics and trigger a fresh bounded
check; deletion produces an unavailable notice and restoration is rechecked.
This has a total two-second budget and does not watch or scan arbitrary workspace
files. A newer observed document replaces the previous observation.
