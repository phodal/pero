# QuixBugs program-repair sample

2026-11-04, macOS arm64, Python 3.9.6. Six fixed programs from
[QuixBugs](https://github.com/jkoppel/QuixBugs) were repaired through the real
ACP agent using the [tracked runner](../../harness/tools/benchmark/quixbugs.md).
All six first submissions passed their 46 unchanged official tests. This is a
small algorithm-repair diagnostic, with the coverage and procedure limits below.
Three additional repairs and a Polyglot React rerun are recorded in the separate
[follow-up](coding-benchmark-followup.md).

## Source and protocol

The clean source commit was `df49f5abbfa177ec39373011ab6ef71f586771d6`.
Go build metadata recorded that revision and `vcs.modified=false`; binary SHA-256
was `57d564315c5af70112d251bbb924aab3dd66ef2483ae04b7d7d86fb5fb33f129`.
The dataset revision was `4257f44b0ff1181dedaedee6a447e133219fcebf`, with
pytest 8.4.2 and pytest-timeout 2.4.0. Preparation verified six failing buggy
baselines and 46 passing reference tests, without skips or collection errors.

The run used `deepseek-flash`, disabled thinking, provider-default sampling,
deferred tools, serial execution and 32 HTTP attempts per problem. It allowed
at most one same-Session failure-feedback repair, but none was needed. Each
request had an 8,192 output-token cap and no HTTP retries. Only buggy source
and a neutral README entered each agent workspace. Judges/references were
stored in unrelated directories, outside the workspace's parent.

| Program | First official submission | HTTP attempts | Recorded tokens |
| --- | ---: | ---: | ---: |
| bitcount | 9/9 | 9 | 29,260 |
| find_first_in_sorted | 7/7 | 11 | 50,692 |
| flatten | 7/7 | 13 | 53,220 |
| lis | 12/12 | 6 | 20,560 |
| next_permutation | 8/8 | 7 | 25,471 |
| shortest_paths | 3/3 | 13 | 83,174 |
| Total | 46/46, six programs | 59 | 262,377 |

## Usage and trajectory findings

The six Sessions contain 58 committed responses and 59 matched tool calls.
Recorded tokens are 42,920 uncached input + 204,288 cache-read + 15,169 output.
The extra HTTP attempt followed the bitcount submission: a queued background
completion notice started a new turn, canceled during cleanup before a response
committed usage. Request-level coverage remains partial; these totals are not
an invoice or an estimate of the canceled attempt. All six agents closed
successfully with exit 0 and no remaining benchmark process.

Offline review found four explicit tool/process failures. Nine zero-exit
validation candidates were independently reviewed and bound to source/seq/stdout
hashes: six really were unsuccessful checks; three indicated only empty suites.
Four calls contained an empty doctest suite, one alongside a failed self-test.
Neither count means that many independent implementation defects.

- Bitcount reproduction ran a nonterminating buggy program without a short
  timeout. After 120 seconds it was promoted to background; the model used
  `pkill -f` rather than the owned TaskStop operation. The completion notice
  later triggered the extra, canceled provider attempt. The task took 141.2 s.
- A repeated relative `cd` prevented a check from running. Shell checks also
  used `; echo`, turning their actual failures into outer exit 0.
- Binary-search validation repeatedly parsed trailing source documentation
  incorrectly, after an independent exhaustive check had already passed.
- Flatten's correct one-line patch was followed by several faulty self-tests:
  flattening a generator despite the list-only recursion contract, asserting
  laziness after eagerly constructing a list, and an undefined variable.
  These failures drove repeated checks and 53,220 tokens, without another
  implementation edit.
- One ToolSearch query returned nothing; its recovery used nonexistent names
  `read_file,list_dir`, loading only Bash. Exact-selection pagination is fixed,
  but it does not resolve guessed aliases or guarantee good tool choice.

The extended offline reporter flags empty unittest/doctest/pytest suites as
review candidates. The original run-time summaries and raw Sessions remain
unchanged; the reviewed export was generated separately. Its 18 behavioral
tests pass. The exact-selection change passed native race tests and vet; trial
tests also passed (18). This six-task sample selected at most four exact names and
does not measure the token benefit of returning more than five names.

## Coverage and procedure limits

Shortest paths passed three official tests but still raised `KeyError` on
`source='A', edges={('A','B'):1, ('C','D'):1}` and on
`source='B', edges={('A','B'):3, ('A','C'):3}`. A separate offline probe confirmed
the same exceptions in the unchanged upstream reference. Both graphs have no
negative cycle; their outgoing-only nodes expose missing graph-node coverage.
These supplemental probes do not change the official score.

Two tasks wrote scratch scripts to `/tmp` despite instructions to keep them
inside the workspace. Recorded calls show no official-test/reference read or
external search, but execution had no OS sandbox. The six official passes
must not be described as six fully procedure-compliant runs. Public algorithms
may also have appeared in training data. Their token totals cannot be compared
as savings against the different Polyglot tasks and budgets.

Further work should prioritize check counts/status, self-test oracle quality,
bounded reproductions and owned process control, and a visible remaining
request budget that leaves room for submission. Repository-level evaluation
needs stronger isolated judges. SWE-bench was considered, but the local Docker
daemon was unavailable; no SWE-bench result is claimed.

Full local evidence is retained under `reports/coding-benchmark-2026-11-04`:
`QUIXBUGS.md`, `runs/quixbugs-flash-deferred-01`, the separate
`automated-summary/quixbugs/reviewed` Inspector export,
`quixbugs-extra-contract-probe.json` and `quixbugs-validation.json`.
Twenty checks passed, including 69 byte-identical official test/support copies,
source/binary/runner hashes, usage recount, preserved prior Sessions, credential
exclusion and process cleanup. Better Harness remains unchanged.
