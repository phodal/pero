---
kind: issue
status: resolved
date: 2026-11-06
---

# Official ACP source receipts drift after session titles

PR #139 merge CI run `42189089741`, job `127796391822`, extracts fourteen
selected official DSH references and rejects three source receipts. The merged
master adds opt-in session-title generation in `harness/go/acp/prompt.go` and
its configuration in `server.go`, changing both files' hashes. The mapping
still pins their earlier bytes. This is source-admission failure, not evidence
of changed prompt cancellation or settlement behavior.

Review the exact `e8105250` changes before refreshing these receipts. The prompt
now starts optional title generation after successful turn settlement; the
mapped notification handler is unchanged. Retain the pinned official revision,
all seventeen selected pairs, all landmarks and exact file-hash checks.

## Resolution and verification

Refreshed only the three affected right-side receipts and their source label.
The original mapping reproduces fourteen extracted / three hash mismatches.
The updated mapping extracts all seventeen pairs against archived files from
pinned official revision `f3803c96974ad4a94195fb97e5c637e9c2a3afe3`.
Both sides verify their exact hashes; all four ACP admission/cancellation/
settlement landmarks remain observed. All eighteen AST tests pass without
skips using the pinned parser packages and existing extended grammar. This
restores source admission for review and does not establish semantic parity.

## MCP Apps recurrence — 2026-11-13

PR #217 head `c1bea070b` fails DSH AST CI job `131756063448`: fifteen
selected pairs extract and two are unavailable. Both unavailable selectors
(`mcp-tool-capability` and `mcp-structured-output-gap`) pin the containing file
`harness/go/mcp/tools.go`; no ACP prompt/server receipt is stale this time.

Commit `fef46c64f` adds the declaring Tool resource URI/generation and captures
the original MCP App result in `buildMCPAudienceTools`. It changes the file hash
from `daad09cb13d244952bd90683fd866908d2931358d8259b15eb3e27226cdd9045` to
`117220e70a7701892c3a44e1ba3a30a59367f04ebd950079e391d1ea54ba8e0d`.
The mapped `ListTools` capability guard and `fromMCPResult` converter are
unchanged. This is another exact-source admission failure, not an AST finding
that the selected functions changed behavior.

Review those changes before refreshing only the two containing-file receipts
and the right-side snapshot label. Retain the official pin, all seventeen pairs,
selectors, landmarks, parser checks and exact hash admission. Reproduce the
fifteen/two failure against a read-only exact-pin official source copy, then
verify all seventeen extracted and all eighteen parser tests without skips.

### MCP Apps resolution and verification

The unchanged mapping reproduces fifteen `cross_language_review_required` pairs
and two `source_hash_mismatch` selectors, exit 2. Refreshing only those two
right-side file receipts and the snapshot label restores seventeen extracted,
zero unavailable, exit 0. Every selected left/right file verifies its exact
hash; both MCP landmarks remain observed on both sides. No pair, selector,
landmark, parser behavior or source-admission rule changed.

Tree-sitter confirms the selected callable text is byte-identical before and
after `fef46c64f`: `ListTools` SHA256 is
`00daa0624082dc9e83f70efe61c8248e3ef48a1241d6d88a61c60a47288b07ef`;
`fromMCPResult` SHA256 is
`3baa243d77f55dbbb90944b5aaf78908168d3da10ecc8f6301b42bb57497ba00`.
Only their containing file acquired the new metadata/capture integration.

All eighteen AST tests pass without skips on macOS arm64 / Python 3.14.7,
using the pinned parser requirements, Tree-sitter CLI 0.25.10 and the existing
`0.23.2+pero.export-type-star.1` grammar extension. The eleven official source
files were archived with read-only `git show` at the unchanged official pin
and individually hash-verified; the user's newer official checkout was not
modified. Before/after reports are retained locally as
`/tmp/pero-mcp-dsh-{before,after}.{json,md}`. This repairs source admission for
review and does not establish semantic equivalence. Hosted CI must still
validate the final published revision.
