---
kind: verification_report
---

# Coding benchmark follow-up

2026-11-04, macOS arm64. Four further tasks ran through the real ACP agent
with DeepSeek Flash: the previously budget-exhausted Polyglot React exercise
and three new QuixBugs repairs. All four final submissions passed their
unchanged official tests. This is a diagnostic sample, not a leaderboard or
a controlled measurement of savings.

## Source and protocol

The binary came from clean commit
`8f79a53fc38d32894584e7df65df81bb5d297b01`; Go build metadata recorded
`vcs.modified=false`. Its SHA-256 was
`110086e4198a17cc2590f07525af4d6c31247b7139aa85104103bcb3c1bf802a`.
Dataset revisions and model settings match the preceding
[Polyglot](coding-benchmark.md) and [QuixBugs](quixbugs-benchmark.md) records:
disabled thinking, provider-default sampling, deferred tools, serial execution,
8,192 output tokens per request and no HTTP retries. Each task allowed at most
one repair in the same Session using official failure output. React retained
its 64-request budget; each new QuixBugs task had 32 requests.

Two runner fixes preceded this sample. The unittest judge now requires a
nonempty suite without failures, errors or skips. Its acceptance table runs
five real subprocess cases. Polyglot now places each agent workspace in an
unrelated temporary directory and retains the path in validation metadata,
matching QuixBugs. Preparation revalidated all 91 Polyglot reference tests and
27 tests for the three new QuixBugs references; every skeleton/buggy baseline
failed. Directory separation does not provide an OS sandbox.

## Results

| Task | First submission | Final submission | HTTP attempts | Recorded tokens |
| --- | ---: | ---: | ---: | ---: |
| Polyglot react | 7/14 | 14/14 after feedback | 43 | 799,043 |
| QuixBugs shunting_yard | 6/6 | 6/6 | 11 | 57,441 |
| QuixBugs mergesort | 14/14 | 14/14 | 13 | 58,421 |
| QuixBugs kth | 7/7 | 7/7 | 11 | 50,397 |
| Total | Three of four tasks | Four of four; 41 official tests | 78 | 965,302 |

The four native Sessions contain 78 committed responses and 78 paired tool
calls. Recorded usage is 48,598 uncached input + 893,184 cache-read + 23,520
output tokens. Every observed HTTP attempt has committed usage; all agents
closed with exit 0 and successful cleanup. These counters are not an invoice.

The preceding React run exhausted 64 requests with 1,266,005 recorded tokens
and no second submission. This run completed in 43 requests with 799,043 tokens.
Stochastic behavior and the changed workspace protocol prevent attributing the
difference to one fix or claiming a repeatable token reduction.

React's live ToolSearch selected `Read,Write,Edit,Bash,Glob,Grep` in one call,
returned all six without a continuation offset, and was followed by successful
Write calls. This exercises the exact-selection default beyond five tools;
it does not measure that change's token benefit.

## Trajectory review

The automatic report found two explicit failed calls and three successful-exit
validation candidates. Independent reviews bind all three candidates to the
original Session hash, result sequence and owner-result stdout hash. Two are
unsuccessful local checks; one is an empty suite without an implementation
failure. The counts are not independent implementation-defect counts.

- React piped two unsuccessful unittest executions into `tail`, producing
  outer exit 0 despite `FAILED` output. It also spent many calls building and
  revising self-tests before submission. The first official judge exposed an
  API assumption: callbacks received a cell object instead of its new scalar
  value. Feedback enabled the repair. A later failed self-test was corrected
  without another implementation edit, showing why self-test expectations
  need review; editing a local oracle is not itself proof of a bad repair.
- Mergesort's local check caught a remaining recursion base-case bug after
  the initial patch. Its subsequent edit and official tests passed.
- Kth repeated `cd python_programs` after the shell had already changed there.
  That call failed before creating its proposed `/tmp/_new_kth.py`; the later
  workspace-local write succeeded. This is an attempted out-of-workspace
  write, not evidence that the file was created.
- Shunting yard's independent checks passed, but its doctest ran zero tests.
  The report preserves that lack of coverage without calling it a defect.
- The three new tasks each made an empty ToolSearch query before recovery.
  Exact-name pagination does not solve vague discovery queries. React also
  inspected workspace `.pero` internals, an avoidable detour.

Recorded calls show no official-test/reference read or external search in
these four tasks. Shell results explicitly report no filesystem/network
isolation, so the trace review cannot establish enforced isolation. The earlier
samples' procedure and official-test coverage limits remain applicable.

## Verification and CI

The full Go harness race suite passed in 35 packages and `go vet ./...` passed.
Plugin validation accepted all 14 configurations in openstar-agents. A separate
66-check evidence audit verified 40 byte-identical official test/support
copies, five frozen solution/judged-file pairs, source/binary/runner hashes,
usage recounted from native messages, prior raw traces unchanged, credential
exclusion and process cleanup. The reviewed Inspector export retains all four
Sessions and keeps automatic findings separate from manual verdicts.

At head `8f79a53f`, GitHub's Go, Harness Go and standalone Harness Bazel checks
passed. The overall CI gate remained red: five Paper fixture checks failed in
the fast job, and a Paper PDF source assertion failed in Linux core. The run
tested merge `980e77096ec8ca1081d9ed92af74b3ab789f95c1`, based on master
`2b84243e2b9b89a42fdab673b2324da2aac32cdb`. An extracted snapshot of that
base, without this PR, reproduced all six failures with the same errors and
no skipped tests. The affected production/test files have no changes in this
PR. This verification does not claim a green repository-wide gate.

CI evidence: [fast job](https://github.com/phodal/pero/actions/runs/41769976331/job/126377125916)
and [Linux core](https://github.com/phodal/pero/actions/runs/41769976331/job/126377125748).
Full local evidence is under `reports/coding-benchmark-2026-11-04` in the
analysis workspace: `pr116-followup/react-deferred-02`,
`pr116-followup/quixbugs-extra-deferred-01`, `pr116-followup/verification.json`
and the separate `automated-summary/pr116-followup/reviewed` Inspector export.
Raw traces, credentials, binaries and generated HTML are not committed.
