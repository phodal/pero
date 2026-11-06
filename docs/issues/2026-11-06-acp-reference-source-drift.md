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
