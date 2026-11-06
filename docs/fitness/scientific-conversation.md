# Scientific conversation acceptance — #145

2026-11-06, macOS arm64, development worktree `codex/scientific-chat-145`,
base `1766b667` plus this issue's commits. GPUI Kit 0.8.1 from the pinned
repository version, Rust nightly-2026-10-28 for Native/Wasm. The main checkout's
uncommitted GPUI upgrade was not included.

## Behavior and visual evidence

`node tests/e2e/scientific-chat.mjs` runs the actual Go harness, Python data
core, Rust Host and Electron GPUI/Wasm workbench. Its loopback streaming model
fixture requests `table_render` and `chart_render`; it does not fabricate their
receipts. The test checks tool availability, a source-bound table and chart,
exact numeric text, clipboard copying of PDE LaTeX and original JSON, source
reader navigation, and full Desktop restart without additional model requests.

Inspected `test-results/scientific-chat/{table-light,equations-light,equations-dark,narrow-dark,original-records}.png`:

- Table is visible below the collapsed tool, with source and unverified status.
  `0.0100`, `9007199254740993`, zero, explicit null and missing cells remain distinct.
- Inline state equation, PDE, aligned optimization, matrix, negative binomial
  notation and simple reaction are legible in both themes. Unsupported LaTeX
  keeps its source and local error without removing the rest of the reply.
- Original records open in the shared reader; exact bytes are copyable. No App
  switch is needed to read the primary results.
- Reduced window width (the Workbench enforces its existing minimum) wraps
  explanation text and retains equations. This does not certify mobile layout,
  arbitrarily wide tables/formulas, screen-reader behavior or complete keyboard navigation.

## Real computation, separately scoped

Using a Python environment with `python-control` 0.10.2:

```sh
python tests/fixtures/scientific-control.py
SCIENTIFIC_DATASET=test-results/scientific-chat/control/results.json \
SCIENTIFIC_OUTPUT_DIR=test-results/scientific-chat/control-ui \
node tests/e2e/scientific-chat.mjs
```

The first command invokes Control Lab's engine and independent checker for
robust-PID nominal scenarios at kp=1 and kp=2. It saves input specification,
solver artifacts, observation hashes and reports. Final sampled tracking error
is 0.008012362983683907 / 0.0017626982052595386; both reports are FAIL. These are
sampled errors, not a claim of settling or full constraint satisfaction. NumPy
emitted divide/overflow/invalid-matmul warnings; they were not suppressed.

The second command feeds those saved outputs to real harness tools and checks
presentation/replay. `control-ui/table-light.png` shows both FAIL rows and the
small-valued chart. Inspection caught the old chart tick formatter rounding
nonzero measurements to 0.0; line/area/bar numeric axes and custom multi-series
lines now share scientific formatting for small values.

This is real solver + checker + real tool/UI wiring with a fixture model. It is
not live-model acceptance or the complete App authorization/Store workflow.
No automatic rerun graph or trusted verification badge has been introduced.

## Checks and boundaries

- `go -C harness/go test -race ./charts ./cmd/pero-agent-acp -run 'Test(ExperimentalTable|ChartReceipt|Windows)' -count=1` passes.
- `node scripts/cargo.mjs test -p pero-chat-ui --features native`: 31 unit tests
  and 1 integration test pass, including math syntax, table escaping and small numeric axes.
- Native executable and Wasm compile; Web production bundle builds.
- `npm run check` passes with Rust tools on PATH and `PERO_GPUI_KIT_PATH` set to
  the matching 0.8.1 source. Worktree default relative Kit path is not valid.
- `node --test scripts/build/workbench-payload.test.mjs`: 4 tests pass with the
  managed Python 3.12 on PATH; system Python 3.9 fails the existing Paper CLI test.
- `git diff --check` passes; changed source files remain below 1000 lines.

Native window inspection is blocked by macOS lock screen: the computer-use tool
could not unlock it. Native compilation and shared Rust tests are not Native
visual acceptance. Standalone Chat-specific Wasm, signed packages, Windows/Linux,
full accessibility and all scientific disciplines remain unverified.

Library choice and remaining product scope are in the canonical
[issue record](../issues/2026-11-06-conversation-scientific-content.md).
