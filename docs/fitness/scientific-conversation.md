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

- Table is visible before its optional execution details, with source and unverified status.
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
- `node scripts/cargo.mjs test -p pero-chat-ui --features native`: 32 unit tests
  and 1 integration test pass, including math syntax, table escaping and small numeric axes.
- Native executable and Wasm compile; Web production bundle builds.
- `npm run check` passes with Rust tools on PATH and `PERO_GPUI_KIT_PATH` set to
  the matching 0.8.1 source. Worktree default relative Kit path is not valid.
- `node --test scripts/build/workbench-payload.test.mjs`: 4 tests pass with the
  managed Python 3.12 on PATH; system Python 3.9 fails the existing Paper CLI test.
- `git diff --check` passes; changed source files remain below 1000 lines.

Native visual checks now pass after unlocking macOS. The isolated development
bundle `Pero Scientific.app` uses this worktree's executable and test data home;
other running Pero checkouts were not modified. Inspected saved
`test-results/scientific-chat/native-{equations-light,equations-dark,results-light,results-dark,source,narrow-pane}.png`.
Copying the PDE and pasting it into an unsent draft returned its original source;
the draft was cleared. Original records opened in the shared Native reader.
Execution details remained available. Keyboard resizing of the session list
narrowed the conversation pane without clipping the observed formulas.

Standalone Chat-specific Wasm, signed packages, Windows/Linux, full accessibility,
arbitrary wide formula scrolling and all scientific disciplines
remain unverified. The Web bundle used existing standalone Chat/Reader artifacts
only to satisfy unrelated entries; acceptance concerns the rebuilt workbench.

Library choice and remaining product scope are in the canonical
[issue record](../issues/2026-11-06-conversation-scientific-content.md).


## Real GPT, skill and RDKit

`tests/e2e/scientific-chat-real.mjs` is opt-in (`PERO_SCIENTIFIC_REAL=1`). It
requires explicit OPENAI_BASE_URL, OPENAI_MODEL, OPENAI_API_KEY and
SCIENTIFIC_PYTHON; credentials are inherited by Host and never written into the
agent config. The normal ACP Auto-review policy owns permitted shell/file work
inside a temporary selected workspace. No production approval rules changed.

Observed with configured `gpt-6.1-sol`:

- `test-results/scientific-chat-real-responses/turn-{1,2}.json`: six model requests
  completed natural tool selection, exact table/chart data, equation generation,
  and a revision to zero/new run while retaining the old table hash.
- `test-results/scientific-molecules-real-approved/result.json`: independent
  molecular scenario passed in eleven model requests. GPT discovered/read
  `molecular-report`, ran the existing worker with RDKit 2026.09.1, published an
  inline descriptor table, and delivered the actual result JSON artifact.
  Valid inputs yielded MolWt 46.069 / 90.07799999999999 and TPSA 20.23 / 57.53 Å²;
  stereo input was preserved, and `invalid@@` retained a per-row error without
  descriptors or SVG. The worker SVGs are in the result file, not an inline
  molecular renderer. The tested skill SHA256 is
  `462286b54d10f5cad68b2ea683c02c2f4d10a04db0a25e70a8dc176e0d029630`.
- The configured Chat Completions endpoint returned HTTP 503 on its first
  attempt; the initial combined Responses run hit HTTP 429 on the third turn.
  An earlier molecular run used the wrong test policy (`--approval never`), so
  file/shell calls were denied and GPT truthfully reported no RDKit execution.
  These failures are retained, not counted as successful end-to-end runs.

Current Responses transport is nonstreaming; ACP tool/message updates are real,
but this does not certify token streaming from GPT. Independent scientific
verification, biological claims, general dimensional/statistical checks and an
automatic simulation rerun graph remain out of scope.

## Content-first GPUI follow-up

Three scenario prototypes informed the shared GPUI implementation: equations,
control experiments and molecular partial failures. User-facing technical labels
were removed: formulas use an icon-only copy action; successful charts/tables
show content first and disclose execution details below. Shared Pero theme
components own result headings, provenance notes, table spacing and tonal roles.
Numeric cells stay exact and right aligned; null and missing remain distinct.
The source reader and stored ACP content retain their original behavior.

`node tests/e2e/scientific-chat.mjs` passed again after the redesign, including
formula copying, precise source copying, theme/width changes and restart. Saved
real GPT/RDKit history is replayed with no configured model provider for visual
checks in `test-results/scientific-molecules-real-approved/replay/`.

Additional checks: molecular skill validation, one existing context-discovery
Rust test, four App payload tests, eight font-tool tests, Native/Wasm builds,
32 chat unit tests plus one integration test, and `npm run check` pass. The font
build includes explicit scientific unit glyphs and rejects old incomplete local
subsets; generated font binaries stay ignored. Rebuilt Wasm replay screenshots
confirm Å² is now visible in the molecular table and answer in both themes.

