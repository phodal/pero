---
kind: issue
status: resolved
date: 2026-11-04
github_issue: 128
github_state: closed
github_url: https://github.com/phodal/pero/issues/128
---

# MCP Apps can persist a rejected server edit on the next save

Reproduced twice on `c3692afaa5207d95f67322e7aa18996cbe68607a` using the MCP
Apps panel's loopback HTTP API, Node 24.12.0 on macOS, and a fresh configuration
directory per run. All requests were sequential. The fixture configured server
names without connecting to them.

1. Save server A with the title `Original`. Verify the file contains that title.
2. Create a directory at `servers.json.tmp` to force a filesystem write error
   while leaving `servers.json` readable. Change A's title to `Rejected edit`.
   The panel API returns HTTP 400 (`EISDIR`).
3. The panel's `list` immediately returns `Rejected edit` for A. The file
   still contains `Original`.
4. Remove the empty directory and save a different server, B. Without resubmitting
   A, the file now contains A's rejected title. A fresh provider loading the
   same file also lists that title.

In `desktop/src/main/mcp-sources.ts`, the configure handler changes the live
map before it writes and renames the configuration file. The next successful
save serializes that map, including the rejected edit.

Expected: for a definite local write failure, both the provider and subsequent
saves should retain the last successfully saved configuration. Proposed scope
is the MCP Apps configuration owner and a regression covering this sequence.
The per-Agent settings and Harness connection policy have separate owners.

## Local verification

On `1ecd08e2`, the provider regression reproduced the rejected title in the
live catalog. Two simultaneous saves also collided on the shared staging
file. With the local change, the provider publishes each snapshot after its
file replacement succeeds, and a failed save still allows later saves.

The two regression tests and the existing MCP transport and App handshake test
passed on macOS with Node 24.12.0. A separate loopback run against the built
stdio provider forced the write error, saved B, shut down the process, and
loaded the same file in a new process. A retained its original title and B
was present.

The maintainer confirmed the scope in [#128](https://github.com/phodal/pero/issues/128#issuecomment-6647430921).
Rebased onto `f0b8065e` on 2026-11-09. All eight standalone/managed MCP tests,
targeted TypeScript checks, the MCP provider build and the two-process
write-failure/reload check passed. The fixture bundle uses a temporary checkout
without spaces because its existing entry-point conversion retains URL escapes.

## Status reconciliation — 2026-11-11

GitHub #128 is closed as of 2026-11-09. The configuration publication repair
is present on the current mainline in `ac3d46fe`; the existing rejected-save
and overlapping-save regressions also passed during the November 11 MCP
verification (14 tests including the separate #185 increment). Both persistence
regressions were also rerun directly on the `561e2850` mainline checkout and
passed with `node --test --test-name-pattern='a rejected server edit|overlapping server saves' desktop/src/main/mcp-sources.test.ts`. This record
is resolved for its configuration-persistence scope, not a new platform or
release-package acceptance claim.
