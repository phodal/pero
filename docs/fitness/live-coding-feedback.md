# Live coding feedback and read reuse

The native follow-up at `671897f7` retained nine reviewed validation failures
behind zero shell exits. Changed search arguments escaped repetition reminders,
and repeated complete text reads occupied model context again. This follow-up
adapts the scoped read/discovery mechanisms examined in Qwen Code
`6fe83a82457def9ab8daa43bf833b4cfdf192bd2`; it does not copy recovered prompts or
add benchmark-specific rules.

## Runtime behavior

- **Masked validation observation.** Settled Bash/shell output is checked for
  recognizable Python tracebacks and unittest/pytest/doctest/Go failure summaries.
  A zero exit remains zero; `failed` and `isError` remain true process/tool facts.
  `tool/diagnostic.diagnostic.validation_signal` records the observation. A
  deferred user warning follows the complete tool-result batch. Identical visible
  diagnostics warn on occurrences 1, 3 and 6 in the existing 24-operation window.
  Masked observations do not clear earlier failed-command diagnostics. Quoted
  complete output and expected experiments can still match: this is advice to
  inspect evidence, not an acceptance verdict. Individual error words and echoed
  source/assertions are insufficient. Running/uncertain operations are excluded.
- **Complete native reads.** `Read`/`read_file` still read the real file and hash
  actual bytes. Complete output receives a content-bound observation; an identical
  later result may use a shorter reference while a full anchor is visible. The
  encoded replacement, including metadata, must shrink. Explicit offset/limit,
  truncated/partial reads, media, plugin resources and modified presentations
  stay full. This saves context output, not filesystem I/O or tool calls.
  Raw JSONL results and exact `ReadToolOutput` locators remain available. Pruning
  or compaction that removes the full anchor causes restoration before the next
  main request; partial compaction summaries receive content for references
  whose anchors are outside their selected history. Restore/fork use retained
  receipts. Incremental Session surface snapshots avoid copying the complete
  stream log on each request; the decoded cache retains only visible results.
- **Discovery phases.** Sixteen consecutive known native read/search/discovery
  calls produce one attributed reminder to synthesize evidence and identify the
  remaining question. Changing queries count. Other tools or a new turn reset
  the phase. The advice allows continued research and never requires edits,
  changes permission, stops a turn or caps provider requests. Arbitrary MCP
  tools and shell commands are not inferred to be read-only.
- **Reporting.** Offline summaries retain both new advisory kinds and count
  `live_validation_warnings` and `exploration_reminders` separately. Warnings do
  not become failed operations or benchmark verdicts. Existing Better Harness
  export remains available.

## Verification

Seven relevant packages pass Go race tests: tool, harness, nativetools, session,
fstools, native ACP CLI and engineeringprofile. The latter additionally covers
the long review fixture. Final incremental-snapshot/size changes are rerun in
tool/session/harness and the related native/engineering suites. Relevant vet and
standalone Bazel targets cover tool, session, harness, nativetools and
engineeringprofile. All 34 offline Session reporter tests pass.

A real shell fixture runs a failed check followed by `echo $?`: the next model
request receives the warning after both batch results, while the original exit
stays zero. A real native file fixture demonstrates complete-read reuse, forced
range output and detection of an external edit preserving size and mtime.
Value tests cover changing discovery queries, phase resets, encoded-size
boundaries, raw readback, pruned/removed anchors, restore/fork and partial summary
input. No network credentials or hidden evaluator feedback enter these fixtures.

## Frozen native follow-up

Root: `/Users/phodal/workforce/openstar-agents/reports/coding-benchmark-2026-11-04/evalplus-native-20261105-03`.

This uses binary `cb364a60` and the same five public inputs/settings as run `02`:
DeepSeek Flash, no thinking, unlimited provider requests/turn steps, one submitted
candidate per task, native macOS, no Docker. The evaluator, retained positive and
empty controls are hash-checked against run `02`; those controls were reused,
not rerun. Candidate verdicts use the same unmodified EvalPlus v0.3.1 evaluator.
No hidden feedback, repaired candidate or resubmission is used. Benchmark inputs
and source/binary hashes are frozen. All main prompts end normally and cleanup
succeeds; usage coverage is complete, credential-literal checks find zero hits.

| Task | Base / plus | Requests | Tools | Recorded tokens |
| --- | --- | ---: | ---: | ---: |
| 115 | pass / pass | 6 | 5 | 28,918 |
| 116 | fail / pass | 28 | 26 | 272,856 |
| 123 | pass / pass | 8 | 7 | 40,676 |
| 128 | pass / pass | 7 | 5 | 30,201 |
| 129 | pass / pass | 9 | 7 | 47,561 |

| Metric | Run 02 | Run 03 |
| --- | ---: | ---: |
| Pass both test sets | 4/5 | 4/5 |
| Requests | 61 | 58 |
| Tools | 55 | 50 |
| Explicit failed calls | 0 | 1 |
| Reviewed zero-exit check failures | 9 | 2 |
| Recorded tokens | 433,028 | 420,212 |

The token change is -2.96%, including cached reads, across single stochastic
samples and multiple changes; it is not a causal saving or a full-suite score.
New usage is 37,820 uncached input + 367,744 cache reads + 14,648 output. Final
reviews use five responses and zero extra tools.

Task 116 again fails base tests, now after adopting an unsupported fixed-width
32-bit interpretation of negatives. Its one explicit failure is a probe using
`int.bit_count` in an interpreter that lacks it. Two local assertions fail because
its self-test masks positive `2**40` to 32 bits; trailing echo hides their status.
Both results (seq 4218 and 4808) retain `validation_signal=python-traceback`; one
warning is emitted at seq 4220 because the visible diagnostic repeats. The next
assistant tool call (message seq 4395) inspects the assertion mismatch. This
proves delivery and a subsequent diagnostic action, not repaired correctness.

The sample triggers no read-reuse projections or 16-call discovery phase. Their
behavior is established by deterministic/native regressions, not by this score.
After freezing the benchmark, `4767a8e5` reduces local history-copy overhead and
adds the full encoded-size gate; those refinements are test-validated separately
and are not silently attributed to the older benchmark binary.

Retained artifacts: `complete.json`, `comparison.json`/`.md`, original official
`judge/samples_eval_results.json`, native JSONL under `tasks/*/agent/sessions`, two
hash-bound `reviews.json` entries, `all-sessions/summary.json`/`.md`, existing
Better Harness `inspector.html`, `manifest.json` and `final-audit.json`. Session
directories are explicitly redirected; these runs do not use `~/.pero/sessions`.


## Remote integration verification

The PR branch advanced by 38 commits during this work. Integration `953661c0`
merges remote `66066a71` (including #132 compatibility/permission repairs) in an
isolated worktree, preserving the concurrent UI work in the original checkout.
The overlapping loop/batch changes retain both permission interruption and the
new feedback/read projection. All 36 Harness Go packages pass
`GOMAXPROCS=2 go test -race -count=1 ./...`; full `go vet ./...` and a standalone
CLI build pass. Seven standalone Bazel targets pass: tool, session, harness,
nativetools, engineeringprofile, pluginruntime and native ACP CLI. All 34 reporter
tests pass again. Eighteen pinned parser tests pass and all 17 official reference
pairs extract; the two loop-file hashes were refreshed after confirming the
mapped `Agent.runTurn` bytes are unchanged from `66066a71`.

No paid benchmark is rerun after this integration: the five-task results above
remain attributed to their original binary. The isolated integration worktree
is `/Users/phodal/.codex/worktrees/live-feedback-integration/pero`.