The real molecular table was also inspected in the narrower workbench window,
including a horizontal wheel gesture to its rightmost error column. This caught
a long decimal wrapping onto a second line: scientific cells now keep one line
and use horizontal scrolling, preserving the exact value and SMILES together.

Native also replayed the saved real GPT molecular conversation with no configured
provider after rebuilding the final font/table changes. The observed window
showed both exact descriptor rows, intact stereo input, Å², the invalid row and
its null values; this was a visual CUA observation, not a second model run.

## 2026-11-10 Control Lab receipt

Linux x86_64, master `ce9e2a3a`, Python 3.12.3 with the locked `control==0.10.2`,
`numpy==2.2.6` and `scipy==1.18.1` in a temporary virtualenv. ngspice was not
installed. No model API was called.

`/tmp/control-lab-py/bin/python -m unittest discover -s apps/control-lab/test -p 'test_*.py'`
ran 53 tests: 48 passed, 5 skipped. The skips are the existing solver gate and
real ngspice cases. The new tests cover:

- saved observations whose parameters then change stay `unchecked`, drop the curve,
  and list the old report under `notApplicable`;
- unavailable, computation failure and no attempt use different verdicts, with
  null actuals;
- the agent-step `project` action returns the receipt rather than an agent summary,
  and a second call does not execute the solver;
- real `python-control` proposals at kp=1 and kp=3 on robust-pid, horizon 2 s and
  201 samples. Both receipts are `check_failed`. Nominal final-window errors are
  0.2594973325520875 and 0.012463386149768274 against limit 0.01. Their versions
  and report ids differ. The inline curve is 16 of the 201 saved reference
  samples, compared by exact sample value. Replaying `project` returns the same
  receipt.

`node --test apps/control-lab/test/agent-schema.test.ts` passed.

`PERO_GPUI_KIT_PATH` pointed at gpui-kit `7591a35` (0.9.0). With nightly-2026-10-28
and one Cargo job:

`node scripts/cargo.mjs test -j1 -p pero-chat-ui --features native --lib`

passed 43 library tests, including the three receipt tests for distinct statuses,
rejected inherited checks, forged pass receipts, and null values staying blank.
This is a native library build. Wasm was not built or run. No Workbench window
was opened, so theme, narrow layout, keyboard and copy were not visually checked
for the new receipt. The parser and button actions exist; they are not a
screenshot acceptance.

## 2026-11-10 Molecule receipt and formula identity

The same virtualenv, after `rdkit==2026.9.1` (reported version 2026.09.1):

`/tmp/control-lab-py/bin/python -m unittest discover -s apps/scientific-viewer/test -p 'test_molecule_conversation.py'`

passed both tests. The real case depicts `CCO` and `C[C@H](O)C(=O)O`, keeps
`invalid@@` as `Invalid molecule` with no SVG or descriptors, and repeats the
same version. RDKit prints its usual SMILES parse errors for the invalid record.

`PERO_MOLECULE_PYTHON=/tmp/control-lab-py/bin/python go -C harness/go test ./molecules -count=1`

passed the missing-backend case and the real RDKit case. The model summary does
not contain the SVG. `go -C harness/go build -o /tmp/pero-agent-acp ./cmd/pero-agent-acp`
succeeded.

A second `pero-chat-ui` native library run passed 44 tests, adding the molecule
receipt test and the formula-source citation assertion. Wasm and the Workbench
were still not run, so the RDKit SVG was not observed inside GPUI.

## 2026-11-10 Stable citations

`go -C harness/go test -count=1 ./charts` passes, including a table whose method
is “mean of the saved samples” and whose value origin is calculated. A null cell
stays null. Changing the origin changes the receipt bytes.

`PERO_GPUI_KIT_PATH=/tmp/gpui-kit CARGO_BUILD_JOBS=1 rustup run nightly-2026-10-28 node scripts/cargo.mjs test -j1 -p pero-chat-ui --features native --lib`
passes 46 tests. Citation tests show that reversing saved chart/table identities
does not retarget the original token, and a short Paper location is rejected.

This still does not open the Workbench. Theme, narrow layout, long formulas,
wide tables, keyboard copy and restart were not observed for these labels.

Later the same day, two display attempts were made on Linux with `DISPLAY=:1`:

- `node scripts/cargo.mjs +nightly-2026-10-28 build -j1 -p pero-ui --features native --bin pero-native`
  failed after `libgtk-3-dev` and `libwebkit2gtk-4.1-dev` were installed. The
  compile still cannot read the generated `Workbench-bold.ttf` and
  `JetBrainsMono-Regular.ttf`, and `crates/pero-ui/src/native_web.rs` does not
  match the installed `webkit2gtk` 2.0 (`prelude`, `can_go_back`).
- `node scripts/build/wasm.mjs --chat-only` exited 0. Headless Chrome loaded
  that shared chat Wasm and painted the empty “Start with a task” shell. The
  injected table receipt and formula did not become the visible conversation,
  so the screenshot is not acceptance of the new receipt. Dark, narrow, keyboard
  copy and restart were not observed. `npm run dev:native` refuses Linux.
