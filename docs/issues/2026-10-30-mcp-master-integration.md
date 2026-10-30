---
kind: incident
status: resolved
github_issue: 50
github_state: open
github_url: https://github.com/phodal/pero/issues/50
---

# Preserve MCP settings and source views across master integration

PR #53 head `a92cdcb` passed all 16 CI jobs and 18 headed UI checks against
master `67c5e3b`. Master then advanced to `d03ddef`, adding reader panes,
workspace recovery, icon themes and MCP Apps. Eight files conflicted; the earlier
green run did not certify this new combination.

## Resolution

- Preserve master's root Host `mcp.rs` provider unchanged. Move the Agent
  manager's settings implementation unchanged to `mcp_settings.rs`.
- Keep `mcp-servers.json` source-view configuration independent from per-Agent
  `local_mcp` preferences. No grant or credential migration is implicit.
- Union both protocol families and regenerate contracts. Preserve master
  definitions, event arms, translations, reader/pane lifecycle, icon settings
  and focus recovery; retain MCP settings and interrupted-request recovery.

## Build defects exposed by integration

The new source-addressed Kit copy lived below the outer Cargo workspace's
`target` directory. Cargo auto-enrolled its path dependencies and looked for
Kit's inherited dependencies in Pero's workspace. Both a synthetic offline
reproduction and the real Host build failed with the missing `anyhow` error.
A first integration candidate moved the copy to a user cache. Master then
independently added the simpler root workspace `exclude = ["target"]` correction;
this integration adopts that single canonical fix and restores master's cache
implementation unchanged. A focused regression reuses the real workspace rule
and verifies patch application, inherited dependencies, cache reuse/content
invalidation and source immutability; removing the exclusion reproduces failure.

A Windows-style CRLF clone of the pinned Kit also reproduced strict patch
failure. An LF clone applied both patches with the canonical fingerprint. CI
now sets `core.autocrlf=false` for this isolated dependency checkout before
checkout; patch matching is not relaxed and the original developer Kit is never
rewritten by the build.

## Local verification

- Complete Wasm (including reader/content worker), web, Desktop and fresh Host
  builds passed; type/generated/locale/icon checks passed.
- Rust contracts/runtime/Host: 47/58/3 tests passed. The full existing Rust
  aggregate also passed.
- Real Host protocol and MCP configuration acceptance passed. The new ownership
  regression checks both Host routes, unknown-thread denial, a real Node panel,
  independent same-named configuration and graceful Host/provider shutdown.
- Existing MCP Apps real loopback/official SDK bridge tests passed.
- Actual sandboxed headless MCP UI: 18 checks passed; unchanged master icon-theme
  UI: 5 lifecycle checks passed. Screenshots were inspected.

The source conflicts and reproduced build blockers are resolved. Exact-head
three-platform CI and headed acceptance are still the publication gate; their
final receipt is recorded in the PR. No merge to master is performed by this
integration commit, and no production MCP credentials or model calls are used.

## Latest master follow-through

Before publication, master advanced to `68f52a8` with built-in Harness settings,
read-only reader changes and chat fixes. Preserve its encrypted provider store
and form independently from MCP settings. Both `save_harness` and `save_mcp`
retain unrelated preferences. The Settings section taxonomy was extracted by
concept to keep the combined view below 1000 lines; no secrets were added to
MCP diagnostics. Go is explicitly provisioned in Desktop CI now that a full
Desktop build includes the bundled harness. Final combined checks are rerun
against this newer parent rather than reusing the `d03ddef` receipt.

The latest combined rebuild and complete Rust/Bazel checks passed. Actual safe
headless MCP acceptance again passed all 18 checks. Master intentionally removed
Ctrl+O file editing; the icon acceptance fixture now admits its read-only source
through the real Host document route instead of restoring that removed shortcut.
All five icon lifecycle checks passed. Built-in Go readiness was checked only
with a synthetic key and isolated loopback endpoint: zero provider requests or
messages. The natural unavailable secure-storage form rejected saving as expected;
this is not an encrypted-persistence or real-provider acceptance claim.

## Integrated CI fixture follow-up

The first integrated CI run `41026137382` stopped before UI acceptance because
its reduced icon-generator fixture omitted master's new `content-icons.mjs`
input. The fixture now includes that helper and association data, and checks all
five generated outputs rather than only the original two. The three new outputs
also retain LF checkout bytes; the new Rust association formatter explicitly
uses Unix line endings, matching the established generated-byte contract.
The Kit regression creates an isolated LF-configured consumer repository instead
of inheriting Windows machine-wide Git conversion. All 11 build-fixture tests
pass, including simulated Windows checkout defaults; stale-content and CRLF
rejection assertions remain intact.

Master's new default Agent also invalidated the tool-matrix fixture's old Codex
picker coordinate. Fixture preferences now explicitly select the local scripted
Agent, retaining all tool-state assertions and adding Agent identity checks to
both native-window App Use suites. Workbench and all nine tool states passed in
local actual headless Electron. Native-window App Use guards are retained and
must pass in integrated headed CI; no real/default provider is used as a fixture.

A subsequent integrated headed run (`41027691947`, head `488cd7e`) passed core
Workbench and tool-call acceptance but stopped before Product's first App Use
tool request: the frame now contains a render canvas and a 1px native EditContext
input canvas. The old broad Playwright locator matched both. Geometry lookups
now explicitly select the single non-input render canvas; the native-window
guard, selected Agent, scope and all actual tool/effect assertions are unchanged.
The failure artifact confirms an idle scripted Agent and an unsent draft, not a
failed tool execution. Fresh headed acceptance is still required.
