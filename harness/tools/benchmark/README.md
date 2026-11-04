# Aider Polyglot Python sample

Run four fixed Python exercises through the existing Pero ACP trial client:
`forth`, `react`, `rest-api` and `zipper`. This is a small integration sample,
not a full Aider leaderboard result. The runner uses Python's standard library
and the sibling [trial client](../trial/README.md); its current execution path
requires macOS or Linux.

The benchmark, binary and new output directory are explicit inputs. Pero's
repository root, trial imports and [Session reporter](../session_report/README.md)
are resolved from this script's location, so invocation does not depend on the
working directory or a particular user's checkout path.

## Prepare the inputs

Keep the external benchmark checkout outside the agent workspace and pin it to
the exact commit accepted by the runner:

```sh
git clone https://github.com/Aider-AI/polyglot-benchmark /absolute/polyglot-benchmark
git -C /absolute/polyglot-benchmark checkout 7e0611e77b54e2dea774cdc0aa00cf9f7ed6144f
go -C harness/go build -o /absolute/pero-agent-acp ./cmd/pero-agent-acp
```

From the Pero repository, validate both configurations without any model
request or credential access:

```sh
python3 harness/tools/benchmark/run_benchmark.py \
  --benchmark /absolute/polyglot-benchmark \
  --binary /absolute/pero-agent-acp \
  --output /absolute/results/prepare-eager --prepare-only

python3 harness/tools/benchmark/run_benchmark.py \
  --benchmark /absolute/polyglot-benchmark \
  --binary /absolute/pero-agent-acp \
  --output /absolute/results/prepare-defer --prepare-only --defer-tool-loading
```

`--prepare-only` hashes the specified binary but never starts it. It creates a
solution skeleton and README for each workspace, then runs the original tests
against both the skeleton and the reference solution in separate judge
directories. It stops before reading `DEEPSEEK_API_KEY`, creating a plugin or
launcher, or importing/starting the ACP client. Every output directory must be
new; existing runs are refused.

## Run the agent

The credential must already be in the `DEEPSEEK_API_KEY` environment variable.
The runner does not load `.env` or modify a credential file. With that variable
supplied by the caller:

```sh
python3 harness/tools/benchmark/run_benchmark.py \
  --benchmark /absolute/polyglot-benchmark \
  --binary /absolute/pero-agent-acp \
  --output /absolute/results/agent-eager
```

Add `--defer-tool-loading` for the separate ToolSearch configuration, using a
new output directory. Eager loading is the default. `--tasks forth,react`,
`--model`, `--endpoint`, `--parallel` and `--max-requests` can select an explicit
experiment; `--help` lists the supported options. No engineering profile is
selected by this runner.

The default protocol is fixed:

- The four named exercises use their original docs, API skeletons and tests.
  Only README and solution skeletons enter the agent workspace. Official tests
  and reference implementations stay in separate judge directories.
- Thinking is disabled; sampling stays at the provider default. Each exercise
  shares a 64-request budget across its main/child requests and both attempts,
  with 8,192 maximum output tokens per request, a 900-second Session timeout,
  a 240-second idle timeout and no HTTP retries.
- A neutral plugin declares no business skills, hooks or workflow. The trial
  explicitly allows its existing workspace and shell operations in auto-review
  mode. The client does not provide an OS sandbox.
- The first implementation is frozen and judged with the original unittest
  files. After a failing normal end-turn, the same Session gets the unmodified
  judge output for at most one repair. Aborts, provider failures and incomplete
  shutdown do not pass, even when some files were written.
- Success requires the entire exercise to pass; the two counters are first-pass
  and final-pass exercise counts. The source prompt and judging rules are
  unchanged from the original local benchmark runner.

Each run retains metadata, binary/runner hashes, a runner source snapshot,
baseline/reference validation, frozen attempts, diffs, raw Session records,
judge outputs and receipts. `results.json` includes offline `trace_summary`
diagnostics after cleanup. These diagnostics do not alter the independent
judge's verdict. The runner snapshot records provenance; rerun the tracked
script from the matching Pero checkout to retain its sibling dependencies.

## Verified preparation

On 2026-11-04, equivalent eager/defer preparations were executed from a temporary directory
against benchmark commit `7e0611e77b54e2dea774cdc0aa00cf9f7ed6144f`, with
`DEEPSEEK_API_KEY` absent from the child environment. The specified existing
binary was hashed without execution. Both configurations produced:

| Exercise | Skeleton | Reference tests | Skipped |
| --- | --- | ---: | ---: |
| forth | fails | 54 pass | 0 |
| react | fails | 14 pass | 0 |
| rest-api | fails | 9 pass | 0 |
| zipper | fails | 14 pass | 0 |
| Total | all four fail | 91 pass | 0 |

The check also verified that every workspace contained exactly its unchanged
solution skeleton plus README, that eager/defer metadata and budgets matched
the requested configuration, and that runner/binary hashes matched their
inputs. No agent/plugin/launcher records were created and no paid request was
made. This validates preparation and holdout separation; it is not an agent
benchmark score.

The validation binary SHA-256 was
`f9558b4cf922271ce5813172d801e3d9678c2583518380a070dada939e4ab819`.
The wrapper, judge and preparation functions remained identical to the source
runner, and all prompt/configuration strings in the agent path were preserved.
The relocated reporter was also exercised offline against one existing Zipper
Session and retained its 11 tool calls.
