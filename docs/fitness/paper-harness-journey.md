---
kind: verification_report
date: 2026-10-30
status: verified_local
---

# Meta-Harness reading and research journey

This slice adds local PDF import, source-language query planning, bounded evidence
selection, saved follow-up context and manual report-matrix revisions. It keeps
the reading-first surface, 44px header, PDFium renderer, original-file locators
and Host-owned Agent execution. See [design](../design-docs/paper-research-journey.md).

## Source and scope

Actual source: [Meta-Harness: End-to-End Optimization of Model Harnesses](https://arxiv.org/abs/2603.28052v1),
26 pages, downloaded from `https://arxiv.org/pdf/2603.28052v1`.
The original is 1,078,140 bytes with SHA-256
`7d9b90f53a9f4801a090f1a4acb843340cde81e4f865f97d53fff2a6a570eb73`.
Import therefore exercises a binary upload larger than the JSON API's 1 MiB limit.
All profiles are disposable; the user's existing research data is not changed.

Source: isolated managed worktree `paper-harness-journey`, based on `dc75f94`.
The shared checkout underwent a concurrent rebase during implementation. Its
source was recovered before further work; Host/Web build outputs were then
copied into the isolated checkout to prevent concurrent builds changing a run.
This is macOS arm64 development acceptance, not a signed release.

## Deterministic acceptance

- All 22 Python tests pass with the existing pinned PDFium/Pillow dependencies.
  Coverage includes duplicate PDF bytes, original storage, a supplemental query,
  the two-round ceiling, invalid passage/quotation refusal, frozen conversation,
  matrix corrections, exports and reopening records. A later follow-up sees
  corrected matrix values; previous frozen inputs keep their old context.
- Paper TypeScript and production build pass. Root `npm run check` passes with
  `PERO_GPUI_KIT_PATH=/Users/phodal/test/gpui-kit` (591 messages, 48 shared icons).
- Host App contracts pass: session ownership, cancellation, same-request identity,
  changed-input refusal and journal restart. No Host execution owner was added.
- The actual-paper/fixture-Agent Electron journey passes import, duplicate import,
  reading-only default, Chinese question, planned retrieval, exact PDF citation
  highlight, follow-up context, matrix correction and Desktop restart. There are
  no unexpected page errors. Dark narrow editing, horizontal containment and Escape
  returning focus to the edited cell are checked. The editor screenshot was
  inspected; its first inside-cell layout was obscured by a fixed column and was
  moved below the table. Its generated answers are explicitly synthetic.

Artifacts: ignored `test-results/paper-harness/fixture/`, including `result.json`,
`01-import-and-read.png`, `02-answer-and-original.png`, `03-followup.png`,
`04-matrix-correction.png`, `05-editor-dark-narrow.png`, `first-answer.json`
and `followup-answer.json`.

The final full `npm run test:paper` suite passes all 13 grouped Desktop checks
with no unexpected errors. It covers discovery, local search, math/GFM rendering,
invalid-output repair, exports, cancellation, image copy, annotations, full-text
answer citations, theme/locale/narrow views and restart. Expected invalid-request
and grant-denial responses remain explicit in `test-results/paper-agent/result.json`.
The actually served final App artifacts match the build:

- JS: `791df06ff1341cd02b24831cb014d5d736b298e1c8f91ebf6ae9d5ab505f1f52`
- CSS: `edaa643c9b362b371f955f9dfcedbe79231c83eee463dfb05fe876b2f085c8ff`

## Real-Agent acceptance

Real Codex execution passed all six journey groups, including Desktop restart,
with no unexpected page errors. Evidence lives separately in
`test-results/paper-harness/real-agent/`. A fixture pass is not a real-answer pass.
The first live attempt exposed surrounding prose before planner JSON; the parser
now accepts one complete object and still rejects ambiguous objects/unknown IDs.
The second live attempt completed planning and two selections but exceeded a
four-minute overall test window before an answer was available. The live journey
uses a ten-minute bound per question to accommodate all Host stages. The configured
Codex model is `gpt-6.1-sol[xhigh]`; this journey does not override model settings.

After clarifying the existing report contract, the first real answer was saved
with three cited sections and a structured matrix. The reading/citation screenshot
was visually inspected. Manual source review confirmed the method, filesystem
history and search-set-only feedback boundary against the quoted original pages
2–6. The answer explicitly qualifies incomplete evaluation protocols and ablations
as gaps in the retrieved excerpts, rather than absence in the complete paper.

The real follow-up resolves its parent question, retrieves fresh passages and
recovers Table 3. Its median/best pairs (34.6/41.3, 34.9/38.7, 50.0/56.7) match
the original table. It distinguishes that ablation from a general proof that
summaries are harmful. The generated matrix was corrected through the actual UI;
the saved original matrix stayed unchanged. After Desktop restart, the original
PDF hash, answers and corrected matrix were retained without Agent execution.

The H100 question also produced a validated answer: it explicitly declines to
estimate training GPU hours/cost, cites the frozen-base-model statement and
distinguishes harness-search wall-clock time from training compute. It qualifies
its conclusion to the retrieved excerpts. No numerical H100 training/cost result
was invented. `unsupported-question.json` retains this answer and its frozen
input.

The real run used an earlier UI bundle. Final UI fixes deduplicate validation
errors and place the matrix editor below its scrollable table, so fixed columns
cannot obscure editing fields in a narrow window. The final fixture/Desktop
regressions exercise the delivered UI bundle; the real run uses the same planning and answer prompt code.
Exact real-run artifact hashes are in `tested-artifacts.json`.

Observed limits: two lexical search rounds still omit parts of the evaluation
protocol on the broad first question; the focused follow-up recovered Table 3.
There is no exhaustive-coverage guarantee. Several Host/model calls per question
with the configured xhigh model take minutes; this is not a latency benchmark,
and the App adds no provider-duration or token-cost budget.

## Reproduce

Prepare the existing App dependency pins in a Python environment, build the
Desktop/Host/Web and builtin Apps, then download the public PDF explicitly:

```sh
mkdir -p test-results/paper-harness
curl -fL https://arxiv.org/pdf/2603.28052v1 -o test-results/paper-harness/meta-harness.pdf
PERO_APP_PYTHON=/absolute/path/to/prepared/bin/python node tests/e2e/paper-harness.mjs
PERO_APP_PYTHON=/absolute/path/to/prepared/bin/python PERO_PAPER_JOURNEY_AGENT=codex node tests/e2e/paper-harness.mjs
```

The last command uses the configured local Codex login and makes real model
requests. Run Electron suites sequentially. PDF import itself is local; no OCR or
new model runtime is installed by the App. Query rewrite and evidence selection
can miss material. Exact quotation matching establishes a source location, not
whether a scientific claim is true or a benchmark generalizes.
