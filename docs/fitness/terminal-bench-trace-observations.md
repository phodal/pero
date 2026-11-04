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

`sanitize-git-repo` ends normally after 35 responses and 1,887,041 recorded
tokens. Both secret-removal and exact placeholder-replacement checks pass.
The candidate also runs `git filter-branch`, expires reflogs and prunes objects;
the instruction does not explicitly request rewriting history. The third test
resolves a hardcoded original commit in the candidate repository, which is now
missing, so it never compares the other paths. The comparison assumption and
extra cleanup are separate from replacement correctness. No independent full
comparison proves the other files unchanged, and raw reward zero is retained.
Source hashes and call seqs are in `analysis-sanitize-history-reference.json`.

`reshard-c4-data` has raw reward zero with two independent failure layers.
Its last self-test (seq 28168) fails with `FileNotFoundError` and unequal output
files. The next provider request ends with a generic stream transport error;
the underlying transport cause is unrecorded. There are 75 HTTP attempts and
74 committed responses, totaling 2,533,077 recorded tokens. The unfinished
request has unknown usage.
The current adapter now preserves fixed safe labels for standard typed network
failures in future turn errors. Provider race/Bazel and real loopback truncated
HTTP checks pass; the historical error remains unclassified. See
[the diagnostic fix](../issues/2026-11-05-provider-stream-failure-diagnostics.md).

The official test then errors during fixture setup: Hugging Face network/TLS
requests fail, and held-out shard 00009 has no cache. Functional assertions
never run, although CTRF maps the error to one failed test. This does not make
the candidate correct or change its raw zero reward. Source-bound evidence is
in `analysis-c4-verifier-setup.json`; both final exports now expose verifier
stages separately. The actual 51-completed-stdout control finds 50 ordinary
pytest summaries and this one setup error. See
[the reporting issue](../issues/2026-11-05-benchmark-verifier-fixture-classification.md).
A later read-only host/guest DNS and TLS control reproduces the guest failure
and succeeds in the same guest with a host-resolved IP and normal TLS. Its
hash-bound receipt is `hf-dns-control/receipt.json`; runtime configuration and
the original reward remain unchanged.

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

## Later partial checkpoint: failure and token concentration

The closed 59-task snapshot records 702,677,790 committed tokens. Its ten most
expensive tasks account for 77.4% of that total. The largest reported input is
367,640 tokens in `path-tracing-reverse`; context capacity was not declared, so
these measurements do not establish context-window occupancy or a provider
capacity limit. Cache-read tokens are 695,309,943 of 700,360,177 reported prompt
tokens. Token volume therefore must not be presented as uncached use or cost.

Across 7,150 measured prepared requests, payloads total 2,230,763,347 bytes and
retained tool-result messages total 1,094,983,259 bytes. Repeated schema exposure
is 48,821,390 bytes, including 17,655,851 unused-schema bytes. These are distinct
wire/context byte measurements, not a token-savings estimate. They support
prioritizing a separately controlled history/compaction evaluation over further
schema trimming. The original full-suite configuration remains frozen.

The report contains 473 explicit failed calls: 449 Bash, ten Write, eight Read,
three TaskOutput, two Edit and one TaskStop. Ten separately reviewed Bash
validation failures have shell exit zero. Nonzero diagnostics may be intentional;
these counts do not establish 473 harness defects. Twenty-one raw-zero tasks end
normally, including the two QEMU tasks whose verifiers do not execute functional
checks. Neither a normal end nor a zero shell exit proves task completion.

`partial-baseline-59/failure-audit.json` joins the reviewed native report with
raw results, retains source/result hashes and excludes active correction runs.
A separate receipt scans that supplementary report for the configured credential
without printing it. Five Read calls target `/tmp` files outside `/app` and get
a misleading plugin-only error. The denial and authority remain correct; see
[the diagnostic repair](../issues/2026-11-05-read-scratch-scope-diagnostic.md).

## Separate unlimited-step DNA correction

The frozen strict binary runs `dna-assembly` for its official 1,800-second agent
limit. It records 444 completed responses, 63,590,889 tokens and 22 explicit
failed calls; the result remains raw zero. Its official test fails because
`/app/primers.fasta` is absent. The exact-process SIGTERM receipt confirms the
agent is stopped before verification, and the timing audit reports no late
agent activity. This is an output-completion failure after a separately recorded
correction, not another hidden step-cap stop. The original 512-response result
and its hashes remain unchanged. Source-bound analysis is
`strict-timeout-followup/dna-early-analysis.json`; full-suite completion and
aggregate comparison remain unavailable.

The paired Scheme correction runs for its official 2,400-second agent limit
and reaches 686 committed responses, exceeding the former 512 ceiling. It
records 96,524,616 tokens and nine explicit failed calls. Its aggregate official
test still fails with `failed == 62`. Exact-process termination is confirmed
before verification, with no late response, call or result observed. This is a
remaining evaluator-correctness failure; cap removal does not establish a task
success improvement. `strict-timeout-followup/scheme-early-analysis.json` binds
the sources. The separate `early-results/` Inspector contains both corrections
(1,130 responses, 160,115,505 recorded tokens, 31 explicit failed calls), labeled
as two corrections while the full 89-task suite remains unfinished. Its Scheme
view is visually checked: 686 model calls, 96.5M processed tokens, 99.8% input reuse
and context occupancy unavailable. These metrics do not imply cost or capacity.
