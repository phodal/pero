---
kind: issue
status: active
date: 2026-11-05
---

# Compaction republishes skills still present in retained context

The fixed deferred five-phase provider fixture repeatedly reads the same ledger
specification instead of implementing it. Before its first phase completes,
the trace contains 15 successful compactions and repeated full skill-content
messages. PostCompact currently restores every historical skill without
checking whether its instructions remain on the active surface. This grows
context and presents the skill's first-read instruction as a fresh user message.

The diagnostic is intentionally stopped and retained in long-fixed/ with its
operator-stop receipt. This is separate from the official benchmark queue.

Restore only activated skill content that is absent from the current surface.
Correlate the exact selected name/digest/arguments and, for Skill-tool loading,
the successful content-bearing result. A short activation notice alone cannot
prove that full instructions remain visible. Existing bounded reattachments
can satisfy visibility without reexecuting preprocessing or renewing grants.

## Implementation and verification

Restoration now checks current surface identity for original full content or
an earlier bounded reminder. Successful Skill-tool results use their content
seq; a retained short activation notice alone still restores missing content.
The reminder explicitly continues checkpoint progress. Race tests cover exact
arguments/digest, retained original/reminder, correlated content versus notice,
and two actual compactions with only one restoration. Skills/CLI Bazel, vet and
Gazelle pass.

The stopped native fixture records 29 HTTP attempts, 28 responses, 18 accepted
compactions, 10 tool calls and six identical repeat calls, with no explicit tool
failure. It records 513,570 tokens; the cancelled final compaction has unknown
usage. Process cleanup exits zero. These are diagnostic failure receipts, not a
successful task or token-saving comparison. A fresh combined acceptance follows.
