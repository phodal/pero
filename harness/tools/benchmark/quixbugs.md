# QuixBugs Python repair sample

[QuixBugs](https://github.com/jkoppel/QuixBugs) contains 40 small algorithm
programs with defects. This runner fixes six Python programs: `bitcount`,
`find_first_in_sorted`, `flatten`, `lis`, `next_permutation`, and
`shortest_paths`. They exercise arithmetic, search, recursion, dynamic
programming, permutations and graph paths. This is a small integration sample,
not the full benchmark or evidence of repository-level repair performance.

The fixed upstream revision is `4257f44b0ff1181dedaedee6a447e133219fcebf`.
Use a separate Python environment for the unchanged upstream tests:

```sh
git clone https://github.com/jkoppel/QuixBugs /absolute/QuixBugs
git -C /absolute/QuixBugs checkout 4257f44b0ff1181dedaedee6a447e133219fcebf
uv venv /absolute/quixbugs-venv
uv pip install --python /absolute/quixbugs-venv/bin/python pytest==8.4.2 pytest-timeout==2.4.0
go -C harness/go build -o /absolute/pero-agent-acp ./cmd/pero-agent-acp

/absolute/quixbugs-venv/bin/python harness/tools/benchmark/run_quixbugs.py \
  --benchmark /absolute/QuixBugs --binary /absolute/pero-agent-acp \
  --output /absolute/results/quixbugs-prepare --prepare-only --defer-tool-loading
```

Every selected buggy baseline must fail a collected test and every reference
must pass all tests, with no skips. The tests, conftest, data loader and JSON
cases are copied unchanged into separate judges. A JUnit XML report supplies
counts; nonzero exits, timeouts, collection errors and empty suites cannot pass.
Each test has a three-second timeout; a judge process has a 180-second cap.
On Python 3.9.6 the fixed six-program preparation collected 46 tests: every
buggy program failed and every reference passed, with no skips or collection
errors. Some buggy baselines intentionally time out.

Supply the existing `DEEPSEEK_API_KEY` through the caller's environment and run
the same command with a **new output directory**, without `--prepare-only`.
The runner itself does not read `.env`. Defaults are `deepseek-flash`, disabled
thinking, provider-default sampling, serial execution, 32 HTTP attempts per
problem, 8,192 maximum output tokens per request and no HTTP retries. Add
`--defer-tool-loading` for ToolSearch; eager declarations remain the default.
The existing ACP client enforces 900-second Session and 240-second idle limits.

Only the original buggy source and a neutral README enter the workspace. The
source includes the upstream specification and examples. Official tests and
references stay outside that workspace. Each workspace is created in an
unrelated temporary directory, so its parent contains no judge or reference.
The neutral plugin has no task-specific skills, hooks or workflow. This runner
uses the current auto-review shell policy **without an OS sandbox**: directory
placement does not enforce filesystem or network isolation. Audit actual tool
accesses before interpreting results. The public tasks can also have appeared
in model training data.

The runner shares ACP execution and snapshot/report logic with
`run_benchmark.py`. It freezes and judges the first normal submission, then
allows at most one same-Session repair with the unchanged official failure
output. An incomplete end-turn or failed cleanup cannot pass. Failed attempts
and raw traces remain preserved. Each task gets an automatic Session summary;
the aggregate report includes usage and tool/process failures. Diagnostic
findings never change the independent judge's verdict.

Outputs record dataset and Pero commits, binary and both runner source hashes,
dependency versions, exact workspaces, validation, frozen code/diffs, receipts,
native Session JSONL and HTTP attempt counts. Rerun the tracked script from the
matching Pero checkout; the saved source snapshots retain provenance and do
not copy the sibling ACP/report dependencies. `--prepare-only` returns before
credential access or agent launch. Workspaces are retained for audit and are
listed in `*/validation.json`.
