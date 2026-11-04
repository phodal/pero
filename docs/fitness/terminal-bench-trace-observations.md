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

`polyglot-c-py` ends normally after 15 requests. Its own Python/C checks
succeed, but it leaves the self-test binary `cmain` next to `main.py.c`.
The official verifier rejects the extra file before reaching functional checks.
The required single-file output set needs a final directory-content check or
scratch compilation outside that output directory. This is an artifact-set
failure, not a failed compiler invocation. The original reward remains zero;
removing the binary alone has not been shown to pass the remaining checks.
Source/result/instruction/verifier hashes and the relevant call seqs are in
`analysis-polyglot-output-set.json` under the artifact root.

`password-recovery` observes two password fragments but labels the suffix a
decoy. It submits an 11-character prefix despite the explicit 23-character,
prefix/suffix constraints and permission to submit multiple guesses. Inspection
of the unchanged environment setup after this attempt confirms a fragmented
ZIP. Tool observations were available; the candidate's hypothesis and final
constraint check fail. This does not establish a tool protocol defect.

`count-dataset-tokens` submits a count that includes system/user/chat-template
overhead. The requested measure is DeepSeek reasoning and solution tokens; the
reference solution tokenizes those two metadata fields independently. Its
numeric official check fails. The trace shows alternative counts, but does not
validate that its chosen measure matches the requested quantity.

`feal-differential-cryptanalysis` ends normally after 331 responses and explicitly
reports an unimplemented skeleton. The official invocation reaches
`NotImplementedError`. Its 34,712,781 recorded tokens identify expensive
unsuccessful exploration; that alone does not establish provider or tool
malfunction. Source hashes and final native seq/line evidence for these three
cases are in `analysis-normal-end-followup.json`. Reference/setup inspection is
post-run analysis; no task-specific answers are added to runtime prompts.

`pypi-server` exposes a process-lifetime mismatch. Its wheel and source installs
pass in the agent's own checks; seq 2407 observes HTTP 200. After the normal
turn ends, seq 3032 records the exact managed server task terminated with
`aborted: true` and `context canceled`. The official later install cannot
connect. Managed Bash jobs end with their agent/session; a durable task ID does
not establish an independently persistent service. The current declaration now
states that lifetime and points requested persistent services to an environment
service manager or daemon. Original reward zero remains unchanged; a separate
current-code acceptance is pending. See
[the guidance issue](../issues/2026-11-05-background-service-lifetime-guidance.md)
and artifact `analysis-pypi-service-lifetime.json`.

## Sanitizer correctness and verifier assumptions

`reshard-c4-data` has raw reward zero with two independent failure layers.
Its last self-test (seq 28168) fails with `FileNotFoundError` and unequal output
files. The next provider request ends with a generic stream transport error;
the underlying transport cause is unrecorded. There are 75 HTTP attempts and
74 committed responses, totaling 2,533,077 recorded tokens. The unfinished
request has unknown usage.

The official test then errors during fixture setup: Hugging Face network/TLS
requests fail, and held-out shard 00009 has no cache. Functional assertions
never run, although CTRF maps the error to one failed test. This does not make
the candidate correct or change its raw zero reward. Source-bound evidence is
in `analysis-c4-verifier-setup.json`; both final exports now expose verifier
stages separately. The actual 51-completed-stdout control finds 50 ordinary
pytest summaries and this one setup error. See
[the reporting issue](../issues/2026-11-05-benchmark-verifier-fixture-classification.md).

`configure-git-webserver` has a separate login-fixture assumption. The instruction
uses `user@server` and says the operator will arrange login. The candidate
configures the literal `user` account and reports its own successful real-SSH
end-to-end check. The unchanged verifier instead hardcodes `git@localhost` with
password authentication, without creating that account. Its retained output
reports HTTP 404. This exposes an unstated account requirement; truncated
verifier output does not independently establish the precise SSH failure or
prove the whole deployment correct. Reward zero remains unchanged. Evidence is
in `analysis-git-webserver-login-assumption.json`.

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
