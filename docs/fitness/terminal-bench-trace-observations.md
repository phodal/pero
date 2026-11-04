---
kind: analysis
status: running
date: 2026-11-04
---

# Terminal-Bench: completed-trial trace observations

These observations concern completed trials in the still-running
[89-task suite](terminal-bench-full.md). They do not establish a full-suite
score, a prompt improvement or token savings. The official inputs and verdicts
remain unchanged.

Source-bound evidence is under the full-04 artifact root documented there:
`analysis-normal-end-failures.json`, `analysis-context-growth.json`, and
`reviews.json`. The first retains result, native journal, instruction and
verifier hashes for four normal-end failures.

## Task completion and tool execution

`fix-git` finds the lost commit and starts the requested merge, then asks which
biographical text to retain. It leaves `_includes/about.md` conflicted. The
official verifier passes the layout file and fails the about-file hash. All
recorded shell invocations return zero: the real merge prints `exit=1`, but
later `echo` and `git status` commands mask it. A hash-bound review marks that
merge attempt failed. An earlier `git merge-tree` conflict preview is marked
separately as an intentional diagnostic, not a failed validation.

This is a completion failure even though the tool protocol and shell exits
look successful. A separate evaluation could test explicit noninteractive
benchmark guidance. The existing run does not establish that the clarification
is caused solely by missing prompt text or that such guidance improves results.

`extract-moves-from-video` makes three tool calls: tool discovery and two
environment inspections. It finds `curl` but does not attempt a download or
create `/app/solution.txt`. Its final response claims no download capability
and separately declines transcription. Both official tests fail because the
file is absent. Retrieval, network availability and dependency installation
were not exercised; absent `yt-dlp` and `ffmpeg` alone do not verify those
capabilities are unavailable.

`extract-elf` chooses eight-byte, 64-bit words, despite example addresses
advancing by four bytes. Its final response acknowledges the unverified word
size assumption. The verifier reports 45 incorrect values, violating the
no-incorrect-address condition. One explicit failed call is a scratch C link
with duplicate globals; that failure does not establish the cause of the
submitted extraction mismatch.

## Sanitizer correctness and verifier assumptions

`filter-js-from-html` ends normally but fails both official tests. Its XSS
failure remains a correctness failure. Its clean-HTML failure also exposes a
separate oracle inconsistency: the instruction requires preserving formatting,
but `tests/test_outputs.py:553` standardizes only the original input through
BeautifulSoup, then compares it with unnormalized filtered output after removing
spaces and newlines. Captured comparison pairs show entity decoding, sorted
attributes and changed void-element syntax on the normalized original side.
Literal preservation can therefore fail this comparison for those inputs.

This is not evidence that the sanitizer is secure, that every clean-sample
failure comes from the oracle, or that its reward should be changed. The
original official tests and reward zero remain recorded.

## Context growth

The context-growth artifact is a 20-completed-task snapshot, not final totals.
For `circuit-fibsqrt`, 502 responses cumulatively carry 90.35 MB of retained
tool-result messages, compared with 1.03 MB of unused tool schema exposure.
Its largest recorded request reports 294,380 input tokens. The pinned launcher does not
set a context window, so automatic compaction is disabled in this cohort.

These byte measurements identify accumulated history as a concrete candidate
for a separate compaction evaluation. They do not measure causal token savings
or show that smaller context preserves correctness. Recorded tokens include
cache reads and do not constitute an invoice.
