---
kind: incident
status: resolved
github_issue: 185
github_state: closed
github_url: https://github.com/phodal/pero/issues/185
---

# MCP panel request decoding corrupts split Unicode

At `b1b95293`, `McpHost.servePanel` appends each request Buffer to a string.
When a Chinese or emoji character spans reads, each fragment decodes separately
and produces replacement characters. The JSON remains valid, so configuration
returns HTTP 200 and persists the corrupted title.

The request body belongs to the HTTP entry point: accumulate raw bytes under
the existing 16,000,000-byte limit, then decode once before the existing JSON
and command validation. No source configuration or session ownership changes.

## Verification scope

Use the actual McpHost loopback `/api`, isolated temporary configuration files,
and synthetic server configuration without connecting to an external server.
Compare both returned and persisted `数值实验🧪` for a complete request and
splits after the first byte of `数` and `🧪`. Send the remainder only on the
server's first data event, without a timed pause. Also check acceptance at
16,000,000 bytes and rejection at 16,000,001 bytes with no persisted effect.

## Local result — 2026-11-11

Implemented on `codex/fix-mcp-panel-utf8`, based on `b1b95293`:
raw Buffer chunks are counted before accumulation and decoded together once.
The error and limit remain unchanged. The regression table lives in the existing
`mcp-sources.test.ts`, which is already run by CI.

- On the unchanged implementation, the new table fails for both split cases,
  returning `���值实验🧪` and `数值实验����`; complete and limit cases pass.
- With the fix, all five scenarios pass. All three delivery forms return and
  persist exactly `数值实验🧪`; 16,000,000 bytes succeeds and 16,000,001 bytes
  returns HTTP 400 without creating a config file or changing the live catalog.
- `node scripts/build/mcp.mjs` passes.
- `node --test desktop/src/main/mcp-sources.test.ts desktop/src/main/mcp-session-sources.test.ts`
  passes 14/14, including the built sidecar's duplex-stdio check and existing
  real MCP transport/official App bridge test (macOS, Node v26.8.1).
- `./node_modules/.bin/tsc --noEmit -p scripts/ci/tsconfig.core.json` and
  `git diff --check` pass. Both changed source/test files remain below 1000 lines.

The first extended run lacked the generated MCP provider in this fresh worktree;
building it and rerunning resolved that setup failure. The root TypeScript
check stops at the absent generated `web/src/reader-wasm/pero_reader_web` module;
the repository's core CI typecheck above covers the changed code.

## Closure — 2026-11-11

The fix is integrated into `master` as `6488b236` (source commit `d0f66145`).
The actual issue acceptance is satisfied: complete, split-Chinese and split-emoji
requests return and persist identical text; the 16,000,000-byte limit remains.
After integration at `7ff7c637`, rebuilt the MCP sidecar and reran the two Node
test files above: 14/14 passed. The core CI TypeScript check also passed.
This record closes #185 with publication of the verified master commits.

Electron rendering, Native GUI and signed packages were not run. No UI code,
real model calls, credentials or external MCP servers are involved.
